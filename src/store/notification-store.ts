import { existsSync } from 'node:fs';
import { getStorePaths } from './index.js';
import { loadYaml, dumpYaml } from '../utils/yaml.js';
import type { FeedEntry } from '../models/feed-entry.js';
import type { InboxEntry } from '../models/inbox-entry.js';

interface NotificationsFile {
  last_checked: string;
  new_posts: Array<FeedEntry & { source: string }>;
  new_entries: InboxEntry[];
}

export async function readNotifications(): Promise<NotificationsFile> {
  const { notificationsPath } = getStorePaths();
  if (!existsSync(notificationsPath)) {
    return { last_checked: new Date(0).toISOString(), new_posts: [], new_entries: [] };
  }
  const data = await loadYaml<NotificationsFile>(notificationsPath);
  return {
    last_checked: data?.last_checked || new Date(0).toISOString(),
    new_posts: data?.new_posts || [],
    new_entries: data?.new_entries || [],
  };
}

export async function writeNotifications(data: NotificationsFile): Promise<void> {
  await dumpYaml(getStorePaths().notificationsPath, data);
}

export async function updateLastChecked(): Promise<void> {
  const data = await readNotifications();
  data.last_checked = new Date().toISOString();
  data.new_posts = [];
  data.new_entries = [];
  await writeNotifications(data);
}
