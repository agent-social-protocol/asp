import { randomUUID } from 'node:crypto';
import type {
  ASPClientRuntime,
  ASPInboxStreamConfig,
  ASPClientTransport,
  ASPClientTransportOptions,
  ASPInboxReadOptions,
  ASPInboxReadResult,
  ASPPublishResult,
  ASPSearchOptions,
  ASPSearchResult,
} from './types.js';
import type { InboxEntry } from '../models/inbox-entry.js';
import { isInboxEntry } from '../models/inbox-entry.js';
import { buildSearchParams } from './search.js';
import { buildEndpointUrl } from '../utils/endpoint-url.js';

async function readErrorMessage(res: Response): Promise<string> {
  const prefix = `HTTP ${res.status}`;

  try {
    const contentType = res.headers?.get?.('content-type') ?? '';
    if (contentType.includes('json')) {
      const data = await res.json() as Record<string, unknown>;
      if (typeof data.error === 'string' && data.error.length > 0) {
        return `${prefix}: ${data.error}`;
      }
      if (typeof data.message === 'string' && data.message.length > 0) {
        return `${prefix}: ${data.message}`;
      }
    }

    const text = await res.text();
    if (text.trim()) {
      return `${prefix}: ${text.trim()}`;
    }
  } catch {
    // Ignore parse failures and fall back to the status line.
  }

  return prefix;
}

export class HttpASPTransport implements ASPClientTransport {
  private readonly coreIndexUrl?: string;

  constructor(opts: ASPClientTransportOptions = {}) {
    this.coreIndexUrl = opts.coreIndexUrl;
  }

  async searchIndex(runtime: ASPClientRuntime, opts: ASPSearchOptions): Promise<ASPSearchResult[]> {
    if (!this.coreIndexUrl) {
      throw new Error('ASPClient search requires an explicit ASP Index transport or coreIndexUrl');
    }

    const params = buildSearchParams(opts);
    const url = `${this.coreIndexUrl}/search?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: await runtime.makeAuthHeader('GET', '/search'),
      },
    });
    if (!res.ok) {
      throw new Error(`ASP Index search failed: ${await readErrorMessage(res)}`);
    }
    const data = await res.json() as { results?: ASPSearchResult[] };
    return data.results ?? [];
  }

  async getInbox(
    runtime: ASPClientRuntime,
    opts?: ASPInboxReadOptions,
  ): Promise<ASPInboxReadResult> {
    const nodeUrl = runtime.manifest.entity.id;
    const params = new URLSearchParams();
    if (opts?.cursor) params.set('cursor', opts.cursor);
    if (opts?.since) params.set('since', opts.since);
    if (opts?.thread) params.set('thread', opts.thread);
    if (opts?.kind) params.set('kind', opts.kind);
    if (opts?.type) params.set('type', opts.type);
    if (opts?.direction) params.set('direction', opts.direction);

    const url = buildEndpointUrl(nodeUrl, '/asp/inbox');
    if (params.size > 0) {
      url.search = params.toString();
    }

    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: await runtime.makeAuthHeader('GET', url.pathname),
      },
    });

    if (!res.ok) {
      throw new Error(`Inbox request failed: ${await readErrorMessage(res)}`);
    }
    const data = await res.json() as Record<string, unknown>;
    const raw = Array.isArray(data.entries) ? data.entries : [];
    const entries = raw.filter((entry): entry is InboxEntry => isInboxEntry(entry));
    const nextCursor = typeof data.next_cursor === 'string' ? data.next_cursor : null;
    return { entries, nextCursor };
  }

  async resolveInboxStream(runtime: ASPClientRuntime): Promise<ASPInboxStreamConfig | null> {
    const streamEndpoint = runtime.manifest.endpoints.stream;
    if (!runtime.manifest.capabilities.includes('stream') || typeof streamEndpoint !== 'string' || streamEndpoint.trim() === '') {
      return null;
    }

    const url = buildEndpointUrl(runtime.manifest.entity.id, streamEndpoint);
    if (url.protocol === 'https:') {
      url.protocol = 'wss:';
    } else if (url.protocol === 'http:') {
      url.protocol = 'ws:';
    }

    return { url: url.toString() };
  }

  async publish(
    runtime: ASPClientRuntime,
    opts: { title: string; summary: string; topics?: string[]; signalType?: string; metadata?: Record<string, unknown> },
  ): Promise<ASPPublishResult> {
    const nodeUrl = runtime.manifest.entity.id;
    const id = randomUUID();
    const url = buildEndpointUrl(nodeUrl, '/asp/feed');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: await runtime.makeAuthHeader('POST', url.pathname),
      },
      body: JSON.stringify({
        id,
        title: opts.title,
        summary: opts.summary,
        topics: opts.topics ?? [],
        published: new Date().toISOString(),
        ...(opts.signalType && { signal_type: opts.signalType }),
        ...(opts.metadata && { metadata: opts.metadata }),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
      return { ok: false, id, error: err.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, id };
  }
}
