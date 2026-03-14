import { prompt } from './prompts.js';
import type { Manifest } from '../models/manifest.js';
import { buildHostedEndpoint, getHostedRuntimeConfig } from '../config/hosted.js';

export async function registerWithHub(
  handle: string,
  manifest: Manifest,
  publicKey: string
): Promise<{ ok: boolean; status?: number; error?: string; suggestions?: string[] }> {
  const hubApiBaseUrl = getHostedRuntimeConfig().hubApiBaseUrl;
  try {
    const res = await fetch(`${hubApiBaseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, manifest, public_key: publicKey }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (res.ok) return { ok: true };
    return {
      ok: false,
      status: res.status,
      error: (data.error as string) || 'Registration failed',
      suggestions: data.suggestions as string[] | undefined,
    };
  } catch (err) {
    return { ok: false, error: `Network error: ${(err as Error).message}` };
  }
}

export async function registerWithHubRetry(
  handle: string,
  manifest: Manifest,
  publicKey: string
): Promise<{ handle: string; registered: boolean }> {
  let regResult = await registerWithHub(handle, manifest, publicKey);

  while (!regResult.ok && regResult.status === 409) {
    // Skip interactive retry when stdin is not a TTY (e.g. piped subprocess)
    if (!process.stdin.isTTY) break;
    const suggestionsText = regResult.suggestions?.length
      ? ` Suggestions: ${regResult.suggestions.join(', ')}`
      : '';
    console.log(`Handle @${handle} is taken.${suggestionsText}`);
    handle = await prompt('Choose another handle');
    handle = handle.replace(/^@/, '');
    manifest.entity.handle = handle;
    manifest.entity.id = buildHostedEndpoint(handle);
    regResult = await registerWithHub(handle, manifest, publicKey);
  }

  if (!regResult.ok) {
    console.log(`Warning: Could not register with Hub (${regResult.error}). Local identity created.`);
    return { handle, registered: false };
  }

  return { handle, registered: true };
}
