// src/utils/remote-auth.ts
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { signPayload } from './crypto.js';
import { getStorePaths } from '../store/index.js';
import { readManifest } from '../store/manifest-store.js';
import { handleFromHostedEndpoint, isHostedEndpoint } from '../config/hosted.js';

/**
 * Check if the current identity is hosted on the configured hosted domain.
 */
export async function isHosted(): Promise<boolean> {
  const manifest = await readManifest();
  if (!manifest) return false;
  return isHostedEndpoint(manifest.entity.id);
}

/**
 * Get the handle from a configured hosted endpoint URL.
 */
export function handleFromEndpoint(endpoint: string): string | null {
  return handleFromHostedEndpoint(endpoint);
}

/**
 * Build Authorization header for Hub API calls.
 */
export async function buildAuthHeader(method: string, path: string): Promise<string> {
  const manifest = await readManifest();
  if (!manifest) throw new Error('Not initialized');

  if (!isHostedEndpoint(manifest.entity.id)) throw new Error('Not a hosted identity');

  const { privateKeyPath } = getStorePaths();
  const privateKeyPem = await readFile(privateKeyPath, 'utf-8');
  const endpoint = manifest.entity.id;
  const timestamp = String(Date.now());
  const payload = `${endpoint}:${timestamp}:${method}:${path}`;
  const signature = signPayload(payload, privateKeyPem);

  return `ASP-Sig ${endpoint}:${timestamp}:${signature}`;
}

/**
 * Build signed registration body for ASP Index POST /register.
 */
export async function signedRegisterBody(endpoint: string): Promise<string> {
  const { privateKeyPath } = getStorePaths();
  if (!existsSync(privateKeyPath)) {
    throw new Error('Private key not found. Run `asp init` first.');
  }
  const privateKeyPem = await readFile(privateKeyPath, 'utf-8');
  const timestamp = Date.now();
  const signature = signPayload(`${endpoint}:${timestamp}`, privateKeyPem);
  return JSON.stringify({ endpoint, timestamp, signature });
}
