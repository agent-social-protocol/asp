import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Manifest } from '../models/manifest.js';
import type { Message } from '../models/message.js';
import type { Interaction } from '../models/interaction.js';
import type {
  ASPClientOptions,
  ASPClientTransport,
  ASPClientRuntime,
  ASPSearchOptions,
  ASPSearchResult,
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
import { FileIdentityProvider } from './identity.js';
import { ProtocolASPTransport } from './protocol-transport.js';
import { isHostedEndpoint } from '../config/hosted.js';
import { HostedASPTransport } from '../hosted/transport.js';

const DEFAULT_POLL_INTERVAL_MS = 60_000; // 1 minute

export interface ASPClientEventMap {
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
  private _pollIntervalMs: number;
  private _lastMessageTs: string | null = null;
  private _lastInteractionTs: string | null = null;

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
   * Currently uses polling; will upgrade to WS when Hub supports it.
   * Agent code is identical either way — same events, same API.
   */
  async connect(): Promise<void> {
    if (this._pollTimer) return; // already connected

    // Start from now — don't replay history
    this._lastMessageTs = new Date().toISOString();
    this._lastInteractionTs = new Date().toISOString();

    this._pollTimer = setInterval(() => void this._poll(), this._pollIntervalMs);
    this.emit('connected');
  }

  /** Stop receiving events. */
  disconnect(): void {
    if (!this._pollTimer) return;
    clearInterval(this._pollTimer);
    this._pollTimer = null;
    this._lastMessageTs = null;
    this._lastInteractionTs = null;
    this.emit('disconnected');
  }

  /** Whether the client is currently connected (polling or WS). */
  get connected(): boolean {
    return this._pollTimer !== null;
  }

  /**
   * Internal polling tick. Fetches new messages and interactions since last poll,
   * auto-decrypts encrypted messages, and emits events in chronological order.
   */
  private async _poll(): Promise<void> {
    try {
      // Poll inbox
      const messages = await this.getInbox({ since: this._lastMessageTs ?? undefined });
      // Hub returns DESC order — reverse to emit chronologically
      const chronMessages = [...messages].reverse();
      for (const msg of chronMessages) {
        if (this._lastMessageTs && new Date(msg.timestamp).getTime() <= new Date(this._lastMessageTs).getTime()) continue;
        // Auto-decrypt if encrypted and we have the key
        let emitMsg = msg;
        if (this._encryptionKey && isEncryptedMessage(msg)) {
          try {
            emitMsg = decryptMessageContent(msg, this._encryptionKey);
          } catch {
            // Decryption failed (wrong key, corrupted data) — emit raw encrypted message.
            // Consumer can detect this via isEncryptedMessage(msg) and handle accordingly.
            // Design choice: never drop data silently. Dropping would hide delivery issues.
          }
        }
        this.emit('message', emitMsg);
        this._lastMessageTs = msg.timestamp;
      }

      // Poll interactions
      const interactions = await this.getInteractions({ since: this._lastInteractionTs ?? undefined });
      const chronInteractions = [...interactions].reverse();
      for (const interaction of chronInteractions) {
        if (this._lastInteractionTs && new Date(interaction.timestamp).getTime() <= new Date(this._lastInteractionTs).getTime()) continue;
        this.emit('interaction', interaction);
        this._lastInteractionTs = interaction.timestamp;
      }
    } catch (err) {
      // Polling failure — don't disconnect, emit error (if listened) and retry on next tick.
      // Without this guard, unhandled 'error' events crash the Node.js process.
      if (this.listenerCount('error') > 0) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
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

    // Encrypt if recipient supports it
    let toSend = msg;
    try {
      const encKey = await getRecipientEncryptionKey(targetUrl);
      if (encKey) {
        toSend = encryptMessageContent(msg, encKey);
      }
    } catch {
      // Recipient doesn't support encryption or unreachable — send plaintext
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
    const timestamp = new Date().toISOString();

    const interaction: Interaction = {
      action,
      from,
      to: targetUrl,
      timestamp,
      ...(opts?.target && { target: opts.target }),
      ...(opts?.content && { content: opts.content }),
    };

    if (this._privateKey) {
      const payload = `${from}:${action}:${opts?.target ?? ''}:${timestamp}`;
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

  async fetchFeed(url: string, opts?: { since?: string; topic?: string }): Promise<RemoteFeed> {
    return fetchFeed(url, opts);
  }

  async searchIndex(opts: ASPSearchOptions): Promise<ASPSearchResult[]> {
    return this._transport.searchIndex(this._runtime(), opts);
  }

  // --- Authenticated reads (to own node) ---

  async getInbox(opts?: { since?: string; thread?: string }): Promise<Message[]> {
    return this._transport.getInbox(this._runtime(), opts);
  }

  async getInteractions(opts?: { since?: string; action?: string }): Promise<Interaction[]> {
    return this._transport.getInteractions(this._runtime(), opts);
  }

  async publish(opts: {
    title: string;
    summary: string;
    topics?: string[];
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
}
