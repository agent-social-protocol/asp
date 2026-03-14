import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import yaml from 'js-yaml';
import { getStorePaths } from './index.js';

export interface IndexEntry {
  url: string;
  added_at: string;
  last_synced?: string;
}

interface IndexesFile {
  indexes: IndexEntry[];
}

export async function readIndexes(): Promise<IndexEntry[]> {
  const { indexesPath } = getStorePaths();
  if (!existsSync(indexesPath)) return [];
  const raw = await readFile(indexesPath, 'utf-8');
  const data = yaml.load(raw) as IndexesFile | null;
  return data?.indexes ?? [];
}

export async function writeIndexes(indexes: IndexEntry[]): Promise<void> {
  const data: IndexesFile = { indexes };
  await writeFile(getStorePaths().indexesPath, yaml.dump(data), 'utf-8');
}

export async function addIndex(url: string): Promise<IndexEntry> {
  const indexes = await readIndexes();
  const existing = indexes.find(i => i.url === url);
  if (existing) return existing;
  const entry: IndexEntry = { url, added_at: new Date().toISOString() };
  indexes.push(entry);
  await writeIndexes(indexes);
  return entry;
}

export async function removeIndex(url: string): Promise<boolean> {
  const indexes = await readIndexes();
  const filtered = indexes.filter(i => i.url !== url);
  if (filtered.length === indexes.length) return false;
  await writeIndexes(filtered);
  return true;
}

export async function updateSyncTime(url: string): Promise<void> {
  const indexes = await readIndexes();
  const entry = indexes.find(i => i.url === url);
  if (entry) {
    entry.last_synced = new Date().toISOString();
    await writeIndexes(indexes);
  }
}
