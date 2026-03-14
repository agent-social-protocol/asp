import { existsSync } from 'node:fs';
import { getStorePaths } from './index.js';
import { loadYaml, dumpYaml } from '../utils/yaml.js';
import type { FeedEntry } from '../models/feed-entry.js';

interface FeedFile {
  entries: FeedEntry[];
}

export async function readFeed(): Promise<FeedEntry[]> {
  const { feedPath } = getStorePaths();
  if (!existsSync(feedPath)) return [];
  const data = await loadYaml<FeedFile>(feedPath);
  return data?.entries || [];
}

export async function writeFeed(entries: FeedEntry[]): Promise<void> {
  await dumpYaml(getStorePaths().feedPath, { entries });
}

export async function prependEntry(entry: FeedEntry): Promise<void> {
  const entries = await readFeed();
  entries.unshift(entry);
  await writeFeed(entries);
}

export async function updateEntry(id: string, updates: Partial<Pick<FeedEntry, 'title' | 'summary' | 'topics'>>): Promise<FeedEntry | null> {
  const entries = await readFeed();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;
  if (updates.title) entry.title = updates.title;
  if (updates.summary) entry.summary = updates.summary;
  if (updates.topics) entry.topics = updates.topics;
  entry.updated = new Date().toISOString();
  await writeFeed(entries);
  return entry;
}

export async function deleteEntry(id: string): Promise<boolean> {
  const entries = await readFeed();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  await writeFeed(entries);
  return true;
}
