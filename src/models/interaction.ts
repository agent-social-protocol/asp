import * as z from 'zod/v4';

export const InteractionSchema = z.object({
  id: z.string().optional(),
  action: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  target: z.string().optional(),
  content: z.string().optional(),
  timestamp: z.string(),
  local: z.boolean().optional(),
  reason: z.string().optional(),
  category: z.string().optional(),
  signature: z.string().optional(),
});
export type Interaction = z.infer<typeof InteractionSchema>;

export function isInteraction(obj: unknown): obj is Interaction {
  return InteractionSchema.safeParse(obj).success;
}
