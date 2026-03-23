import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { createASPHandler } from '../handler.js';
import { MemoryStore } from '../store.js';
import { createDefaultManifest } from '../../models/manifest.js';
import type { FeedEntry } from '../../models/feed-entry.js';
import type { InboxEntry } from '../../models/inbox-entry.js';
import type { Manifest } from '../../models/manifest.js';
import { generateKeyPair, signPayload } from '../../utils/crypto.js';
import { buildInboxEntrySignaturePayload } from '../../utils/inbox-entry.js';

function makeRequest(
  url: string,
  opts?: { method?: string; body?: unknown; accept?: string },
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

describe('e2e: agent discovery workflow', () => {
  let server: http.Server;
  let port: number;
  let receivedEntries: InboxEntry[];
  let senderKeyPair: ReturnType<typeof generateKeyPair>;

  beforeEach(async () => {
    receivedEntries = [];
    senderKeyPair = generateKeyPair();
    const store = new MemoryStore();

    // Service agent with skills
    const manifest = createDefaultManifest({
      id: 'https://hexagramreply.letus.social',
      type: 'service',
      name: 'HexagramReply',
      handle: '@hexagramreply',
      bio: 'I Ching divination service agent',
      tags: ['divination', 'iching', 'wisdom'],
      skills: [
        { id: 'hexagram', name: 'Hexagram Reading', description: 'Cast and interpret I Ching hexagrams', tags: ['divination', 'iching'] },
      ],
      languages: ['en', 'zh'],
      publicKey: 'ed25519:test',
    });
    await store.set('manifest', manifest);

    // Feed with mixed signal types
    const entries: FeedEntry[] = [
      {
        id: 'post-1',
        title: 'HexagramReply is live',
        published: '2026-03-17T01:00:00Z',
        topics: ['announcement'],
        summary: 'I Ching divination service is now available.',
        signal_type: 'status',
      },
      {
        id: 'post-2',
        title: 'Seeking beta testers for I Ching service',
        published: '2026-03-17T02:00:00Z',
        topics: ['divination', 'beta'],
        summary: 'Looking for people interested in I Ching readings. Free during beta.',
        signal_type: 'intent',
        metadata: { action: 'find', categories: ['beta-testers', 'divination'], scope: 'open' },
      },
      {
        id: 'post-3',
        title: 'Endorsed by @alice for accuracy',
        published: '2026-03-17T03:00:00Z',
        topics: ['endorsement'],
        summary: 'Alice verified reading accuracy.',
        signal_type: 'social',
      },
    ];
    await store.set('feed', entries);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      text: () => Promise.resolve(JSON.stringify(createDefaultManifest({
        id: 'https://alice.letus.social',
        type: 'agent',
        name: 'Alice',
        handle: '@alice',
        bio: 'Requester',
        languages: ['en'],
        publicKey: senderKeyPair.publicKey,
      }))),
    }));

    const handler = createASPHandler(store, {
      onMessage: (entry) => { receivedEntries.push(entry); },
    });
    server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;
  });

  afterEach(() => {
    server?.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('complete flow: discover → inspect → feed → filter intent → contact', async () => {
    const base = `http://localhost:${port}`;

    // Step 1: Discover — fetch manifest (whois equivalent)
    const { status: manifestStatus, body: manifestBody } = await makeRequest(`${base}/.well-known/asp.yaml`);
    expect(manifestStatus).toBe(200);
    const manifest = manifestBody as Manifest;
    expect(manifest.entity.name).toBe('HexagramReply');
    expect(manifest.entity.type).toBe('service');
    expect(manifest.skills).toHaveLength(1);
    expect(manifest.skills![0]).toMatchObject({ id: 'hexagram', tags: ['divination', 'iching'] });

    // Step 2: Read full feed
    const { status: feedStatus, body: feedBody } = await makeRequest(`${base}/asp/feed`);
    expect(feedStatus).toBe(200);
    const allEntries = (feedBody as { entries: FeedEntry[] }).entries;
    expect(allEntries).toHaveLength(3);

    // Step 3: Filter feed by signal_type=intent — discover actionable signals
    const { status: intentStatus, body: intentBody } = await makeRequest(`${base}/asp/feed?signal_type=intent`);
    expect(intentStatus).toBe(200);
    const intentEntries = (intentBody as { entries: FeedEntry[] }).entries;
    expect(intentEntries).toHaveLength(1);
    expect(intentEntries[0].signal_type).toBe('intent');
    expect(intentEntries[0].metadata).toMatchObject({ action: 'find', scope: 'open' });

    // Step 4: Send a service-request message
    const serviceRequest: InboxEntry = {
      id: 'msg-001',
      from: 'https://alice.letus.social',
      to: 'https://hexagramreply.letus.social',
      kind: 'message',
      type: 'service-request',
      timestamp: new Date().toISOString(),
      content: {
        text: 'I would like an I Ching reading about my career transition.',
        data: { service: 'hexagram', params: { question: 'Should I change careers?' } },
      },
      initiated_by: 'human',
    };
    serviceRequest.signature = signPayload(
      buildInboxEntrySignaturePayload(serviceRequest),
      senderKeyPair.privateKey,
    );
    const { status: msgStatus, body: msgBody } = await makeRequest(`${base}/asp/inbox`, {
      method: 'POST',
      body: serviceRequest,
    });
    expect(msgStatus).toBe(200);
    expect(msgBody).toEqual({ status: 'received' });

    // Step 5: Verify service agent received the message
    expect(receivedEntries).toHaveLength(1);
    expect(receivedEntries[0].type).toBe('service-request');
    expect(receivedEntries[0].content?.data).toMatchObject({ service: 'hexagram' });
  });

  it('flow: follow interaction → feed consumption', async () => {
    const base = `http://localhost:${port}`;

    // Step 1: Send follow interaction
    const followEntry: InboxEntry = {
      id: 'follow-001',
      kind: 'interaction',
      type: 'follow',
      to: 'https://hexagramreply.letus.social',
      from: 'https://alice.letus.social',
      target: 'https://hexagramreply.letus.social',
      timestamp: new Date().toISOString(),
      signature: '',
    };
    followEntry.signature = signPayload(
      buildInboxEntrySignaturePayload(followEntry),
      senderKeyPair.privateKey,
    );

    const { status: followStatus } = await makeRequest(`${base}/asp/inbox`, {
      method: 'POST',
      body: followEntry,
    });
    expect(followStatus).toBe(200);

    // Step 2: Read feed with topic filter
    const { body: topicBody } = await makeRequest(`${base}/asp/feed?topic=divination`);
    const topicEntries = (topicBody as { entries: FeedEntry[] }).entries;
    expect(topicEntries.length).toBeGreaterThanOrEqual(1);
    expect(topicEntries.every((e) => e.topics.includes('divination'))).toBe(true);

    // Step 3: Read feed with since filter
    const { body: sinceBody } = await makeRequest(`${base}/asp/feed?since=2026-03-17T02:30:00Z`);
    const sinceEntries = (sinceBody as { entries: FeedEntry[] }).entries;
    expect(sinceEntries).toHaveLength(1);
    expect(sinceEntries[0].id).toBe('post-3');
  });

  it('metadata round-trip: publish intent → read with metadata intact', async () => {
    const base = `http://localhost:${port}`;

    // Read feed and verify metadata survives JSON serialization
    const { body } = await makeRequest(`${base}/asp/feed?signal_type=intent`);
    const entries = (body as { entries: FeedEntry[] }).entries;
    expect(entries).toHaveLength(1);

    const intent = entries[0];
    expect(intent.metadata).toBeDefined();
    expect(intent.metadata!.action).toBe('find');
    expect(intent.metadata!.categories).toEqual(['beta-testers', 'divination']);
    expect(intent.metadata!.scope).toBe('open');
  });
});
