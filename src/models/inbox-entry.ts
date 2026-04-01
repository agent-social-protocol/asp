import * as z from 'zod/v4';
import { MessageAttachmentSchema, MessageInitiatorSchema } from './message.js';
import { isAspPostUrl } from '../utils/interaction-policy.js';

const JsonRecordSchema = z.record(z.string(), z.unknown());

export const InboxEntryKindSchema = z.enum(['message', 'interaction']);
export type InboxEntryKind = z.infer<typeof InboxEntryKindSchema>;

export const InboxEntryContentSchema = z.object({
  text: z.string().optional(),
  data: JsonRecordSchema.optional(),
  attachments: z.array(MessageAttachmentSchema).optional(),
});
export type InboxEntryContent = z.infer<typeof InboxEntryContentSchema>;

const BaseInboxEntrySchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: InboxEntryKindSchema,
  type: z.string(),
  timestamp: z.string(),
  signature: z.string().optional(),
  content: InboxEntryContentSchema.optional(),
  target: z.string().optional(),
  thread_id: z.string().optional(),
  reply_to: z.string().optional(),
  initiated_by: MessageInitiatorSchema.optional(),
  received_at: z.string().optional(),
});
export const InboxEntrySchema = BaseInboxEntrySchema.superRefine((entry, ctx) => {
  const validationError = validateInboxEntry(entry);
  if (validationError) {
    ctx.addIssue({
      code: 'custom',
      message: validationError,
    });
  }
});
export type InboxEntry = z.infer<typeof InboxEntrySchema>;

export function isInboxEntry(obj: unknown): obj is InboxEntry {
  return InboxEntrySchema.safeParse(obj).success;
}

export function isMessageEntry(entry: InboxEntry): boolean {
  return entry.kind === 'message';
}

export function isInteractionEntry(entry: InboxEntry): boolean {
  return entry.kind === 'interaction';
}

export function getInboxEntryCursor(entry: InboxEntry): string {
  return entry.received_at ?? entry.timestamp;
}

export function normalizeMessageType(type: string): string {
  return type === 'message' ? 'note' : type;
}

export function validateInboxEntry(
  entry: InboxEntry,
  opts: { requireSignature?: boolean } = {},
): string | null {
  if (opts.requireSignature && !entry.signature) {
    return 'Missing signature';
  }

  if (entry.kind === 'message') {
    if (!entry.initiated_by) {
      return 'Message entries require initiated_by';
    }
    const hasContent = !!entry.content && (
      typeof entry.content.text === 'string' ||
      !!entry.content.data ||
      (Array.isArray(entry.content.attachments) && entry.content.attachments.length > 0)
    );
    if (!hasContent) {
      return 'Message entries require content';
    }

    if (['note', 'request', 'introduce'].includes(entry.type) && typeof entry.content?.text !== 'string') {
      return `Message type "${entry.type}" requires content.text`;
    }
    if (['service-request', 'service-response'].includes(entry.type) && !entry.content?.data) {
      return `Message type "${entry.type}" requires content.data`;
    }
  }

  if (entry.kind === 'interaction') {
    if (entry.type === 'follow' && entry.from.replace(/\/+$/, '') === entry.to.replace(/\/+$/, '')) {
      return 'Interaction type "follow" cannot target self';
    }
    if (entry.type === 'like' && !entry.target) {
      return 'Interaction type "like" requires target';
    }
    if (entry.type === 'like' && entry.target && !isAspPostUrl(entry.target)) {
      return 'Interaction type "like" requires ASP post target';
    }
    if (entry.type === 'comment') {
      if (!entry.target) return 'Interaction type "comment" requires target';
      if (typeof entry.content?.text !== 'string') return 'Interaction type "comment" requires content.text';
    }
  }

  return null;
}
