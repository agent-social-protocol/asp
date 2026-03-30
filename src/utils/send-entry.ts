import type { InboxEntry } from '../models/inbox-entry.js';
import { buildEndpointUrl } from './endpoint-url.js';
import { fetchWithTimeout } from './fetch-with-timeout.js';

const SEND_ENTRY_TIMEOUT_MS = 8_000;

export async function sendEntry(endpointUrl: string, entry: InboxEntry): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = buildEndpointUrl(endpointUrl, '/asp/inbox');
    const res = await fetchWithTimeout(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }, SEND_ENTRY_TIMEOUT_MS);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
