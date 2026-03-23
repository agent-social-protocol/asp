import { randomUUID } from 'node:crypto';
import type { InboxEntry } from '../models/inbox-entry.js';
import { normalizeMessageType } from '../models/inbox-entry.js';
import type { Message } from '../models/message.js';
import type { Interaction } from '../models/interaction.js';

export function messageToInboxEntry(message: Message): InboxEntry {
  return {
    id: message.id,
    from: message.from,
    to: message.to,
    kind: 'message',
    type: normalizeMessageType(message.intent),
    timestamp: message.timestamp,
    signature: message.signature,
    content: message.content,
    reply_to: message.reply_to,
    thread_id: message.thread_id,
    initiated_by: message.initiated_by,
  };
}

export function interactionToInboxEntry(interaction: Interaction): InboxEntry {
  return {
    id: interaction.id ?? randomUUID(),
    from: interaction.from ?? '',
    to: interaction.to ?? '',
    kind: 'interaction',
    type: interaction.action,
    timestamp: interaction.timestamp,
    signature: interaction.signature,
    target: interaction.target,
    ...(interaction.content && { content: { text: interaction.content } }),
  };
}

export function inboxEntryToMessage(entry: InboxEntry): Message | null {
  if (entry.kind !== 'message') return null;
  return {
    id: entry.id,
    from: entry.from,
    to: entry.to,
    timestamp: entry.timestamp,
    intent: entry.type,
    content: {
      text: entry.content?.text ?? '',
      ...(entry.content?.data && { data: entry.content.data }),
      ...(entry.content?.attachments && { attachments: entry.content.attachments }),
    },
    initiated_by: entry.initiated_by ?? 'agent',
    ...(entry.reply_to && { reply_to: entry.reply_to }),
    ...(entry.thread_id && { thread_id: entry.thread_id }),
    ...(entry.signature && { signature: entry.signature }),
  };
}

export function inboxEntryToInteraction(entry: InboxEntry): Interaction | null {
  if (entry.kind !== 'interaction') return null;
  return {
    id: entry.id,
    action: entry.type,
    ...(entry.from && { from: entry.from }),
    ...(entry.to && { to: entry.to }),
    ...(entry.target && { target: entry.target }),
    ...(entry.content?.text && { content: entry.content.text }),
    timestamp: entry.timestamp,
    ...(entry.signature && { signature: entry.signature }),
  };
}

export function buildInboxEntrySignaturePayload(entry: Pick<InboxEntry, 'id' | 'from' | 'to' | 'kind' | 'type' | 'timestamp' | 'target'>): string {
  return `${entry.id}:${entry.from}:${entry.to}:${entry.kind}:${entry.type}:${entry.target ?? ''}:${entry.timestamp}`;
}
