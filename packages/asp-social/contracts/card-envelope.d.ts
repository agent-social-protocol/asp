export interface CardEnvelope {
  contractId: string;
  schemaVersion: string;
  snapshot: Record<string, unknown>;
  updatedAt: string;
  expiresAt?: string | null;
  signature?: string;
  signedBy?: string;
}

export type CardEnvelopeNormalizationResult =
  | { ok: true; value: CardEnvelope }
  | { ok: false; error: string };

export function buildCardSignaturePayload(input: unknown): string;
export function normalizeCardEnvelope(input: unknown): CardEnvelopeNormalizationResult;
