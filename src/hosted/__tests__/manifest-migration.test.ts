import { describe, expect, it } from 'vitest';
import { migrateLegacyHostedManifest } from '../manifest-migration.js';
import type { Manifest } from '../../models/manifest.js';

const LEGACY_HOSTED_DOMAIN = 'legacy-hosted.example';

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
      id: `https://alice.${LEGACY_HOSTED_DOMAIN}`,
    },
    endpoints: {
      feed: `https://alice.${LEGACY_HOSTED_DOMAIN}/asp/feed`,
      inbox: `https://alice.${LEGACY_HOSTED_DOMAIN}/asp/inbox`,
      stream: `https://alice.${LEGACY_HOSTED_DOMAIN}/asp/ws`,
      reputation: `https://alice.${LEGACY_HOSTED_DOMAIN}/asp/reputation`,
    },
  };
}

describe('migrateLegacyHostedManifest', () => {
  it('rewrites a configured legacy hosted endpoint to the canonical hosted endpoint', () => {
    const manifest = makeLegacyHostedManifest();

    const result = migrateLegacyHostedManifest(manifest, {
      legacyHostedDomains: [LEGACY_HOSTED_DOMAIN],
    });

    expect(result).toEqual({
      ok: true,
      updated: true,
      previousEndpoint: `https://alice.${LEGACY_HOSTED_DOMAIN}`,
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

    const result = migrateLegacyHostedManifest(manifest, {
      legacyHostedDomains: [LEGACY_HOSTED_DOMAIN],
    });

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

    const result = migrateLegacyHostedManifest(manifest, {
      legacyHostedDomains: [LEGACY_HOSTED_DOMAIN],
    });

    expect(result).toEqual({
      ok: false,
      error: `Local manifest handle "bob" does not match hosted endpoint "https://alice.${LEGACY_HOSTED_DOMAIN}".`,
    });
    expect(manifest.entity.id).toBe(`https://alice.${LEGACY_HOSTED_DOMAIN}`);
  });
});
