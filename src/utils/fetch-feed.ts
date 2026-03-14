import yaml from 'js-yaml';
import type { FeedEntry } from '../models/feed-entry.js';
import { isFeedEntry } from '../models/feed-entry.js';
import { buildEndpointUrl } from './endpoint-url.js';
import { fetchWithTimeout } from './fetch-with-timeout.js';

export interface RemoteFeed {
  source: string;
  entries: FeedEntry[];
  error?: string;
}

export async function fetchFeed(baseUrl: string, opts?: { since?: string; topic?: string }): Promise<RemoteFeed> {
  const url = buildEndpointUrl(baseUrl, '/asp/feed');
  if (opts?.since) url.searchParams.set('since', opts.since);
  if (opts?.topic) url.searchParams.set('topic', opts.topic);

  try {
    const res = await fetchWithTimeout(url.toString(), {
      headers: { Accept: 'application/yaml, application/json' },
    });
    if (!res.ok) {
      return { source: baseUrl, entries: [], error: `HTTP ${res.status}` };
    }

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    let entries: FeedEntry[];

    if (contentType.includes('json')) {
      const data = JSON.parse(text);
      const raw = Array.isArray(data) ? data : data.entries || [];
      entries = raw.filter(isFeedEntry);
    } else {
      const data = yaml.load(text) as { entries?: FeedEntry[] } | FeedEntry[];
      const raw = Array.isArray(data) ? data : data?.entries || [];
      entries = raw.filter(isFeedEntry);
    }

    return { source: baseUrl, entries };
  } catch (err) {
    return { source: baseUrl, entries: [], error: (err as Error).message };
  }
}
