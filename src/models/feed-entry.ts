import * as z from 'zod/v4';

export const FeedEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  published: z.string(),
  updated: z.string().optional(),
  topics: z.array(z.string()),
  summary: z.string(),
  content_url: z.string().optional(),
  content_type: z.string().optional(),
  author: z.string().optional(),
  repost_of: z.string().optional(),
  reply_to: z.string().optional(),
  signal_type: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type FeedEntry = z.infer<typeof FeedEntrySchema>;

export function isFeedEntry(obj: unknown): obj is FeedEntry {
  return FeedEntrySchema.safeParse(obj).success;
}
