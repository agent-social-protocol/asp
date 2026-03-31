import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '../../models/manifest.js';

function makeHostedManifest(): Manifest {
  return {
    protocol: 'asp/1.0',
    entity: {
      id: 'https://alice.asp.social',
      type: 'person',
      name: 'Alice',
      handle: 'alice',
      bio: 'Original bio',
      tags: ['founder'],
      languages: ['en'],
      created_at: '2026-03-01T00:00:00.000Z',
    },
    relationships: [],
    capabilities: ['feed', 'inbox'],
    skills: ['networking'],
    endpoints: {
      feed: '/asp/feed',
      inbox: '/asp/inbox',
    },
    verification: {
      public_key: 'ed25519:test',
    },
  };
}

function makeLegacyHostedManifest(): Manifest {
  return {
    ...makeHostedManifest(),
    entity: {
      ...makeHostedManifest().entity,
      id: 'https://alice.letus.social',
    },
    endpoints: {
      feed: 'https://alice.letus.social/asp/feed',
      inbox: 'https://alice.letus.social/asp/inbox',
      stream: 'https://alice.letus.social/asp/ws',
    },
  };
}

async function loadIdentityCommand(mocks: {
  manifest: Manifest;
  syncResult?: {
    hubResult: { ok: boolean; error?: string } | null;
    indexResults: Array<{ url: string; ok: boolean; error?: string }>;
  };
}) {
  const readManifest = vi.fn().mockResolvedValue(structuredClone(mocks.manifest));
  const writeManifest = vi.fn().mockResolvedValue(undefined);
  const output = vi.fn();
  const prompt = vi.fn();
  const closePrompts = vi.fn();
  const syncHostedManifestTargets = vi.fn().mockResolvedValue(
    mocks.syncResult ?? {
      hubResult: { ok: true },
      indexResults: [{ url: 'https://aspnetwork.dev', ok: true }],
    },
  );

  vi.doMock('../../store/index.js', () => ({
    storeInitialized: vi.fn().mockReturnValue(true),
  }));
  vi.doMock('../../store/manifest-store.js', () => ({
    readManifest,
    writeManifest,
  }));
  vi.doMock('../../utils/output.js', () => ({
    output,
  }));
  vi.doMock('../../utils/prompts.js', () => ({
    prompt,
    closePrompts,
  }));
  vi.doMock('../../hosted/onboarding.js', () => ({
    syncHostedManifestTargets,
  }));

  const { identityCommand } = await import('../identity.js');

  return {
    identityCommand,
    readManifest,
    writeManifest,
    output,
    prompt,
    closePrompts,
    syncHostedManifestTargets,
  };
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('identity edit', () => {
  it('syncs hosted manifest changes after updating the local manifest', async () => {
    const manifest = makeHostedManifest();
    const {
      identityCommand,
      writeManifest,
      prompt,
      syncHostedManifestTargets,
    } = await loadIdentityCommand({ manifest });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    await identityCommand.parseAsync([
      'edit',
      '--name', 'Updated Alice',
      '--bio', 'Updated bio',
      '--languages', 'en,fr',
      '--type', 'person',
      '--tags', 'ai,builders',
      '--skills', 'research,writing',
      '--clear-represents',
    ], { from: 'user' });

    expect(prompt).not.toHaveBeenCalled();
    expect(writeManifest).toHaveBeenCalledTimes(1);
    const updatedManifest = writeManifest.mock.calls[0][0] as Manifest;
    expect(updatedManifest.entity.name).toBe('Updated Alice');
    expect(updatedManifest.entity.bio).toBe('Updated bio');
    expect(updatedManifest.entity.languages).toEqual(['en', 'fr']);
    expect(updatedManifest.entity.handle).toBe('alice');
    expect(updatedManifest.entity.id).toBe('https://alice.asp.social');
    expect(updatedManifest.entity.tags).toEqual(['ai', 'builders']);
    expect(updatedManifest.skills).toEqual(['research', 'writing']);
    expect(syncHostedManifestTargets).toHaveBeenCalledWith(updatedManifest);
    expect(process.exitCode).toBeUndefined();
  });

  it.each([
    {
      label: 'handle',
      args: ['--handle', '@renamed'],
      expected: 'Hosted identities cannot change handle locally',
    },
    {
      label: 'endpoint',
      args: ['--id', 'https://renamed.example'],
      expected: 'Hosted identities cannot change endpoint locally',
    },
  ])('rejects hosted $label changes before writing local state', async ({ args, expected }) => {
    const manifest = makeHostedManifest();
    const {
      identityCommand,
      writeManifest,
      output,
      prompt,
      syncHostedManifestTargets,
    } = await loadIdentityCommand({ manifest });

    await identityCommand.parseAsync(['edit', ...args], { from: 'user' });

    expect(prompt).not.toHaveBeenCalled();
    expect(writeManifest).not.toHaveBeenCalled();
    expect(syncHostedManifestTargets).not.toHaveBeenCalled();
    expect(output).toHaveBeenCalledTimes(1);
    expect(output.mock.calls[0][0]).toContain(expected);
    expect(process.exitCode).toBe(1);
  });
});

describe('identity migrate-hosted-endpoint', () => {
  it('rewrites a legacy letus.social hosted identity to the canonical asp.social endpoint and syncs it', async () => {
    const manifest = makeLegacyHostedManifest();
    const {
      identityCommand,
      writeManifest,
      syncHostedManifestTargets,
    } = await loadIdentityCommand({ manifest });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    await identityCommand.parseAsync([
      'migrate-hosted-endpoint',
    ], { from: 'user' });

    expect(writeManifest).toHaveBeenCalledTimes(1);
    const updatedManifest = writeManifest.mock.calls[0][0] as Manifest;
    expect(updatedManifest.entity.id).toBe('https://alice.asp.social');
    expect(updatedManifest.endpoints).toEqual({
      feed: 'https://alice.asp.social/asp/feed',
      inbox: 'https://alice.asp.social/asp/inbox',
      stream: 'https://alice.asp.social/asp/ws',
    });
    expect(syncHostedManifestTargets).toHaveBeenCalledWith(updatedManifest);
    expect(process.exitCode).toBeUndefined();
  });
});
