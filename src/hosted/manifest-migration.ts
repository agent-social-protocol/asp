import { writeFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { buildHostedEndpoint, normalizeHandle } from '../config/hosted.js';
import type { Manifest } from '../models/manifest.js';

const LEGACY_HOSTED_DOMAINS = ['letus.social'] as const;

function parseLegacyHostedEndpoint(endpoint: string): { handle: string; domain: string } | null {
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase();
    for (const domain of LEGACY_HOSTED_DOMAINS) {
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

export function migrateLegacyHostedManifest(
  manifest: Manifest,
): { ok: true; updated: boolean; previousEndpoint?: string; nextEndpoint?: string; rewrittenEndpointFields: string[] }
 | { ok: false; error: string } {
  const legacy = parseLegacyHostedEndpoint(manifest.entity.id);
  if (!legacy) {
    return { ok: true, updated: false, rewrittenEndpointFields: [] };
  }

  const normalizedHandle = normalizeHandle(manifest.entity.handle).trim();
  if (!normalizedHandle) {
    return { ok: false, error: 'Local manifest is missing a hosted handle.' };
  }
  if (legacy.handle !== normalizedHandle) {
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

export function autoMigrateLegacyHostedManifestFile(
  manifestPath: string,
  manifest: Manifest,
): void {
  const migration = migrateLegacyHostedManifest(manifest);
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
