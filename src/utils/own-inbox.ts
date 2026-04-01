import type { InboxEntry, InboxEntryKind } from '../models/inbox-entry.js';
import { isInboxEntry } from '../models/inbox-entry.js';
import { readInbox } from '../store/inbox-store.js';
import { readManifest } from '../store/manifest-store.js';
import { buildEndpointPath, buildEndpointUrl } from './endpoint-url.js';
import { buildAuthHeader, isHosted } from './remote-auth.js';

export interface OwnInboxReadOptions {
  cursor?: string;
  since?: string;
  thread?: string;
  kind?: InboxEntryKind;
  type?: string;
  direction?: 'sent' | 'received';
}

export interface OwnInboxReadResult {
  entries: InboxEntry[];
  nextCursor: string | null;
}

function filterLocalEntries(entries: InboxEntry[], opts: OwnInboxReadOptions): InboxEntry[] {
  const sinceTime = opts.since ? new Date(opts.since).getTime() : null;

  return entries.filter((entry) => {
    if (opts.kind && entry.kind !== opts.kind) return false;
    if (opts.type && entry.type !== opts.type) return false;
    if (opts.thread && entry.thread_id !== opts.thread) return false;
    if (sinceTime !== null) {
      const entryTime = new Date(entry.received_at ?? entry.timestamp).getTime();
      if (!Number.isFinite(entryTime) || entryTime <= sinceTime) return false;
    }
    return true;
  });
}

export async function readOwnInboxPage(opts: OwnInboxReadOptions = {}): Promise<OwnInboxReadResult> {
  if (await isHosted()) {
    const manifest = await readManifest();
    if (!manifest) {
      throw new Error('Manifest not found');
    }

    const endpoint = manifest.entity.id;
    const inboxUrl = buildEndpointUrl(endpoint, '/asp/inbox');
    const auth = await buildAuthHeader('GET', buildEndpointPath(endpoint, '/asp/inbox'));
    const params = new URLSearchParams();

    if (opts.cursor) params.set('cursor', opts.cursor);
    if (opts.since) params.set('since', opts.since);
    if (opts.thread) params.set('thread', opts.thread);
    if (opts.kind) params.set('kind', opts.kind);
    if (opts.type) params.set('type', opts.type);
    if (opts.direction) params.set('direction', opts.direction);

    const qs = params.toString();
    if (qs) {
      inboxUrl.search = qs;
    }

    const res = await fetch(inboxUrl.toString(), {
      headers: { Authorization: auth },
    });
    if (!res.ok) {
      throw new Error(`Hub returned ${res.status}`);
    }

    const data = await res.json() as { entries?: unknown[]; next_cursor?: string | null };
    const entries = Array.isArray(data.entries)
      ? data.entries.filter((entry): entry is InboxEntry => isInboxEntry(entry))
      : [];

    return {
      entries,
      nextCursor: typeof data.next_cursor === 'string' ? data.next_cursor : null,
    };
  }

  const inbox = await readInbox();
  const entries = opts.direction === 'sent'
    ? inbox.sent
    : opts.direction === 'received'
      ? inbox.received
      : [...inbox.sent, ...inbox.received];

  return {
    entries: filterLocalEntries(entries, opts),
    nextCursor: null,
  };
}
