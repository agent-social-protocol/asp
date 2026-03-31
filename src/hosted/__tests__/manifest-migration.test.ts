import { describe, expect, it } from 'vitest';
import { migrateLegacyHostedManifest } from '../manifest-migration.js';
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
      reputation: 'https://alice.letus.social/asp/reputation',
    },
  };
}

describe('migrateLegacyHostedManifest', () => {
  it('rewrites legacy letus.social hosted endpoints to asp.social', () => {
    const manifest = makeLegacyHostedManifest();

    const result = migrateLegacyHostedManifest(manifest);

    expect(result).toEqual({
      ok: true,
      updated: true,
      previousEndpoint: 'https://alice.letus.social',
      nextEndpoint: 'https://alice.asp.social',
      rewrittenEndpointFields: ['feed', 'inbox', 'stream', 'reputation'],
    });
    expect(manifest.entity.id).toBe('https://alice.asp.social');
    expect(manifest.endpoints).toEqual({
      feed: 'https://alice.asp.social/asp/feed',
      inbox: 'https://alice.asp.social/asp/inbox',
      stream: 'https://alice.asp.social/asp/ws',
      reputation: 'https://alice.asp.social/asp/reputation',
    });
  });

  it('returns unchanged for already-canonical manifests', () => {
    const manifest = makeHostedManifest();

    const result = migrateLegacyHostedManifest(manifest);

    expect(result).toEqual({
      ok: true,
      updated: false,
      rewrittenEndpointFields: [],
    });
    expect(manifest.entity.id).toBe('https://alice.asp.social');
  });

  it('fails when the manifest handle does not match the legacy endpoint', () => {
    const manifest = makeLegacyHostedManifest();
    manifest.entity.handle = 'bob';

    const result = migrateLegacyHostedManifest(manifest);

    expect(result).toEqual({
      ok: false,
      error: 'Local manifest handle "bob" does not match hosted endpoint "https://alice.letus.social".',
    });
    expect(manifest.entity.id).toBe('https://alice.letus.social');
  });
});
