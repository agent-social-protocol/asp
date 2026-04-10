import type { CardEnvelope } from "./card-envelope";

export interface RealtimeMessageItem {
  type: "message";
  id?: string | null;
  from: string;
  fromLabel?: string | null;
  to?: string | null;
  text: string;
  createdAt: string;
}

export interface RealtimeActionItem {
  type: "action";
  id?: string | null;
  from: string;
  fromLabel?: string | null;
  to?: string | null;
  actionId: string;
  payload?: unknown;
  createdAt: string;
}

export type RealtimeEvent =
  | { type: "message.received"; item: RealtimeMessageItem }
  | { type: "action.received"; item: RealtimeActionItem }
  | { type: "card.updated"; ownerId: string; envelope: CardEnvelope }
  | { type: "card.deleted"; ownerId: string; contractId: string; deletedAt: string };

export type RealtimeEventNormalizationResult =
  | { ok: true; value: RealtimeEvent }
  | { ok: false; error: string };

export function normalizeRealtimeEvent(input: unknown): RealtimeEventNormalizationResult;
