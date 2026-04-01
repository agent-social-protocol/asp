import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { InboxEntry } from '../models/inbox-entry.js';
import { getStorePaths } from '../store/index.js';
import { decryptMessageContent, isEncryptedMessage } from './encrypt-message.js';
import { inboxEntryToMessage, messageToInboxEntry } from './inbox-entry.js';

export interface InboxReadWarning {
  code: 'decryption_failed';
  item_id: string;
  message: string;
}

export async function resolveReadableInboxEntries(entries: InboxEntry[]): Promise<{
  entries: InboxEntry[];
  warnings: InboxReadWarning[];
}> {
  const warnings: InboxReadWarning[] = [];
  const { encryptionKeyPath } = getStorePaths();

  if (!existsSync(encryptionKeyPath)) {
    return { entries, warnings };
  }

  const encPrivKey = await readFile(encryptionKeyPath, 'utf-8');
  const readableEntries = entries.map((entry) => {
    const message = inboxEntryToMessage(entry);
    if (!message || !isEncryptedMessage(message)) {
      return entry;
    }
    try {
      return messageToInboxEntry(decryptMessageContent(message, encPrivKey));
    } catch (error) {
      warnings.push({
        code: 'decryption_failed',
        item_id: entry.id,
        message: error instanceof Error ? error.message : 'Could not decrypt message content',
      });
      return entry;
    }
  });

  return {
    entries: readableEntries,
    warnings,
  };
}
