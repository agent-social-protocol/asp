import { writeFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { buildHostedEndpoint, normalizeHandle } from '../config/hosted.js';
import type { Manifest } from '../models/manifest.js';

const DEFAULT_HOSTED_ALIAS_DOMAINS = ['letus.social'] as const;

type HostedAliasManifestRewriteOptions = {
  hostedAliasDomains?: readonly string[];
};

function normalizeHostedAliasDomains(domains: readonly string[] | undefined): string[] {
  return (domains ?? [])
    .map((domain) => typeof domain === 'string' ? domain.trim().toLowerCase() : '')
    .filter((domain) => domain.length > 0);
}

function getHostedAliasDomains(explicitDomains?: readonly string[]): string[] {
  if (explicitDomains !== undefined) {
    const normalizedExplicitDomains = normalizeHostedAliasDomains(explicitDomains);
    return normalizedExplicitDomains;
  }

  const envDomains = normalizeHostedAliasDomains(
    process.env.ASP_HOSTED_ALIAS_DOMAINS?.split(','),
  );
  if (envDomains.length > 0) {
    return envDomains;
  }

  return [...DEFAULT_HOSTED_ALIAS_DOMAINS];
}

function parseHostedAliasEndpoint(
  endpoint: string,
  hostedAliasDomains: readonly string[] = getHostedAliasDomains(),
): { handle: string; domain: string } | null {
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase();
    for (const domain of hostedAliasDomains) {
      const suffix = `.${domain}`;
      if (hostname.endsWith(suffix) && hostname !== domain) {
        return {
          handle: hostname.slice(0, -suffix.length),
          domain,
        };
      }
    }
  } catch (error) {
    if (error instanceof TypeError) {
      return null;
    }
    throw error;
  }

  return null;
}

function rewriteAbsoluteEndpoint(value: string, previousEndpoint: string, nextEndpoint: string): string {
  if (value === previousEndpoint) {
    return nextEndpoint;
  }
  if (value.startsWith(`${previousEndpoint}/`)) {
    return `${nextEndpoint}${value.slice(previousEndpoint.length)}`;
  }
  return value;
}

export function rewriteHostedAliasManifestToCanonicalEndpoint(
  manifest: Manifest,
  options: HostedAliasManifestRewriteOptions = {},
): { ok: true; updated: boolean; previousEndpoint?: string; nextEndpoint?: string; rewrittenEndpointFields: string[] }
 | { ok: false; error: string } {
  const alias = parseHostedAliasEndpoint(
    manifest.entity.id,
    getHostedAliasDomains(options.hostedAliasDomains),
  );
  if (!alias) {
    return { ok: true, updated: false, rewrittenEndpointFields: [] };
  }

  const normalizedHandle = normalizeHandle(manifest.entity.handle).trim();
  if (!normalizedHandle) {
    return { ok: false, error: 'Local manifest is missing a hosted handle.' };
  }
  if (alias.handle !== normalizedHandle) {
    return {
      ok: false,
      error: `Local manifest handle "${manifest.entity.handle}" does not match hosted endpoint "${manifest.entity.id}".`,
    };
  }

  const previousEndpoint = manifest.entity.id;
  const nextEndpoint = buildHostedEndpoint(normalizedHandle);
  if (nextEndpoint === previousEndpoint) {
    return { ok: true, updated: false, rewrittenEndpointFields: [] };
  }

  manifest.entity.id = nextEndpoint;

  const rewrittenEndpointFields: string[] = [];
  for (const field of ['feed', 'inbox', 'stream', 'reputation'] as const) {
    const current = manifest.endpoints?.[field];
    if (typeof current !== 'string') continue;
    const rewritten = rewriteAbsoluteEndpoint(current, previousEndpoint, nextEndpoint);
    if (rewritten === current) continue;
    manifest.endpoints[field] = rewritten;
    rewrittenEndpointFields.push(field);
  }

  return {
    ok: true,
    updated: true,
    previousEndpoint,
    nextEndpoint,
    rewrittenEndpointFields,
  };
}

export function autoRewriteHostedAliasManifestFile(
  manifestPath: string,
  manifest: Manifest,
  options: HostedAliasManifestRewriteOptions = {},
): void {
  const migration = rewriteHostedAliasManifestToCanonicalEndpoint(manifest, options);
  if (!migration.ok) {
    throw new Error(migration.error);
  }
  if (!migration.updated) {
    return;
  }

  const nextRaw = yaml.dump(manifest, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
  writeFileSync(manifestPath, nextRaw, 'utf-8');
}
