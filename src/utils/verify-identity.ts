import yaml from 'js-yaml';
import { isManifest, type Manifest } from '../models/manifest.js';
import { buildEndpointUrl } from './endpoint-url.js';
import { fetchWithTimeout } from './fetch-with-timeout.js';

/**
 * Fetch an ASP manifest from a base URL.
 * Looks for it at /.well-known/asp.yaml and supports both YAML and JSON responses.
 * Returns null if unreachable, non-OK, or fails the isManifest() type guard.
 */
export async function fetchManifest(baseUrl: string): Promise<Manifest | null> {
  try {
    const url = buildEndpointUrl(baseUrl, '/.well-known/asp.yaml');
    const res = await fetchWithTimeout(url.toString(), {
      headers: { Accept: 'application/yaml, application/json' },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const contentType = res.headers.get('content-type') || '';
    const parsed = contentType.includes('json')
      ? JSON.parse(text)
      : yaml.load(text);
    if (!isManifest(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Dual verification: verify that agentUrl is truly owned by claimedRepresents.
 * Fetches the manifest of the claimed entity and checks whether the agent URL
 * appears in the entity's relationships with type "owns".
 */
export async function verifyRepresentation(agentUrl: string, claimedRepresents: string): Promise<boolean> {
  const manifest = await fetchManifest(claimedRepresents);
  if (!manifest) return false;
  return manifest.relationships.some(r => r.type === 'owns' && r.target === agentUrl);
}

/**
 * Verify that an entity is reachable and has a valid ASP manifest.
 * Returns the manifest if valid, or an error description if not.
 */
export async function verifyEntity(entityUrl: string): Promise<{ valid: boolean; manifest?: Manifest; error?: string }> {
  const manifest = await fetchManifest(entityUrl);
  if (!manifest) return { valid: false, error: 'Could not fetch manifest' };
  if (!manifest.protocol || !manifest.entity?.id) return { valid: false, error: 'Invalid manifest format' };
  return { valid: true, manifest };
}
