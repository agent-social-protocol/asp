import type { Message } from '../models/message.js';
import { messageToInboxEntry } from './inbox-entry.js';
import { sendEntry } from './send-entry.js';

export async function sendMessage(endpointUrl: string, message: Message): Promise<{ ok: boolean; error?: string }> {
  return sendEntry(endpointUrl, messageToInboxEntry(message));
}
