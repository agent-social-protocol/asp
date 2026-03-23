import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { createASPHandler } from '../handler.js';
import { MemoryStore } from '../store.js';
import { createDefaultManifest } from '../../models/manifest.js';
import type { FeedEntry } from '../../models/feed-entry.js';
import type { InboxEntry } from '../../models/inbox-entry.js';
import { generateKeyPair, signPayload } from '../../utils/crypto.js';
import { buildInboxEntrySignaturePayload } from '../../utils/inbox-entry.js';

function makeRequest(
  url: string,
  opts?: { method?: string; accept?: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyStr = opts?.body ? JSON.stringify(opts.body) : undefined;
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: opts?.method ?? 'GET',
      headers: {
        Accept: opts?.accept ?? 'application/json',
        ...(bodyStr && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode!, body: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

describe('handler signal_type filter', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    const store = new MemoryStore();
    const manifest = createDefaultManifest({
      id: 'https://test.example.com',
      type: 'agent',
      name: 'Test',
      handle: '@test',
      bio: 'test',
      languages: ['en'],
      publicKey: 'ed25519:test',
    });
    await store.set('manifest', manifest);

    const entries: FeedEntry[] = [
      { id: '1', title: 'Status update', published: '2026-03-17T01:00:00Z', topics: [], summary: 'Just a status', signal_type: 'status' },
      { id: '2', title: 'Looking for devs', published: '2026-03-17T02:00:00Z', topics: ['hiring'], summary: 'Need Rust devs', signal_type: 'intent', metadata: { action: 'find', categories: ['rust'] } },
      { id: '3', title: 'Endorsing Alice', published: '2026-03-17T03:00:00Z', topics: [], summary: 'Alice is great', signal_type: 'social' },
      { id: '4', title: 'No type post', published: '2026-03-17T04:00:00Z', topics: [], summary: 'Legacy post' },
    ];
    await store.set('feed', entries);

    const handler = createASPHandler(store);
    server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;
  });

  it('returns all entries without signal_type filter', async () => {
    const { status, body } = await makeRequest(`http://localhost:${port}/asp/feed`);
    expect(status).toBe(200);
    expect((body as { entries: unknown[] }).entries).toHaveLength(4);
  });

  it('filters by signal_type=intent', async () => {
    const { status, body } = await makeRequest(`http://localhost:${port}/asp/feed?signal_type=intent`);
    expect(status).toBe(200);
    const entries = (body as { entries: FeedEntry[] }).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('2');
    expect(entries[0].signal_type).toBe('intent');
    expect(entries[0].metadata).toEqual({ action: 'find', categories: ['rust'] });
  });

  it('filters by signal_type=status', async () => {
    const { status, body } = await makeRequest(`http://localhost:${port}/asp/feed?signal_type=status`);
    expect(status).toBe(200);
    const entries = (body as { entries: FeedEntry[] }).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('1');
  });

  it('returns empty for non-matching signal_type', async () => {
    const { status, body } = await makeRequest(`http://localhost:${port}/asp/feed?signal_type=nonexistent`);
    expect(status).toBe(200);
    expect((body as { entries: unknown[] }).entries).toHaveLength(0);
  });

  it('preserves metadata in feed response', async () => {
    const { body } = await makeRequest(`http://localhost:${port}/asp/feed`);
    const entries = (body as { entries: FeedEntry[] }).entries;
    const intentEntry = entries.find((e) => e.id === '2');
    expect(intentEntry?.metadata).toEqual({ action: 'find', categories: ['rust'] });
    // Entry without metadata should not have the field (or undefined)
    const legacyEntry = entries.find((e) => e.id === '4');
    expect(legacyEntry?.metadata).toBeUndefined();
  });

  afterEach(() => {
    server?.close();
  });
});

describe('handler inbox dedupe', () => {
  let server: http.Server;
  let port: number;
  const senderKeyPair = generateKeyPair();

  beforeEach(async () => {
    const store = new MemoryStore();
    const manifest = createDefaultManifest({
      id: 'https://receiver.example',
      type: 'agent',
      name: 'Receiver',
      handle: '@receiver',
      bio: 'receiver',
      languages: ['en'],
      publicKey: 'ed25519:receiver',
    });
    await store.set('manifest', manifest);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      text: () => Promise.resolve(JSON.stringify(createDefaultManifest({
        id: 'https://sender.example',
        type: 'agent',
        name: 'Sender',
        handle: '@sender',
        bio: 'sender',
        languages: ['en'],
        publicKey: senderKeyPair.publicKey,
      }))),
    }));

    const handler = createASPHandler(store);
    server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;
  });

  afterEach(() => {
    server?.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects duplicate sender-scoped inbox entries', async () => {
    const entry: InboxEntry = {
      id: 'dup-1',
      from: 'https://sender.example',
      to: 'https://receiver.example',
      kind: 'interaction',
      type: 'follow',
      target: 'https://receiver.example',
      timestamp: new Date().toISOString(),
      signature: '',
    };
    entry.signature = signPayload(buildInboxEntrySignaturePayload(entry), senderKeyPair.privateKey);

    const first = await makeRequest(`http://localhost:${port}/asp/inbox`, {
      method: 'POST',
      body: entry,
    });
    const second = await makeRequest(`http://localhost:${port}/asp/inbox`, {
      method: 'POST',
      body: entry,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: 'Duplicate inbox entry (already received)' });
  });
});
