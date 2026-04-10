import { describe, expect, it } from 'vitest';
import { rewriteHostedAliasManifestToCanonicalEndpoint } from '../manifest-migration.js';
import type { Manifest } from '../../models/manifest.js';

const HOSTED_ALIAS_DOMAIN = 'brand-entry.example';

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
      id: `https://alice.${HOSTED_ALIAS_DOMAIN}`,
    },
    endpoints: {
      feed: `https://alice.${HOSTED_ALIAS_DOMAIN}/asp/feed`,
      inbox: `https://alice.${HOSTED_ALIAS_DOMAIN}/asp/inbox`,
      stream: `https://alice.${HOSTED_ALIAS_DOMAIN}/asp/ws`,
      reputation: `https://alice.${HOSTED_ALIAS_DOMAIN}/asp/reputation`,
    },
  };
}

describe('rewriteHostedAliasManifestToCanonicalEndpoint', () => {
  it('rewrites a configured hosted alias endpoint to the canonical hosted endpoint', () => {
    const manifest = makeLegacyHostedManifest();

    const result = rewriteHostedAliasManifestToCanonicalEndpoint(manifest, {
      hostedAliasDomains: [HOSTED_ALIAS_DOMAIN],
    });

    expect(result).toEqual({
      ok: true,
      updated: true,
      previousEndpoint: `https://alice.${HOSTED_ALIAS_DOMAIN}`,
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

    const result = rewriteHostedAliasManifestToCanonicalEndpoint(manifest, {
      hostedAliasDomains: [HOSTED_ALIAS_DOMAIN],
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

    const result = rewriteHostedAliasManifestToCanonicalEndpoint(manifest, {
      hostedAliasDomains: [HOSTED_ALIAS_DOMAIN],
    });

    expect(result).toEqual({
      ok: false,
      error: `Local manifest handle "bob" does not match hosted endpoint "https://alice.${HOSTED_ALIAS_DOMAIN}".`,
    });
    expect(manifest.entity.id).toBe(`https://alice.${HOSTED_ALIAS_DOMAIN}`);
  });
});
