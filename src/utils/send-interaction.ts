import yaml from 'js-yaml';
import type { Interaction } from '../models/interaction.js';
import { buildEndpointUrl } from './endpoint-url.js';
import { fetchWithTimeout } from './fetch-with-timeout.js';

export async function sendInteraction(endpointUrl: string, interaction: Interaction): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = buildEndpointUrl(endpointUrl, '/asp/interactions');
    const res = await fetchWithTimeout(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/yaml' },
      body: yaml.dump(interaction),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
