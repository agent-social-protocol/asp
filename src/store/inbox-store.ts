import { existsSync } from 'node:fs';
import { getStorePaths } from './index.js';
import { loadYaml, dumpYaml } from '../utils/yaml.js';
import type { InboxEntry } from '../models/inbox-entry.js';
import type { Message } from '../models/message.js';
import { hasSenderScopedEntryIdentity, inboxEntryToMessage, messageToInboxEntry } from '../utils/inbox-entry.js';

interface InboxFile {
  sent: InboxEntry[];
  received: InboxEntry[];
}

export async function readInbox(): Promise<InboxFile> {
  const { inboxPath } = getStorePaths();
  if (!existsSync(inboxPath)) return { sent: [], received: [] };
  const data = await loadYaml<InboxFile>(inboxPath);
  return {
    sent: data?.sent || [],
    received: data?.received || [],
  };
}

export async function writeInbox(data: InboxFile): Promise<void> {
  await dumpYaml(getStorePaths().inboxPath, data);
}

export async function addSentEntry(entry: InboxEntry): Promise<void> {
  const data = await readInbox();
  data.sent.push(entry);
  await writeInbox(data);
}

export async function addReceivedEntry(entry: InboxEntry): Promise<void> {
  const data = await readInbox();
  if (hasSenderScopedEntryIdentity(data.received, entry)) {
    return;
  }
  data.received.push(entry);
  await writeInbox(data);
}

export async function addMessage(msg: Message): Promise<void> {
  await addSentEntry(messageToInboxEntry(msg));
}

export async function getReceivedMessages(): Promise<Message[]> {
  const data = await readInbox();
  return data.received
    .map(inboxEntryToMessage)
    .filter((message): message is Message => message !== null);
}

export async function getMessagesByThread(threadId: string): Promise<Message[]> {
  const data = await readInbox();
  return [...data.sent, ...data.received]
    .filter((entry) => entry.thread_id === threadId)
    .map(inboxEntryToMessage)
    .filter((message): message is Message => message !== null);
}
