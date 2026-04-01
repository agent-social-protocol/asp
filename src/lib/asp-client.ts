import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Manifest } from '../models/manifest.js';
import type { Message } from '../models/message.js';
import type { Interaction } from '../models/interaction.js';
import { isInboxEntry, type InboxEntry } from '../models/inbox-entry.js';
import type {
  ASPClientOptions,
  ASPInboxStreamConfig,
  ASPClientTransport,
  ASPClientRuntime,
  ASPSearchOptions,
  ASPSearchResult,
  ASPInboxReadOptions,
  ASPInboxReadResult,
} from './types.js';
import { sendMessage } from '../utils/send-message.js';
import { sendInteraction } from '../utils/send-interaction.js';
import {
  getRecipientEncryptionKey,
  encryptMessageContent,
  isEncryptedMessage,
  decryptMessageContent,
} from '../utils/encrypt-message.js';
import { fetchManifest } from '../utils/verify-identity.js';
import { fetchFeed, type RemoteFeed } from '../utils/fetch-feed.js';
import { signPayload } from '../utils/crypto.js';
import { validateInteractionPolicy } from '../utils/interaction-policy.js';
import {
  buildInboxEntrySignaturePayload,
  inboxEntryToInteraction,
  inboxEntryToMessage,
  interactionToInboxEntry,
  messageToInboxEntry,
} from '../utils/inbox-entry.js';
import { FileIdentityProvider } from './identity.js';
import { ProtocolASPTransport } from './protocol-transport.js';
import { isHostedEndpoint } from '../config/hosted.js';
import { HostedASPTransport } from '../hosted/transport.js';

const DEFAULT_POLL_INTERVAL_MS = 60_000; // 1 minute
const DEFAULT_STREAM_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_STREAM_RECONNECT_BASE_MS = 1_000;
const DEFAULT_STREAM_RECONNECT_MAX_MS = 300_000;
const RECENT_DELIVERY_KEY_LIMIT = 2_048;
const STREAM_RECONNECT_JITTER_MIN = 0.5;

interface InboxDeliveryStateFile {
  cursor: string | null;
  since: string | null;
  updated_at: string;
}

interface HostedWsChallengeMessage {
  type: 'challenge';
  nonce: string;
}

interface HostedWsAuthOkMessage {
  type: 'auth_ok';
  resumed_from_cursor: string | null;
}

interface HostedWsEntryMessage {
  type: 'entry';
  identity: string;
  cursor: string;
  replay: boolean;
  entry: InboxEntry;
}

interface HostedWsCaughtUpMessage {
  type: 'caught_up';
  cursor: string | null;
}

interface HostedWsErrorMessage {
  type: 'error';
  error: string;
}

interface StreamSocketLifecycle {
  socket: WebSocket;
  cleanup: () => void;
  cancel?: (error: Error) => void;
}

interface InboxDeliveryMetadata {
  cursor?: string | null;
  identity?: string | null;
  replay?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAuthHandle(handle: string): string {
  return handle.replace(/^@/, '');
}

function normalizeStreamSubscribe(subscribe: readonly string[] | undefined): string[] | undefined {
  if (subscribe === undefined) {
    return undefined;
  }

  const deduped = new Set<string>();
  for (const handle of subscribe) {
    if (typeof handle !== 'string') {
      continue;
    }

    const normalized = normalizeAuthHandle(handle.trim());
    if (normalized) {
      deduped.add(normalized);
    }
  }

  if (deduped.size === 0) {
    throw new Error('Inbox stream subscribe must include at least one identity handle');
  }

  return [...deduped].sort((a, b) => a.localeCompare(b));
}

function serializeStreamSubscribe(subscribe: readonly string[] | undefined): string {
  const normalized = normalizeStreamSubscribe(subscribe);
  return normalized === undefined ? '*' : normalized.join(',');
}

function buildHostedWsAuthPayload(handle: string, nonce: string, subscribe?: readonly string[]): string {
  return `ws-auth:${handle}:${nonce}:${serializeStreamSubscribe(subscribe)}`;
}

function computeStreamReconnectDelayMs(attempt: number, random = Math.random): number {
  const cappedBaseDelay = Math.min(
    DEFAULT_STREAM_RECONNECT_MAX_MS,
    DEFAULT_STREAM_RECONNECT_BASE_MS * (2 ** attempt),
  );
  const jitter = STREAM_RECONNECT_JITTER_MIN + (random() * (1 - STREAM_RECONNECT_JITTER_MIN));
  return Math.round(cappedBaseDelay * jitter);
}

async function readWebSocketMessageText(data: unknown): Promise<string | null> {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data.text();
  }
  return null;
}

function isHostedWsChallengeMessage(value: unknown): value is HostedWsChallengeMessage {
  return isRecord(value) && value.type === 'challenge' && typeof value.nonce === 'string';
}

function isHostedWsAuthOkMessage(value: unknown): value is HostedWsAuthOkMessage {
  return isRecord(value)
    && value.type === 'auth_ok'
    && (typeof value.resumed_from_cursor === 'string' || value.resumed_from_cursor === null);
}

function isHostedWsEntryMessage(value: unknown): value is HostedWsEntryMessage {
  return isRecord(value)
    && value.type === 'entry'
    && typeof value.identity === 'string'
    && typeof value.cursor === 'string'
    && typeof value.replay === 'boolean'
    && isInboxEntry(value.entry);
}

function isHostedWsCaughtUpMessage(value: unknown): value is HostedWsCaughtUpMessage {
  return isRecord(value)
    && value.type === 'caught_up'
    && (typeof value.cursor === 'string' || value.cursor === null);
}

function isHostedWsErrorMessage(value: unknown): value is HostedWsErrorMessage {
  return isRecord(value) && value.type === 'error' && typeof value.error === 'string';
}

function readCloseCode(event: Event): string {
  if ('code' in event && typeof event.code === 'number') {
    return String(event.code);
  }
  return 'unknown';
}

export interface ASPClientEventMap {
  entry: [InboxEntry];
  message: [Message];
  interaction: [Interaction];
  error: [Error];
  connected: [];
  disconnected: [];
}

export class ASPClient extends EventEmitter<ASPClientEventMap> {
  private _manifest: Manifest;
  private _privateKey: string | null;
  private _encryptionKey: string | null;
  private _identityDir: string;
  private _transport: ASPClientTransport;

  // Polling state
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _streamSocket: WebSocket | null = null;
  private _streamLifecycle: StreamSocketLifecycle | null = null;
  private _pendingStreamLifecycle: StreamSocketLifecycle | null = null;
  private _streamReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _streamReconnectAttempt = 0;
  private _streamConfig: ASPInboxStreamConfig | null = null;
  private _connectPromise: Promise<void> | null = null;
  private _disconnectRequested = false;
  private _pollIntervalMs: number;
  private _lastInboxCursor: string | null = null;
  private _lastInboxSince: string | null = null;
  private _deliveryStatePath: string | null;
  private _recentDeliveryKeys = new Set<string>();
  private _recentDeliveryOrder: string[] = [];

  constructor(opts: ASPClientOptions) {
    super();
    const identityProvider = opts.identityProvider ?? (
      opts.identityDir ? new FileIdentityProvider(opts.identityDir) : null
    );
    if (!identityProvider) {
      throw new Error('ASPClient requires identityDir or identityProvider');
    }
    const identity = identityProvider.loadIdentity();
    this._manifest = identity.manifest;
    this._privateKey = identity.privateKey;
    this._encryptionKey = identity.encryptionKey;
    this._identityDir = identity.identityDir ?? opts.identityDir ?? '';
    this._transport = opts.transport ?? (
      isHostedEndpoint(this._manifest.entity.id)
        ? new HostedASPTransport({ coreIndexUrl: opts.coreIndexUrl })
        : new ProtocolASPTransport({ coreIndexUrl: opts.coreIndexUrl })
    );

    // Internal poll interval — not exposed to users per design spec
    this._pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
    this._deliveryStatePath = this._identityDir
      ? join(this._identityDir, '.runtime', 'inbox-stream.json')
      : null;
  }

  // --- Identity ---

  async getManifest(): Promise<Manifest> {
    return structuredClone(this._manifest);
  }

  async getNodeUrl(): Promise<string> {
    return this._manifest.entity.id;
  }

  get identityDir(): string {
    return this._identityDir;
  }

  // --- Connection lifecycle ---

  /**
   * Start receiving events from this identity's node.
   * Prefer manifest-declared inbox streams, with polling as the compatibility fallback.
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    if (this._connectPromise) return this._connectPromise;

    this._disconnectRequested = false;
    this._connectPromise = this._connectInternal().finally(() => {
      this._connectPromise = null;
    });
    return this._connectPromise;
  }

  /** Stop receiving events. */
  disconnect(): void {
    const wasConnected = this.connected || this._connectPromise !== null;
    this._disconnectRequested = true;
    this._clearStreamReconnectTimer();
    this._stopPolling();
    this._closePendingStreamSocket();

    const socket = this._clearActiveStreamSocket();
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      try {
        socket.close(1000, 'client_disconnect');
      } catch {
        // Ignore already-closed sockets.
      }
    }

    if (wasConnected) {
      this.emit('disconnected');
    }
  }

  /** Whether the client is currently connected (polling or WS). */
  get connected(): boolean {
    return this._pollTimer !== null || this._streamSocket !== null;
  }

  /**
   * Internal polling tick. Fetches new inbox entries since last poll and emits
   * entry plus compatibility message/interaction events in chronological order.
   */
  private async _poll(): Promise<void> {
    try {
      await this._pollOnce();
    } catch (err) {
      this._emitClientError(err);
    }
  }

  // --- Outbound: send to others (signed + optionally encrypted) ---

  async sendMessage(targetUrl: string, opts: {
    intent: string;
    text: string;
    data?: Record<string, unknown>;
    replyTo?: string;
    threadId?: string;
  }): Promise<{ ok: boolean; message: Message; error?: string }> {
    const from = this._manifest.entity.id;

    const msg: Message = {
      id: randomUUID(),
      from,
      to: targetUrl,
      timestamp: new Date().toISOString(),
      intent: opts.intent,
      content: {
        text: opts.text,
        ...(opts.data && { data: opts.data }),
      },
      initiated_by: 'agent',
      ...(opts.replyTo && { reply_to: opts.replyTo }),
      ...(opts.threadId && { thread_id: opts.threadId }),
    };

    // Sign message metadata (before encryption — signature covers cleartext metadata)
    if (this._privateKey) {
      const sigPayload = buildInboxEntrySignaturePayload(messageToInboxEntry(msg));
      msg.signature = signPayload(sigPayload, this._privateKey);
    }

    // Encrypt if recipient supports it
    let toSend = msg;
    const encryption = await getRecipientEncryptionKey(targetUrl);
    if (encryption.status === 'supported') {
      toSend = encryptMessageContent(msg, encryption.key);
    } else if (encryption.status === 'error') {
      return {
        ok: false,
        message: msg,
        error: `Could not determine recipient encryption support: ${encryption.error}`,
      };
    }

    try {
      const result = await sendMessage(targetUrl, toSend);
      return { ok: result.ok, message: msg, error: result.error };
    } catch (err) {
      return { ok: false, message: msg, error: (err as Error).message };
    }
  }

  async interact(targetUrl: string, action: string, opts?: {
    target?: string;
    content?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const from = this._manifest.entity.id;
    const policyError = validateInteractionPolicy({
      action,
      from,
      to: targetUrl,
      target: opts?.target ?? targetUrl,
    });
    if (policyError) {
      return { ok: false, error: policyError };
    }
    const timestamp = new Date().toISOString();
    const entryId = randomUUID();

    const interaction: Interaction = {
      id: entryId,
      action,
      from,
      to: targetUrl,
      timestamp,
      ...(opts?.target && { target: opts.target }),
      ...(opts?.content && { content: opts.content }),
    };

    if (this._privateKey) {
      const payload = buildInboxEntrySignaturePayload(interactionToInboxEntry({
        id: entryId,
        action,
        from,
        to: targetUrl,
        timestamp,
        ...(opts?.target && { target: opts.target }),
        ...(opts?.content && { content: opts.content }),
      }));
      interaction.signature = signPayload(payload, this._privateKey);
    }

    try {
      return await sendInteraction(targetUrl, interaction);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // --- Public queries (no auth) ---

  async whois(url: string): Promise<Manifest | null> {
    return fetchManifest(url);
  }

  async fetchFeed(url: string, opts?: { since?: string; topic?: string; signalType?: string }): Promise<RemoteFeed> {
    return fetchFeed(url, opts);
  }

  async searchIndex(opts: ASPSearchOptions): Promise<ASPSearchResult[]> {
    return this._transport.searchIndex(this._runtime(), opts);
  }

  // --- Authenticated reads (to own node) ---

  async getInboxPage(opts?: ASPInboxReadOptions): Promise<ASPInboxReadResult> {
    return this._transport.getInbox(this._runtime(), opts);
  }

  async getInbox(opts?: ASPInboxReadOptions): Promise<InboxEntry[]> {
    const { entries } = await this.getInboxPage(opts);
    return entries;
  }

  async getMessages(opts?: Omit<ASPInboxReadOptions, 'kind'>): Promise<Message[]> {
    const { entries } = await this._transport.getInbox(this._runtime(), { ...opts, kind: 'message' });
    return entries.map(inboxEntryToMessage).filter((entry): entry is Message => !!entry);
  }

  async getInteractions(opts?: Omit<ASPInboxReadOptions, 'kind' | 'type'> & { type?: string }): Promise<Interaction[]> {
    const { entries } = await this._transport.getInbox(this._runtime(), {
      ...opts,
      kind: 'interaction',
      ...(opts?.type ? { type: opts.type } : {}),
    });
    return entries.map(inboxEntryToInteraction).filter((entry): entry is Interaction => !!entry);
  }

  async publish(opts: {
    title: string;
    summary: string;
    topics?: string[];
    signalType?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ ok: boolean; id: string; error?: string }> {
    return this._transport.publish(this._runtime(), opts);
  }

  // --- Auth helper ---

  /**
   * Build ASP-Sig auth header.
   * ASP-Sig is always bound to entity.id (the canonical endpoint identity).
   */
  private async _makeAuthHeader(method: string, pathname: string): Promise<string> {
    if (!this._privateKey) {
      throw new Error('Private key required for authenticated operations');
    }
    const id = this._manifest.entity.id;
    const timestamp = Date.now().toString();
    const payload = `${id}:${timestamp}:${method}:${pathname}`;
    const signature = signPayload(payload, this._privateKey);
    return `ASP-Sig ${id}:${timestamp}:${signature}`;
  }

  private _runtime(): ASPClientRuntime {
    return {
      manifest: this._manifest,
      makeAuthHeader: (method, pathname) => this._makeAuthHeader(method, pathname),
    };
  }

  private async _connectInternal(): Promise<void> {
    if (!this._privateKey) {
      throw new Error('Private key required for authenticated operations');
    }

    const restoredState = await this._restoreDeliveryState();
    let performedImmediateCatchUp = false;

    if (!restoredState && !this._lastInboxCursor && !this._lastInboxSince) {
      this._lastInboxSince = new Date().toISOString();
      await this._persistDeliveryState();
    }

    if (restoredState && !this._lastInboxCursor && this._lastInboxSince) {
      await this._pollOnce();
      performedImmediateCatchUp = true;
    }

    this._streamConfig = await this._resolveInboxStream();
    const streamConnected = await this._connectStream(this._streamConfig);
    if (!streamConnected) {
      if (restoredState && !performedImmediateCatchUp) {
        await this._pollOnce();
      }
      if (!this._disconnectRequested) {
        this._startPolling();
        this._scheduleStreamReconnect();
      }
    }

    if (!this._disconnectRequested) {
      this.emit('connected');
    }
  }

  private _startPolling(): void {
    if (this._pollTimer) {
      return;
    }
    this._pollTimer = setInterval(() => void this._poll(), this._pollIntervalMs);
  }

  private _stopPolling(): void {
    if (!this._pollTimer) {
      return;
    }
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  }

  private async _pollOnce(): Promise<void> {
    const { entries, nextCursor } = await this._transport.getInbox(this._runtime(), {
      ...(this._lastInboxCursor ? { cursor: this._lastInboxCursor } : {}),
      ...(!this._lastInboxCursor && this._lastInboxSince ? { since: this._lastInboxSince } : {}),
    });

    for (const entry of entries) {
      if (!this._lastInboxCursor && this._lastInboxSince) {
        const baseline = new Date(this._lastInboxSince).getTime();
        const observedAt = new Date(entry.received_at ?? entry.timestamp).getTime();
        if (observedAt <= baseline) {
          continue;
        }
      }

      this._emitInboxEntry(entry);
    }

    if (nextCursor) {
      await this._setDeliveryState({
        cursor: nextCursor,
        since: null,
      });
    } else if (!this._lastInboxCursor && this._lastInboxSince) {
      await this._setDeliveryState({
        cursor: null,
        since: new Date().toISOString(),
      });
    }
  }

  private async _resolveInboxStream(): Promise<ASPInboxStreamConfig | null> {
    if (!this._transport.resolveInboxStream) {
      return null;
    }

    try {
      return await this._transport.resolveInboxStream(this._runtime());
    } catch {
      return null;
    }
  }

  private async _connectStream(config: ASPInboxStreamConfig | null): Promise<boolean> {
    if (!config) {
      return false;
    }

    try {
      await this._openStreamSocket(config);
      this._streamReconnectAttempt = 0;
      this._clearStreamReconnectTimer();
      this._stopPolling();
      return this._streamSocket !== null;
    } catch {
      return false;
    }
  }

  private async _openStreamSocket(config: ASPInboxStreamConfig): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(config.url);
      let authenticated = false;
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onClose);
        if (this._pendingStreamLifecycle?.socket === socket) {
          this._pendingStreamLifecycle = null;
        }
      };

      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        try {
          socket.close();
        } catch {
          // Ignore already-closed sockets.
        }
        reject(error);
      };

      const finish = () => {
        if (settled) {
          return;
        }
        if (this._disconnectRequested) {
          fail(new Error('Inbox stream connect cancelled'));
          return;
        }
        settled = true;
        if (this._pendingStreamLifecycle?.socket === socket) {
          this._pendingStreamLifecycle = null;
        }
        this._setActiveStreamSocket(socket, cleanup);
        resolve();
      };

      const onMessage = (event: MessageEvent<unknown>) => {
        void (async () => {
          const rawText = await readWebSocketMessageText(event.data);
          if (!rawText) {
            throw new Error('Inbox stream received unsupported message payload');
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(rawText);
          } catch {
            throw new Error('Inbox stream received invalid JSON');
          }

          if (isHostedWsChallengeMessage(parsed)) {
            socket.send(JSON.stringify(this._buildStreamAuthMessage(parsed.nonce, config)));
            return;
          }

          if (isHostedWsErrorMessage(parsed)) {
            const error = new Error(parsed.error);
            if (!authenticated) {
              fail(error);
              return;
            }
            this._emitClientError(error);
            return;
          }

          if (isHostedWsAuthOkMessage(parsed)) {
            authenticated = true;
            if (typeof parsed.resumed_from_cursor === 'string' && !this._lastInboxCursor) {
              void this._setDeliveryState({
                cursor: parsed.resumed_from_cursor,
                since: null,
              }).catch((error) => this._emitClientError(error));
            }
            finish();
            return;
          }

          if (!authenticated) {
            return;
          }

          await this._handleStreamMessage(parsed);
        })().catch((error) => {
          if (!authenticated) {
            fail(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          void this._recoverFromStreamFailure(error instanceof Error ? error : new Error(String(error)), socket);
        });
      };

      const onError = () => {
        const error = new Error('Inbox stream socket error');
        if (!authenticated) {
          fail(error);
          return;
        }
        void this._recoverFromStreamFailure(error, socket);
      };

      const onClose = (event: Event) => {
        if (!authenticated) {
          fail(new Error(`Inbox stream closed before auth (${readCloseCode(event)})`));
          return;
        }
        void this._recoverFromStreamFailure(new Error(`Inbox stream closed (${readCloseCode(event)})`), socket);
      };

      timeout = setTimeout(() => {
        fail(new Error('Inbox stream handshake timed out'));
      }, DEFAULT_STREAM_HANDSHAKE_TIMEOUT_MS);

      this._pendingStreamLifecycle = {
        socket,
        cleanup,
        cancel: fail,
      };
      socket.addEventListener('message', onMessage);
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
    });
  }

  private _buildStreamAuthMessage(nonce: string, config: ASPInboxStreamConfig): Record<string, unknown> {
    if (!this._privateKey) {
      throw new Error('Private key required for authenticated operations');
    }

    const handle = normalizeAuthHandle(this._manifest.entity.handle);
    const subscribe = normalizeStreamSubscribe(config.subscribe);
    return {
      type: 'auth',
      handle,
      nonce,
      ...(subscribe ? { subscribe } : {}),
      ...(this._lastInboxCursor ? { cursor: this._lastInboxCursor } : {}),
      signature: signPayload(buildHostedWsAuthPayload(handle, nonce, subscribe), this._privateKey),
    };
  }

  private async _handleStreamMessage(message: unknown): Promise<void> {
    if (isHostedWsEntryMessage(message)) {
      this._emitInboxEntry(message.entry, {
        cursor: message.cursor,
        identity: message.identity,
        replay: message.replay,
      });
      await this._setDeliveryState({
        cursor: message.cursor,
        since: null,
      });
      return;
    }

    if (isHostedWsCaughtUpMessage(message)) {
      if (typeof message.cursor === 'string') {
        await this._setDeliveryState({
          cursor: message.cursor,
          since: null,
        });
      }
      return;
    }
  }

  private async _recoverFromStreamFailure(error: Error, socket: WebSocket | null = null): Promise<void> {
    if (socket && this._streamSocket !== socket) {
      return;
    }

    this._clearActiveStreamSocket(socket);
    if (this._disconnectRequested) {
      return;
    }

    this._emitClientError(error);
    if (!this._pollTimer) {
      try {
        await this._pollOnce();
      } catch (pollError) {
        this._emitClientError(pollError);
      }
      if (!this._disconnectRequested) {
        this._startPolling();
      }
    }
    this._scheduleStreamReconnect();
  }

  private _emitInboxEntry(entry: InboxEntry, metadata: InboxDeliveryMetadata = {}): void {
    // Inbox stream delivery is at-least-once. Replay and live push can both
    // surface the same entry around reconnect windows, so the client keeps a
    // bounded recent-key set and suppresses duplicates best-effort.
    if (!this._rememberInboxDelivery(entry, metadata)) {
      return;
    }

    this.emit('entry', entry);

    const maybeMessage = inboxEntryToMessage(entry);
    if (maybeMessage) {
      let emitMsg = maybeMessage;
      if (this._encryptionKey && isEncryptedMessage(maybeMessage)) {
        try {
          emitMsg = decryptMessageContent(maybeMessage, this._encryptionKey);
        } catch {
          // Preserve encrypted payloads on decryption failure instead of silently dropping them.
        }
      }
      this.emit('message', emitMsg);
    }

    const maybeInteraction = inboxEntryToInteraction(entry);
    if (maybeInteraction) {
      this.emit('interaction', maybeInteraction);
    }
  }

  private _setActiveStreamSocket(socket: WebSocket, cleanup: () => void): void {
    this._clearActiveStreamSocket();
    this._streamSocket = socket;
    this._streamLifecycle = { socket, cleanup };
  }

  private _clearActiveStreamSocket(expected: WebSocket | null = null): WebSocket | null {
    if (expected && this._streamSocket !== expected) {
      return null;
    }

    const lifecycle = this._streamLifecycle;
    this._streamSocket = null;
    this._streamLifecycle = null;
    lifecycle?.cleanup();
    return lifecycle?.socket ?? null;
  }

  private _closePendingStreamSocket(): void {
    const lifecycle = this._pendingStreamLifecycle;
    this._pendingStreamLifecycle = null;
    if (!lifecycle) {
      return;
    }

    if (lifecycle.cancel) {
      lifecycle.cancel(new Error('Inbox stream connect cancelled'));
      return;
    }

    lifecycle.cleanup();
    if (lifecycle.socket.readyState === WebSocket.OPEN || lifecycle.socket.readyState === WebSocket.CONNECTING) {
      try {
        lifecycle.socket.close(1000, 'client_disconnect');
      } catch {
        // Ignore already-closed sockets.
      }
    }
  }

  private _scheduleStreamReconnect(): void {
    if (
      this._disconnectRequested
      || !this._streamConfig
      || this._streamReconnectTimer
      || this._streamSocket
      || this._pendingStreamLifecycle
    ) {
      return;
    }

    const delay = computeStreamReconnectDelayMs(this._streamReconnectAttempt);
    this._streamReconnectAttempt += 1;
    this._streamReconnectTimer = setTimeout(() => {
      this._streamReconnectTimer = null;
      void this._retryStreamReconnect();
    }, delay);
  }

  private _clearStreamReconnectTimer(): void {
    if (!this._streamReconnectTimer) {
      return;
    }
    clearTimeout(this._streamReconnectTimer);
    this._streamReconnectTimer = null;
  }

  private async _retryStreamReconnect(): Promise<void> {
    if (
      this._disconnectRequested
      || !this._streamConfig
      || this._streamSocket
      || this._pendingStreamLifecycle
    ) {
      return;
    }

    const connected = await this._connectStream(this._streamConfig);
    if (!connected && !this._disconnectRequested) {
      this._scheduleStreamReconnect();
    }
  }

  private _rememberInboxDelivery(entry: InboxEntry, metadata: InboxDeliveryMetadata): boolean {
    const identity = metadata.identity ?? normalizeAuthHandle(this._manifest.entity.handle);
    const deliveryKeys = [`${identity}:entry:${entry.id}`];
    if (metadata.cursor) {
      deliveryKeys.push(`${identity}:cursor:${metadata.cursor}`);
    }

    if (deliveryKeys.some((key) => this._recentDeliveryKeys.has(key))) {
      return false;
    }

    for (const key of deliveryKeys) {
      this._recentDeliveryKeys.add(key);
      this._recentDeliveryOrder.push(key);
    }

    while (this._recentDeliveryOrder.length > RECENT_DELIVERY_KEY_LIMIT) {
      const oldest = this._recentDeliveryOrder.shift();
      if (oldest) {
        this._recentDeliveryKeys.delete(oldest);
      }
    }

    return true;
  }

  private async _restoreDeliveryState(): Promise<boolean> {
    if (!this._deliveryStatePath) {
      return false;
    }

    let raw: string;
    try {
      raw = await readFile(this._deliveryStatePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Inbox stream state file is not valid JSON');
    }

    if (!isRecord(parsed)) {
      throw new Error('Inbox stream state file has invalid shape');
    }

    const cursor = parsed.cursor;
    const since = parsed.since;
    if (
      (cursor !== null && typeof cursor !== 'string')
      || (since !== null && typeof since !== 'string')
    ) {
      throw new Error('Inbox stream state file has invalid cursor values');
    }

    this._lastInboxCursor = typeof cursor === 'string' ? cursor : null;
    this._lastInboxSince = typeof since === 'string' ? since : null;
    return this._lastInboxCursor !== null || this._lastInboxSince !== null;
  }

  private async _setDeliveryState(next: { cursor: string | null; since: string | null }): Promise<void> {
    this._lastInboxCursor = next.cursor;
    this._lastInboxSince = next.since;
    await this._persistDeliveryState();
  }

  private async _persistDeliveryState(): Promise<void> {
    if (!this._deliveryStatePath) {
      return;
    }

    const data: InboxDeliveryStateFile = {
      cursor: this._lastInboxCursor,
      since: this._lastInboxSince,
      updated_at: new Date().toISOString(),
    };

    await mkdir(dirname(this._deliveryStatePath), { recursive: true });
    await writeFile(this._deliveryStatePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private _emitClientError(error: unknown): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }
}
