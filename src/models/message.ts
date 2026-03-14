import * as z from 'zod/v4';

const JsonRecordSchema = z.record(z.string(), z.unknown());

export const MessageInitiatorSchema = z.enum(['human', 'agent']);
export type MessageInitiator = z.infer<typeof MessageInitiatorSchema>;

export const MessageAttachmentSchema = z.object({
  type: z.string(), // "image", "url", "profile", "document", ...
  url: z.string(),
  label: z.string().optional(),
});
export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;

export const MessageContentSchema = z.object({
  text: z.string(),
  data: JsonRecordSchema.optional(),
  attachments: z.array(MessageAttachmentSchema).optional(),
});

export const MessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  timestamp: z.string(),
  intent: z.string(),
  content: MessageContentSchema,
  initiated_by: MessageInitiatorSchema,
  reply_to: z.string().optional(),
  thread_id: z.string().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export function isMessage(obj: unknown): obj is Message {
  return MessageSchema.safeParse(obj).success;
}
