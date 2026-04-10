export interface CardCapability {
  contractId: string;
  schemaVersion: string;
  schemaUrl?: string;
}

export interface TargetCapabilities {
  messages: boolean;
  supportedActions: string[];
  supportedPacks: string[];
  cards: CardCapability[];
}

export type TargetCapabilitiesNormalizationResult =
  | { ok: true; value: TargetCapabilities }
  | { ok: false; error: string };

export function mergeTargetCapabilities(...values: unknown[]): TargetCapabilities;
export function normalizeTargetCapabilities(input: unknown): TargetCapabilitiesNormalizationResult;
