import { randomUUID } from 'node:crypto';
import type {
  ASPClientRuntime,
  ASPClientTransport,
  ASPClientTransportOptions,
  ASPPublishResult,
  ASPSearchOptions,
  ASPSearchResult,
} from './types.js';
import type { Message } from '../models/message.js';
import type { Interaction } from '../models/interaction.js';
import { isInteraction } from '../models/interaction.js';
import { isMessage } from '../models/message.js';
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
    opts?: { since?: string; thread?: string },
  ): Promise<Message[]> {
    const nodeUrl = runtime.manifest.entity.id;
    const params = new URLSearchParams();
    if (opts?.since) params.set('since', opts.since);
    if (opts?.thread) params.set('thread', opts.thread);

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
    const raw = Array.isArray(data.messages) ? data.messages : [];
    return raw.filter((message): message is Message => isMessage(message));
  }

  async getInteractions(
    runtime: ASPClientRuntime,
    opts?: { since?: string; action?: string },
  ): Promise<Interaction[]> {
    const nodeUrl = runtime.manifest.entity.id;
    const params = new URLSearchParams();
    if (opts?.since) params.set('since', opts.since);
    if (opts?.action) params.set('action', opts.action);

    const url = buildEndpointUrl(nodeUrl, '/asp/interactions');
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
      throw new Error(`Interactions request failed: ${await readErrorMessage(res)}`);
    }
    const data = await res.json() as Record<string, unknown>;
    const raw = Array.isArray(data.interactions) ? data.interactions : [];
    return raw.filter((interaction): interaction is Interaction => isInteraction(interaction));
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
