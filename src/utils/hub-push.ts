import { buildAuthHeader, handleFromEndpoint } from './remote-auth.js';
import type { Manifest } from '../models/manifest.js';
import { buildHostedEndpoint } from '../config/hosted.js';

export async function pushManifestToHub(manifest: Manifest): Promise<{ ok: boolean; error?: string }> {
  const handle = handleFromEndpoint(manifest.entity.id);
  if (!handle) return { ok: false, error: 'Not a Hub-hosted identity' };

  const path = '/asp/manifest';
  const authHeader = await buildAuthHeader('PUT', path);
  const url = `${buildHostedEndpoint(handle)}${path}`;

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(manifest),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: false, error: (data.error as string) || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: `Network error: ${(err as Error).message}` };
  }
}
