// src/mcp/__tests__/server.test.ts
//
// Integration tests for the ASP MCP server: tool metadata, resources, and runtime behavior.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ASPClient } from '../../lib/asp-client.js';
import { ASPClient as ASPClientImpl } from '../../lib/asp-client.js';
import { HostedASPTransport } from '../../hosted/transport.js';
import { createDefaultManifest } from '../../models/manifest.js';
import { createDefaultBehavior } from '../../config/behavior.js';
import { generateEncryptionKeyPair, generateKeyPair } from '../../utils/crypto.js';
import { createASPMCPServer, resolveClient } from '../server.js';
import { TOOL_DEFINITIONS } from '../tools.js';
import { messageToInboxEntry } from '../../utils/inbox-entry.js';

function makeTempIdentity(handle: string, name: string): { dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asp-mcp-test-'));
  const keys = generateKeyPair();
  const encKeys = generateEncryptionKeyPair();
  const manifest = createDefaultManifest({
    id: `https://${handle.replace('@', '')}.asp.social`,
    type: 'agent',
    name,
    handle,
    bio: `Test agent ${name}`,
    languages: ['en'],
    publicKey: keys.publicKey,
    encryptionKey: encKeys.publicKey,
  });
  fs.writeFileSync(path.join(dir, 'manifest.yaml'), yaml.dump(manifest));
  fs.writeFileSync(path.join(dir, 'behavior.yaml'), yaml.dump(createDefaultBehavior('medium')));
  fs.writeFileSync(path.join(dir, 'private.pem'), keys.privateKey);
  fs.writeFileSync(path.join(dir, 'encryption.pem'), encKeys.privateKey);
  return { dir };
}

async function createTestPair(clients: Map<string, ASPClient>) {
  const server = createASPMCPServer(clients, { version: '0.0.1-test' });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return {
    server,
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

function parseJsonText(result: { content?: Array<{ type: string; text?: string }> }) {
  const textBlock = result.content?.find((block) => block.type === 'text');
  if (!textBlock?.text) {
    throw new Error('Expected text content block');
  }
  return JSON.parse(textBlock.text) as Record<string, unknown>;
}

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('TOOL_DEFINITIONS', () => {
  it('defines 9 tools with title, output schema, and annotations', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(9);

    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(tool.title).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  it('marks read tools as read-only and write tools as side-effecting', () => {
    const inbox = TOOL_DEFINITIONS.find((tool) => tool.name === 'asp_check_inbox');
    const sendMessage = TOOL_DEFINITIONS.find((tool) => tool.name === 'asp_send_message');

    expect(inbox?.annotations?.readOnlyHint).toBe(true);
    expect(inbox?.annotations?.idempotentHint).toBe(true);
    expect(sendMessage?.annotations?.readOnlyHint).toBe(false);
    expect(sendMessage?.annotations?.idempotentHint).toBe(false);
  });

  it('marks asp_publish_feed as a network write with openWorldHint', () => {
    const publish = TOOL_DEFINITIONS.find((tool) => tool.name === 'asp_publish_feed');
    expect(publish?.annotations?.readOnlyHint).toBe(false);
    expect(publish?.annotations?.openWorldHint).toBe(true);
  });

  it('includes EXTERNAL DATA warning in inbox tool descriptions', () => {
    const inbox = TOOL_DEFINITIONS.find((tool) => tool.name === 'asp_check_inbox');
    expect(inbox?.description).toContain('EXTERNAL DATA');
  });
});

describe('resolveClient', () => {
  it('returns the only client when identity is omitted', () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const client = new ASPClientImpl({ identityDir: alice.dir });
    const clients = new Map([['alice', client]]);

    expect(resolveClient(clients)).toBe(client);
  });

  it('accepts explicit identities with or without @', () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const client = new ASPClientImpl({ identityDir: alice.dir });
    const clients = new Map([['alice', client]]);

    expect(resolveClient(clients, 'alice')).toBe(client);
    expect(resolveClient(clients, '@alice')).toBe(client);
  });

  it('rejects an explicit invalid identity even in single-identity mode', () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const clients = new Map([['alice', new ASPClientImpl({ identityDir: alice.dir })]]);

    expect(() => resolveClient(clients, 'other')).toThrow('not found');
  });

  it('asks for explicit identity when multiple identities are loaded', () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    const bob = makeTempIdentity('@bob', 'Bob');
    tempDirs.push(alice.dir, bob.dir);

    const clients = new Map([
      ['alice', new ASPClientImpl({ identityDir: alice.dir })],
      ['bob', new ASPClientImpl({ identityDir: bob.dir })],
    ]);

    expect(() => resolveClient(clients)).toThrow('Multiple identities loaded');
    expect(() => resolveClient(clients)).toThrow('asp://identities');
  });
});

describe('ASP MCP server', () => {
  it('publishes server instructions and 9 structured tools', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const { client, cleanup } = await createTestPair(
      new Map([['alice', new ASPClientImpl({ identityDir: alice.dir })]]),
    );

    expect(client.getInstructions()).toContain('external data');

    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(9);

    const inboxTool = tools.tools.find((tool) => tool.name === 'asp_check_inbox');
    expect(inboxTool?.outputSchema).toBeDefined();
    expect(inboxTool?.annotations?.readOnlyHint).toBe(true);

    await cleanup();
  });

  it('includes EXTERNAL DATA warning in inbox resource descriptions', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const { client, cleanup } = await createTestPair(
      new Map([['alice', new ASPClientImpl({ identityDir: alice.dir })]]),
    );

    const resources = await client.listResources();
    const inboxRes = resources.resources.find((r) => r.uri.includes('/inbox'));

    expect(inboxRes?.description).toContain('EXTERNAL DATA');

    await cleanup();
  });

  it('lists static and template-backed local resources', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const { client, cleanup } = await createTestPair(
      new Map([['alice', new ASPClientImpl({ identityDir: alice.dir })]]),
    );

    const resources = await client.listResources();
    const uris = resources.resources.map((resource) => resource.uri);
    expect(uris).toContain('asp://runtime/capabilities');
    expect(uris).toContain('asp://identities');
    expect(uris).toContain('asp://identity/alice/summary');
    expect(uris).toContain('asp://identity/alice/manifest');
    expect(uris).toContain('asp://identity/alice/inbox');

    const templates = await client.listResourceTemplates();
    const templateUris = templates.resourceTemplates.map((template) => template.uriTemplate);
    expect(templateUris).toContain('asp://identity/{handle}/summary');
    expect(templateUris).toContain('asp://identity/{handle}/manifest');
    expect(templateUris).toContain('asp://identity/{handle}/inbox');

    await cleanup();
  });

  it('reads the runtime capabilities resource', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const { client, cleanup } = await createTestPair(
      new Map([['alice', new ASPClientImpl({ identityDir: alice.dir })]]),
    );

    const result = await client.readResource({ uri: 'asp://runtime/capabilities' });
    const payload = JSON.parse(result.contents[0].text) as {
      contract: string;
      notifications: { kind: string };
      inbox: { exposure: { mcp: boolean } };
    };

    expect(payload.contract).toBe('asp-surfaces/1');
    expect(payload.notifications.kind).toBe('local-aggregate');
    expect(payload.inbox.exposure.mcp).toBe(true);

    await cleanup();
  });

  it('reads the loaded identities resource with resource URIs', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const { client, cleanup } = await createTestPair(
      new Map([['alice', new ASPClientImpl({ identityDir: alice.dir })]]),
    );

    const result = await client.readResource({ uri: 'asp://identities' });
    const payload = JSON.parse(result.contents[0].text) as {
      identities: Array<{ handle: string; resources: { summary: string; manifest: string; inbox: string } }>;
    };

    expect(payload.identities).toHaveLength(1);
    expect(payload.identities[0].handle).toBe('@alice');
    expect(payload.identities[0].resources.summary).toBe('asp://identity/alice/summary');
    expect(payload.identities[0].resources.manifest).toBe('asp://identity/alice/manifest');

    await cleanup();
  });

  it('reads summary, manifest, and inbox resources for a local identity', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const messages = [
      {
        id: 'msg-1',
        from: 'https://bob.asp.social',
        to: 'https://alice.asp.social',
        timestamp: new Date().toISOString(),
        intent: 'chat',
        content: { text: 'Hi Alice' },
        initiated_by: 'agent',
      },
    ];

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: unknown) => {
      if (String(url).includes('/asp/inbox')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ entries: messages.map(messageToInboxEntry), next_cursor: null }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }));

    const { client, cleanup } = await createTestPair(
      new Map([['alice', new ASPClientImpl({ identityDir: alice.dir })]]),
    );

    const summaryResult = await client.readResource({ uri: 'asp://identity/alice/summary' });
    const summary = JSON.parse(summaryResult.contents[0].text) as {
      handle: string;
      bio: string;
      behavior: {
        autonomy_level: string;
        social_style: string;
        auto_actions: string[];
        auto_notify_actions: string[];
        confirmation_required_for: string[];
        denied_actions: string[];
      } | null;
      resources: { summary: string };
    };
    expect(summary.handle).toBe('@alice');
    expect(summary.bio).toBe('Test agent Alice');
    expect(summary.behavior?.autonomy_level).toBe('medium');
    expect(summary.behavior?.social_style).toBe('selective');
    expect(summary.behavior?.auto_actions).toContain('content_analysis');
    expect(summary.behavior?.auto_notify_actions).toContain('auto_reply_simple');
    expect(summary.behavior?.confirmation_required_for).toContain('publish_content');
    expect(summary.behavior?.denied_actions).toEqual([]);
    expect(summary.resources.summary).toBe('asp://identity/alice/summary');

    const manifestResult = await client.readResource({ uri: 'asp://identity/alice/manifest' });
    const manifest = JSON.parse(manifestResult.contents[0].text) as { entity: { handle: string } };
    expect(manifest.entity.handle).toBe('@alice');

    const inboxResult = await client.readResource({ uri: 'asp://identity/alice/inbox' });
    const inbox = JSON.parse(inboxResult.contents[0].text) as { identity: string; count: number; entries: unknown[] };
    expect(inbox.identity).toBe('alice');
    expect(inbox.count).toBe(1);
    expect(inbox.entries).toHaveLength(1);

    await cleanup();
  });

  it('returns structured content and resource links from asp_list_identities', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const { client, cleanup } = await createTestPair(
      new Map([['alice', new ASPClientImpl({ identityDir: alice.dir })]]),
    );

    const result = await client.callTool({ name: 'asp_list_identities', arguments: {} });
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as {
      identities: Array<{
        handle: string;
        behavior: { autonomy_level: string; denied_actions: string[] } | null;
        resources: { summary: string; manifest: string };
      }>;
    };
    expect(structured.identities[0].resources.summary).toBe('asp://identity/alice/summary');
    expect(structured.identities[0].resources.manifest).toBe('asp://identity/alice/manifest');
    expect(structured.identities[0].behavior?.autonomy_level).toBe('medium');
    expect(structured.identities[0].behavior?.denied_actions).toEqual([]);

    const resourceLink = result.content.find((block) => block.type === 'resource_link');
    expect(resourceLink && 'uri' in resourceLink ? resourceLink.uri : undefined).toBe('asp://identity/alice/summary');

    await cleanup();
  });

  it('describes asp_list_identities resource links as optional convenience links', () => {
    const tool = TOOL_DEFINITIONS.find((entry) => entry.name === 'asp_list_identities');
    expect(tool?.description).toContain('Resource links are optional');
    expect(tool?.description).toContain('structured response');
  });

  it('returns structured content from asp_whois', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const manifest = {
      protocol: 'asp/1.0',
      entity: {
        id: 'https://bob.asp.social',
        type: 'agent',
        name: 'Bob',
        handle: '@bob',
        bio: 'Bob agent',
        languages: ['en'],
        created_at: new Date().toISOString(),
      },
      relationships: [],
      capabilities: ['feed', 'inbox'],
      endpoints: { feed: '/asp/feed', inbox: '/asp/inbox' },
      verification: { public_key: 'ed25519:test' },
    };

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: unknown) => {
      if (String(url).includes('/.well-known/asp.yaml')) {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'application/json' },
          text: () => Promise.resolve(JSON.stringify(manifest)),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }));

    const { client, cleanup } = await createTestPair(
      new Map([['alice', new ASPClientImpl({ identityDir: alice.dir })]]),
    );

    const result = await client.callTool({ name: 'asp_whois', arguments: { target: '@bob' } });
    expect((result.structuredContent as { entity: { handle: string } }).entity.handle).toBe('@bob');
    expect(parseJsonText(result).entity).toBeDefined();

    await cleanup();
  });

  it('resolves account identifiers through WebFinger in asp_whois', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const manifest = {
      protocol: 'asp/1.0',
      entity: {
        id: 'https://social.example.com/alice',
        type: 'agent',
        name: 'Alice Remote',
        handle: '@alice',
        bio: 'Remote Alice',
        languages: ['en'],
        created_at: new Date().toISOString(),
      },
      relationships: [],
      capabilities: ['feed', 'inbox'],
      endpoints: { feed: '/asp/feed', inbox: '/asp/inbox' },
      verification: { public_key: 'ed25519:test' },
    };

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: unknown) => {
      if (String(url) === 'https://example.com/.well-known/webfinger?resource=acct%3Aalice%40example.com') {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'application/jrd+json' },
          json: () => Promise.resolve({
            subject: 'acct:alice@example.com',
            links: [
              {
                rel: 'urn:asp:rel:endpoint',
                href: 'https://social.example.com/alice',
              },
            ],
          }),
        });
      }
      if (String(url) === 'https://social.example.com/alice/.well-known/asp.yaml') {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'application/json' },
          text: () => Promise.resolve(JSON.stringify(manifest)),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }));

    const { client, cleanup } = await createTestPair(
      new Map([['alice', new ASPClientImpl({ identityDir: alice.dir })]]),
    );

    const result = await client.callTool({ name: 'asp_whois', arguments: { target: 'alice@example.com' } });
    const entity = (result.structuredContent as { entity: { id: string } }).entity;
    expect(entity.id).toBe('https://social.example.com/alice');

    await cleanup();
  });

  it('returns structured content from asp_send_message', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);
    const bobKeys = generateKeyPair();
    const bobManifest = createDefaultManifest({
      id: 'https://bob.asp.social',
      type: 'agent',
      name: 'Bob',
      handle: '@bob',
      bio: 'Test agent Bob',
      languages: ['en'],
      publicKey: bobKeys.publicKey,
    });

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: unknown) => {
      if (String(url) === 'https://bob.asp.social/.well-known/asp.yaml') {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'application/json' },
          text: () => Promise.resolve(JSON.stringify(bobManifest)),
        });
      }
      if (String(url).includes('/asp/inbox')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }));

    const { client, cleanup } = await createTestPair(
      new Map([['alice', new ASPClientImpl({ identityDir: alice.dir })]]),
    );

    const result = await client.callTool({
      name: 'asp_send_message',
      arguments: { to: '@bob', intent: 'chat', text: 'Hello Bob!' },
    });

    const structured = result.structuredContent as { sent: boolean; identity: string; to: string };
    expect(structured.sent).toBe(true);
    expect(structured.identity).toBe('alice');
    expect(structured.to).toContain('bob.asp.social');

    await cleanup();
  });

  it('surfaces invalid single-identity overrides instead of silently ignoring them', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const { client, cleanup } = await createTestPair(
      new Map([['alice', new ASPClientImpl({ identityDir: alice.dir })]]),
    );

    const result = await client.callTool({
      name: 'asp_check_inbox',
      arguments: { identity: 'other' },
    });

    const payload = parseJsonText(result) as { error: string };
    expect(result.isError).toBe(true);
    expect(payload.error).toContain('Identity "other" not found');

    await cleanup();
  });

  it('returns an explicit error when multiple identities are loaded and no identity is specified', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    const bob = makeTempIdentity('@bob', 'Bob');
    tempDirs.push(alice.dir, bob.dir);

    const { client, cleanup } = await createTestPair(
      new Map([
        ['alice', new ASPClientImpl({ identityDir: alice.dir })],
        ['bob', new ASPClientImpl({ identityDir: bob.dir })],
      ]),
    );

    const result = await client.callTool({ name: 'asp_check_inbox', arguments: {} });
    const payload = parseJsonText(result) as { error: string };

    expect(result.isError).toBe(true);
    expect(payload.error).toContain('Multiple identities loaded');

    await cleanup();
  });

  it('surfaces HTTP errors from inbox reads instead of returning empty snapshots', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: unknown) => {
      if (String(url).includes('/asp/inbox')) {
        return Promise.resolve({
          ok: false,
          status: 403,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ error: 'Inbox restricted' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'Inbox restricted' })),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }));

    const { client, cleanup } = await createTestPair(
      new Map([['alice', new ASPClientImpl({ identityDir: alice.dir })]]),
    );

    const result = await client.callTool({ name: 'asp_check_inbox', arguments: {} });
    const payload = parseJsonText(result) as { error: string };

    expect(result.isError).toBe(true);
    expect(payload.error).toContain('403');
    expect(payload.error).toContain('Inbox restricted');

    await cleanup();
  });

  it('validates asp_search inputs through schema validation', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const { client, cleanup } = await createTestPair(
      new Map([['alice', new ASPClientImpl({ identityDir: alice.dir })]]),
    );

    const result = await client.callTool({ name: 'asp_search', arguments: { q: 'ab' } });
    const text = result.content.find((block) => block.type === 'text' && 'text' in block)?.text ?? '';

    expect(result.isError).toBe(true);
    expect(text).toContain('at least 3 characters');

    await cleanup();
  });

  it('returns structured content from asp_search', async () => {
    const alice = makeTempIdentity('@alice', 'Alice');
    tempDirs.push(alice.dir);

    const searchResults = [
      { endpoint: 'https://bob.asp.social', handle: '@bob', name: 'Bob', type: 'agent' },
    ];

    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
      if (String(url).includes('/search?')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ results: searchResults }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { client, cleanup } = await createTestPair(
      new Map([['alice', new ASPClientImpl({
        identityDir: alice.dir,
        transport: new HostedASPTransport({ coreIndexUrl: 'https://index.example' }),
      })]]),
    );

    const result = await client.callTool({
      name: 'asp_search',
      arguments: { q: 'bob', skills: 'translation', tags: 'ai,ml' },
    });
    const structured = result.structuredContent as { count: number; results: typeof searchResults };

    expect(structured.count).toBe(1);
    expect(structured.results[0].handle).toBe('@bob');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [input] = fetchMock.mock.calls[0] as [string];
    const url = new URL(input);
    expect(url.searchParams.get('skills')).toBe('translation');
    expect(url.searchParams.get('tags')).toBe('ai,ml');
    expect(url.searchParams.get('skill')).toBeNull();
    expect(url.searchParams.get('tag')).toBeNull();

    await cleanup();
  });
});
