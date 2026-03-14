import { existsSync } from 'node:fs';
import { getStorePaths } from './index.js';
import { loadYaml, dumpYaml } from '../utils/yaml.js';
import type { Message } from '../models/message.js';

interface InboxFile {
  messages: Message[];
}

export async function readInbox(): Promise<InboxFile> {
  const { inboxPath } = getStorePaths();
  if (!existsSync(inboxPath)) return { messages: [] };
  const data = await loadYaml<InboxFile>(inboxPath);
  return { messages: data?.messages || [] };
}

export async function writeInbox(data: InboxFile): Promise<void> {
  await dumpYaml(getStorePaths().inboxPath, data);
}

export async function addMessage(msg: Message): Promise<void> {
  const data = await readInbox();
  data.messages.push(msg);
  await writeInbox(data);
}

export async function getMessagesByThread(threadId: string): Promise<Message[]> {
  const data = await readInbox();
  return data.messages.filter((m) => m.thread_id === threadId);
}
