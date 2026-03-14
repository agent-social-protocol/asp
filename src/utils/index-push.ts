import { readIndexes, updateSyncTime } from '../store/index-store.js';
import { signedRegisterBody } from './remote-auth.js';

export async function pushManifestToIndexes(
  endpoint: string,
): Promise<Array<{ url: string; ok: boolean; error?: string }>> {
  const indexes = await readIndexes();
  if (indexes.length === 0) return [];

  const results: Array<{ url: string; ok: boolean; error?: string }> = [];

  for (const idx of indexes) {
    try {
      const registerUrl = new URL('/register', idx.url);
      const res = await fetch(registerUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await signedRegisterBody(endpoint),
      });
      if (res.ok) {
        await updateSyncTime(idx.url);
        results.push({ url: idx.url, ok: true });
      } else {
        results.push({ url: idx.url, ok: false, error: `HTTP ${res.status}` });
      }
    } catch (err) {
      results.push({ url: idx.url, ok: false, error: (err as Error).message });
    }
  }

  return results;
}
