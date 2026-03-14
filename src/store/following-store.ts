import { existsSync } from 'node:fs';
import { getStorePaths } from './index.js';
import { loadYaml, dumpYaml } from '../utils/yaml.js';
import type { Following } from '../models/following.js';

interface FollowingFile {
  following: Following[];
}

export async function readFollowing(): Promise<Following[]> {
  const { followingPath } = getStorePaths();
  if (!existsSync(followingPath)) return [];
  const data = await loadYaml<FollowingFile>(followingPath);
  return data?.following || [];
}

export async function writeFollowing(entries: Following[]): Promise<void> {
  await dumpYaml(getStorePaths().followingPath, { following: entries });
}

export async function addFollowing(entry: Following): Promise<void> {
  const entries = await readFollowing();
  const exists = entries.some((e) => e.url === entry.url);
  if (exists) throw new Error(`Already following ${entry.url}`);
  entries.push(entry);
  await writeFollowing(entries);
}

export async function removeFollowing(url: string): Promise<void> {
  const entries = await readFollowing();
  const filtered = entries.filter((e) => e.url !== url);
  if (filtered.length === entries.length) throw new Error(`Not following ${url}`);
  await writeFollowing(filtered);
}
