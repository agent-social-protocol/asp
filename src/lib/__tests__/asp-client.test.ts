// src/lib/__tests__/asp-client.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ASPClient } from '../asp-client.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import yaml from 'js-yaml';
import type { Manifest } from '../../models/manifest.js';
import type { Message } from '../../models/message.js';
import type { Interaction } from '../../models/interaction.js';
import { createDefaultManifest } from '../../models/manifest.js';
import { generateKeyPair, generateEncryptionKeyPair } from '../../utils/crypto.js';
import type { ASPClientTransport } from '../types.js';
import { HostedASPTransport } from '../../hosted/transport.js';

function makeTempIdentity(): {
  dir: string;
  manifest: Manifest;
  privateKey: string;
  encPrivateKey: string;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asp-test-'));
  const keys = generateKeyPair();
  const encKeys = generateEncryptionKeyPair();
  const manifest = createDefaultManifest({
    id: 'https://alice.asp.social',
    type: 'agent',
    name: 'Alice',
    handle: '@alice',
    bio: 'Test agent',
    languages: ['en'],
    publicKey: keys.publicKey,
    encryptionKey: encKeys.publicKey,
  });
  fs.writeFileSync(path.join(dir, 'manifest.yaml'), yaml.dump(manifest));
  fs.writeFileSync(path.join(dir, 'private.pem'), keys.privateKey);
  fs.writeFileSync(path.join(dir, 'encryption.pem'), encKeys.privateKey);
  return { dir, manifest, privateKey: keys.privateKey, encPrivateKey: encKeys.privateKey };
}

describe('ASPClient', () => {
  let tmpDir: string;
  let manifest: Manifest;

  beforeEach(() => {
    const identity = makeTempIdentity();
    tmpDir = identity.dir;
    manifest = identity.manifest;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('loads identity from directory', async () => {
      const client = new ASPClient({ identityDir: tmpDir });
      const m = await client.getManifest();
      expect(m.entity.name).toBe('Alice');
      expect(m.entity.id).toBe('https://alice.asp.social');
    });

    it('exposes nodeUrl from manifest entity.id', async () => {
      const client = new ASPClient({ identityDir: tmpDir });
      expect(await client.getNodeUrl()).toBe('https://alice.asp.social');
    });

    it('throws if identity directory missing', () => {
      expect(() => new ASPClient({ identityDir: '/nonexistent/path' }))
        .toThrow('Identity directory not found');
    });

    it('throws if manifest.yaml missing', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asp-empty-'));
      try {
        expect(() => new ASPClient({ identityDir: emptyDir }))
          .toThrow('manifest.yaml not found');
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it('loads encryption.pem when present', () => {
      const client = new ASPClient({ identityDir: tmpDir });
      // Verify by checking that decryption capability exists (private field)
      expect((client as any)._encryptionKey).toBeTruthy();
    });

    it('works without encryption.pem', () => {
      fs.unlinkSync(path.join(tmpDir, 'encryption.pem'));
      const client = new ASPClient({ identityDir: tmpDir });
      expect((client as any)._encryptionKey).toBeNull();
    });

    it('supports custom identity providers', async () => {
      const client = new ASPClient({
        identityProvider: {
          loadIdentity: () => ({
            manifest,
            privateKey: 'test-private-key',
            encryptionKey: null,
          }),
        },
      });

      expect(await client.getManifest()).toMatchObject({
        entity: { id: 'https://alice.asp.social', name: 'Alice' },
      });
    });

    it('uses a custom transport when provided', async () => {
      const transport: ASPClientTransport = {
        searchIndex: vi.fn().mockResolvedValue([{ endpoint: 'https://bob.example', name: 'Bob' }]),
        getInbox: vi.fn().mockResolvedValue([]),
        getInteractions: vi.fn().mockResolvedValue([]),
        publish: vi.fn().mockResolvedValue({ ok: true, id: 'entry-1' }),
      };
      const client = new ASPClient({ identityDir: tmpDir, transport });

      const results = await client.searchIndex({ q: 'bob' });

      expect(results).toEqual([{ endpoint: 'https://bob.example', name: 'Bob' }]);
      expect(transport.searchIndex).toHaveBeenCalledOnce();
    });

    it('requires explicit search transport or coreIndexUrl for protocol identities', async () => {
      const client = new ASPClient({
        identityProvider: {
          loadIdentity: () => ({
            manifest: {
              ...manifest,
              entity: {
                ...manifest.entity,
                id: 'https://alice.example',
              },
            },
            privateKey: fs.readFileSync(path.join(tmpDir, 'private.pem'), 'utf-8'),
            encryptionKey: fs.readFileSync(path.join(tmpDir, 'encryption.pem'), 'utf-8'),
          }),
        },
      });

      await expect(client.searchIndex({ q: 'bob' }))
        .rejects.toThrow('explicit ASP Index transport or coreIndexUrl');
    });

    it('uses endpoint auth by default for hosted identities', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = new ASPClient({ identityDir: tmpDir });
      await client.getInbox();

      const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toMatch(/^ASP-Sig https:\/\/alice\.asp\.social:\d+:/);
    });
  });

  describe('connect/disconnect', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('emits connected on connect()', async () => {
      const client = new ASPClient({ identityDir: tmpDir });
      const events: string[] = [];
      client.on('connected', () => events.push('connected'));

      await client.connect();
      expect(events).toEqual(['connected']);
      expect(client.connected).toBe(true);
      client.disconnect();
    });

    it('emits disconnected on disconnect()', async () => {
      const client = new ASPClient({ identityDir: tmpDir });
      const events: string[] = [];
      client.on('disconnected', () => events.push('disconnected'));

      await client.connect();
      client.disconnect();
      expect(events).toEqual(['disconnected']);
      expect(client.connected).toBe(false);
    });

    it('connect() is idempotent', async () => {
      const client = new ASPClient({ identityDir: tmpDir });
      let count = 0;
      client.on('connected', () => count++);

      await client.connect();
      await client.connect(); // second call is no-op
      expect(count).toBe(1);
      client.disconnect();
    });

    it('emits message events on poll tick', async () => {
      const client = new ASPClient({ identityDir: tmpDir });
      const received: Message[] = [];
      client.on('message', (msg) => received.push(msg));

      // Mock fetch: getInbox returns one new message, getInteractions returns empty
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/asp/inbox')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              messages: [{
                id: 'msg-1',
                from: 'https://bob.asp.social',
                to: 'https://alice.asp.social',
                timestamp: new Date(Date.now() + 10_000).toISOString(), // 10s in future = after connect baseline
                intent: 'chat',
                content: { text: 'Hello Alice' },
                initiated_by: 'agent',
              }],
            }),
          });
        }
        if (String(url).includes('/asp/interactions')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ interactions: [] }),
          });
        }
        return Promise.resolve({ ok: false });
      });
      vi.stubGlobal('fetch', mockFetch);

      await client.connect();
      // Advance timer to trigger one poll tick (default 60s)
      await vi.advanceTimersByTimeAsync(60_000);

      expect(received).toHaveLength(1);
      expect(received[0].content.text).toBe('Hello Alice');
      expect(received[0].from).toBe('https://bob.asp.social');

      client.disconnect();
      vi.unstubAllGlobals();
    });

    it('emits interaction events on poll tick', async () => {
      const client = new ASPClient({ identityDir: tmpDir });
      const received: Interaction[] = [];
      client.on('interaction', (i) => received.push(i));

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/asp/inbox')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ messages: [] }),
          });
        }
        if (String(url).includes('/asp/interactions')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              interactions: [{
                id: 'interaction-1',
                action: 'like',
                from: 'https://bob.asp.social',
                target: 'https://alice.asp.social/asp/feed#post-1',
                timestamp: new Date(Date.now() + 10_000).toISOString(),
              }],
            }),
          });
        }
        return Promise.resolve({ ok: false });
      });
      vi.stubGlobal('fetch', mockFetch);

      await client.connect();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(received).toHaveLength(1);
      expect(received[0].action).toBe('like');

      client.disconnect();
      vi.unstubAllGlobals();
    });

    it('does not emit events for messages older than connect baseline', async () => {
      const client = new ASPClient({ identityDir: tmpDir });
      const received: Message[] = [];
      client.on('message', (msg) => received.push(msg));

      // Capture old timestamp BEFORE connect (so it's truly in the past relative to baseline)
      const oldTimestamp = new Date(Date.now() - 10_000).toISOString();

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/asp/inbox')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              messages: [{
                id: 'old-msg',
                from: 'https://bob.asp.social',
                to: 'https://alice.asp.social',
                timestamp: oldTimestamp, // before connect baseline
                intent: 'chat',
                content: { text: 'Old message' },
                initiated_by: 'agent',
              }],
            }),
          });
        }
        if (String(url).includes('/asp/interactions')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ interactions: [] }),
          });
        }
        return Promise.resolve({ ok: false });
      });
      vi.stubGlobal('fetch', mockFetch);

      await client.connect();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(received).toHaveLength(0); // old message filtered out
      client.disconnect();
      vi.unstubAllGlobals();
    });

    it('emits error event on poll failure without disconnecting', async () => {
      const client = new ASPClient({ identityDir: tmpDir });
      const errors: Error[] = [];
      client.on('error', (err) => errors.push(err));

      const mockFetch = vi.fn().mockRejectedValue(new Error('network down'));
      vi.stubGlobal('fetch', mockFetch);

      await client.connect();
      await vi.advanceTimersByTimeAsync(60_000); // poll fails
      expect(client.connected).toBe(true); // still connected
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('network down');

      client.disconnect();
      vi.unstubAllGlobals();
    });

    it('does not crash on poll failure without error listener', async () => {
      const client = new ASPClient({ identityDir: tmpDir });
      // No error listener attached — should not throw
      const mockFetch = vi.fn().mockRejectedValue(new Error('network down'));
      vi.stubGlobal('fetch', mockFetch);

      await client.connect();
      await vi.advanceTimersByTimeAsync(60_000); // poll fails silently
      expect(client.connected).toBe(true);

      client.disconnect();
      vi.unstubAllGlobals();
    });

    it('auto-decrypts encrypted messages before emitting', async () => {
      // Create an encrypted message using the test identity's encryption public key
      const { encryptMessageContent } = await import('../../utils/encrypt-message.js');
      const encPubKey = manifest.verification.encryption_key!;
      const plainMsg: Message = {
        id: 'enc-msg-1',
        from: 'https://bob.asp.social',
        to: 'https://alice.asp.social',
        timestamp: new Date(Date.now() + 10_000).toISOString(),
        intent: 'secret',
        content: { text: 'Secret message' },
        initiated_by: 'agent',
      };
      const encryptedMsg = encryptMessageContent(plainMsg, encPubKey);

      const client = new ASPClient({ identityDir: tmpDir });
      const received: Message[] = [];
      client.on('message', (msg) => received.push(msg));

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/asp/inbox')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ messages: [encryptedMsg] }),
          });
        }
        if (String(url).includes('/asp/interactions')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ interactions: [] }),
          });
        }
        return Promise.resolve({ ok: false });
      });
      vi.stubGlobal('fetch', mockFetch);

      await client.connect();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(received).toHaveLength(1);
      // Should be decrypted — original plaintext restored
      expect(received[0].content.text).toBe('Secret message');
      expect(received[0].intent).toBe('secret');

      client.disconnect();
      vi.unstubAllGlobals();
    });

    it('stops polling after disconnect', async () => {
      const client = new ASPClient({ identityDir: tmpDir });
      const received: Message[] = [];
      client.on('message', (msg) => received.push(msg));

      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (String(url).includes('/asp/inbox')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              messages: [{
                id: `msg-${callCount}`,
                from: 'https://bob.asp.social',
                to: 'https://alice.asp.social',
                timestamp: new Date(Date.now() + callCount * 1000).toISOString(),
                intent: 'chat',
                content: { text: `Message ${callCount}` },
                initiated_by: 'agent',
              }],
            }),
          });
        }
        if (String(url).includes('/asp/interactions')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ interactions: [] }),
          });
        }
        return Promise.resolve({ ok: false });
      });
      vi.stubGlobal('fetch', mockFetch);

      await client.connect();
      await vi.advanceTimersByTimeAsync(60_000); // first poll
      const countAfterFirst = received.length;

      client.disconnect();
      await vi.advanceTimersByTimeAsync(60_000); // should NOT poll
      expect(received.length).toBe(countAfterFirst); // no new events

      vi.unstubAllGlobals();
    });
  });

  describe('API methods', () => {
    it('sendMessage constructs Message with correct fields', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      const client = new ASPClient({ identityDir: tmpDir });
      const result = await client.sendMessage('https://bob.asp.social', {
        intent: 'greet',
        text: 'Hello Bob',
        data: { mood: 'friendly' },
      });
      // Network call fails, but message was constructed and returned
      expect(result.message).toBeDefined();
      expect(result.message.from).toBe('https://alice.asp.social');
      expect(result.message.to).toBe('https://bob.asp.social');
      expect(result.message.intent).toBe('greet');
      expect(result.message.content.text).toBe('Hello Bob');
      expect(result.message.content.data).toEqual({ mood: 'friendly' });
      expect(result.message.id).toBeTruthy();
      expect(result.message.timestamp).toBeTruthy();
      expect(result.message.initiated_by).toBe('agent');
    });

    it('interact returns error on network failure without throwing', async () => {
      const client = new ASPClient({ identityDir: tmpDir });
      const result = await client.interact('https://bob.asp.social', 'like', {
        target: 'https://bob.asp.social/asp/feed#entry-1',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('interact without private key sends unsigned', async () => {
      fs.unlinkSync(path.join(tmpDir, 'private.pem'));
      const client = new ASPClient({ identityDir: tmpDir });
      const result = await client.interact('https://bob.asp.social', 'follow');
      expect(result.ok).toBe(false); // network fails, but no throw
    });

    it('_makeAuthHeader uses entity.id by default', async () => {
      const client = new ASPClient({ identityDir: tmpDir });
      const header = await (client as any)._makeAuthHeader('GET', '/asp/inbox');
      expect(header).toMatch(/^ASP-Sig https:\/\/alice\.asp\.social:\d+:/);
    });

    it('uses endpoint auth and plural params for protocol search', async () => {
      const client = new ASPClient({
        identityDir: tmpDir,
        coreIndexUrl: 'https://index.example',
      });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await client.searchIndex({ q: 'bob', skill: 'translation', tag: 'ai' });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [input, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      const url = new URL(input);
      expect(url.searchParams.get('skills')).toBe('translation');
      expect(url.searchParams.get('tags')).toBe('ai');
      expect(url.searchParams.get('skill')).toBeNull();
      expect(url.searchParams.get('tag')).toBeNull();
      expect(init.headers.Authorization).toMatch(/^ASP-Sig https:\/\/alice\.asp\.social:\d+:/);
    });

    it('uses endpoint auth for hosted node reads when hosted transport is explicit', async () => {
      const client = new ASPClient({
        identityDir: tmpDir,
        transport: new HostedASPTransport({ coreIndexUrl: 'https://index.example' }),
      });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await client.getInbox();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(init.headers.Authorization).toMatch(/^ASP-Sig https:\/\/alice\.asp\.social:\d+:/);
    });

    it('throws on authenticated ops without private key', async () => {
      fs.unlinkSync(path.join(tmpDir, 'private.pem'));
      const client = new ASPClient({ identityDir: tmpDir });
      await expect(client.getInbox()).rejects.toThrow('Private key required');
    });
  });
});
