import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ASPNodeOptions } from './types.js';
import type { ASPStore } from './store.js';
import { MemoryStore } from './store.js';
import { createASPHandler } from './handler.js';
import type { Manifest, Relationship } from '../models/manifest.js';
import type { FeedEntry } from '../models/feed-entry.js';
import type { InboxEntry } from '../models/inbox-entry.js';
import type { Message } from '../models/message.js';
import type { Interaction } from '../models/interaction.js';
import type { Following } from '../models/following.js';
import type { ReputationRecord } from '../reputation/models.js';
import { sendMessage } from '../utils/send-message.js';
import { sendInteraction } from '../utils/send-interaction.js';
import { getRecipientEncryptionKey, encryptMessageContent } from '../utils/encrypt-message.js';
import { fetchManifest, verifyEntity, verifyRepresentation } from '../utils/verify-identity.js';
import { fetchFeed, type RemoteFeed } from '../utils/fetch-feed.js';
import { computeTrust } from '../reputation/calculator.js';
import { signPayload } from '../utils/crypto.js';
import { buildInboxEntrySignaturePayload, inboxEntryToInteraction, inboxEntryToMessage, interactionToInboxEntry, messageToInboxEntry } from '../utils/inbox-entry.js';

export interface ASPEventMap {
  entry: [InboxEntry];
  message: [Message];
  interaction: [Interaction];
}

export class ASPNode extends EventEmitter<ASPEventMap> {
  readonly store: ASPStore;
  private _handler: (req: IncomingMessage, res: ServerResponse) => void;
  private _privateKey?: string;

  constructor(opts: ASPNodeOptions) {
    super();
    this.store = opts.store ?? new MemoryStore();
    this._privateKey = opts.privateKey;

    // Initialize manifest in store synchronously via a startup promise
    // (MemoryStore.set is sync internally, FileStore already has it on disk)
    void this.store.set('manifest', opts.manifest);

    this._handler = createASPHandler(this.store, {
      onEntry: (entry) => this.emit('entry', entry),
      onMessage: (entry) => {
        const message = inboxEntryToMessage(entry);
        if (message) this.emit('message', message);
      },
      onInteraction: (entry) => {
        const interaction = inboxEntryToInteraction(entry);
        if (interaction) this.emit('interaction', interaction);
      },
    }, { feedLimit: opts.feedLimit });
  }

  /** HTTP request handler — mount on any server. */
  handler(): (req: IncomingMessage, res: ServerResponse) => void {
    return this._handler;
  }

  /** Alias for handler(). */
  httpHandler(): (req: IncomingMessage, res: ServerResponse) => void {
    return this._handler;
  }

  // --- Outbound operations ---

  /** Send a structured message to another entity. */
  async sendMessage(targetUrl: string, opts: {
    intent: string;
    text: string;
    data?: Record<string, unknown>;
    replyTo?: string;
    threadId?: string;
  }): Promise<{ ok: boolean; message: Message; error?: string }> {
    const manifest = await this.store.get('manifest');
    const from = manifest?.entity.id ?? 'unknown';

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

    // Sign message metadata (same pattern as sendInteraction)
    if (this._privateKey) {
      const sigPayload = buildInboxEntrySignaturePayload(messageToInboxEntry(msg));
      msg.signature = signPayload(sigPayload, this._privateKey);
    }

    // Store plaintext locally
    const inbox = await this.store.get('inbox');
    inbox.sent.push({
      ...messageToInboxEntry(msg),
      received_at: new Date().toISOString(),
    });
    await this.store.set('inbox', inbox);

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

    // Send to remote
    const result = await sendMessage(targetUrl, toSend);
    return { ok: result.ok, message: msg, error: result.error };
  }

  /** Publish a feed entry. */
  async publish(opts: {
    title: string;
    summary: string;
    topics?: string[];
    contentUrl?: string;
    contentType?: string;
    signalType?: string;
    metadata?: Record<string, unknown>;
  }): Promise<FeedEntry> {
    const manifest = await this.store.get('manifest');
    const entry: FeedEntry = {
      id: randomUUID(),
      title: opts.title,
      published: new Date().toISOString(),
      topics: opts.topics ?? [],
      summary: opts.summary,
      ...(opts.contentUrl && { content_url: opts.contentUrl }),
      ...(opts.contentType && { content_type: opts.contentType }),
      ...(manifest?.entity.id && { author: manifest.entity.id }),
      ...(opts.signalType && { signal_type: opts.signalType }),
      ...(opts.metadata && { metadata: opts.metadata }),
    };

    const feed = await this.store.get('feed');
    feed.unshift(entry);
    await this.store.set('feed', feed);

    return entry;
  }

  /** Send an interaction to another entity. */
  async sendInteraction(targetUrl: string, action: string, opts?: {
    target?: string;
    content?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const manifest = await this.store.get('manifest');
    const from = manifest?.entity.id ?? 'unknown';

    const timestamp = new Date().toISOString();
    const interaction: Interaction = {
      id: randomUUID(),
      action,
      from,
      to: targetUrl,
      timestamp,
      ...(opts?.target && { target: opts.target }),
      ...(opts?.content && { content: opts.content }),
    };

    // Auto-sign if private key available
    if (this._privateKey) {
      const payload = buildInboxEntrySignaturePayload(interactionToInboxEntry(interaction));
      interaction.signature = signPayload(payload, this._privateKey);
    }

    // Store locally
    const inbox = await this.store.get('inbox');
    inbox.sent.push({
      ...interactionToInboxEntry(interaction),
      received_at: new Date().toISOString(),
    });
    await this.store.set('inbox', inbox);

    // Send to remote
    return sendInteraction(targetUrl, interaction);
  }

  /** Follow another entity. */
  async follow(url: string): Promise<void> {
    const entries = await this.store.get('following');
    if (entries.some((e) => e.url === url)) {
      throw new Error(`Already following ${url}`);
    }

    // Fetch their manifest to get name/handle
    const remote = await fetchManifest(url);
    const entry: Following = {
      url,
      name: remote?.entity.name,
      handle: remote?.entity.handle,
      added: new Date().toISOString(),
      created_by: 'agent',
    };

    entries.push(entry);
    await this.store.set('following', entries);
  }

  /** Unfollow an entity. */
  async unfollow(url: string): Promise<void> {
    const entries = await this.store.get('following');
    const filtered = entries.filter((e) => e.url !== url);
    if (filtered.length === entries.length) {
      throw new Error(`Not following ${url}`);
    }
    await this.store.set('following', filtered);
  }

  // --- Remote fetches ---

  /** Fetch another entity's manifest. */
  async fetchManifest(url: string): Promise<Manifest | null> {
    return fetchManifest(url);
  }

  /** Verify an entity is reachable with valid manifest. */
  async verifyEntity(url: string): Promise<{ valid: boolean; manifest?: Manifest; error?: string }> {
    return verifyEntity(url);
  }

  /** Verify that an agent represents an entity (bidirectional check). */
  async verifyRepresentation(agentUrl: string, claimedRepresents: string): Promise<boolean> {
    return verifyRepresentation(agentUrl, claimedRepresents);
  }

  /** Fetch feed from another entity. */
  async fetchFeed(url: string, opts?: { since?: string; topic?: string }): Promise<RemoteFeed> {
    return fetchFeed(url, opts);
  }

  /** Compute trust score for an entity from local reputation data. */
  async computeTrust(entityUrl: string): Promise<number> {
    const records = await this.store.get('reputation');
    const record = records.find((r) => r.entity === entityUrl);
    if (!record) return 0;
    return computeTrust(record);
  }

  // --- Local data access ---

  async getManifest(): Promise<Manifest | null> {
    return this.store.get('manifest');
  }

  async getFeed(): Promise<FeedEntry[]> {
    return this.store.get('feed');
  }

  async getInbox(): Promise<InboxEntry[]> {
    const inbox = await this.store.get('inbox');
    return inbox.received;
  }

  async getFollowing(): Promise<Following[]> {
    return this.store.get('following');
  }

  async getRelationships(): Promise<Relationship[]> {
    return this.store.get('relationships');
  }

  async getReputation(): Promise<ReputationRecord[]> {
    return this.store.get('reputation');
  }
}
