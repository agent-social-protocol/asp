import type { CardEnvelope } from "./contracts/card-envelope";
import type { CardCapability, TargetCapabilities } from "./contracts/target-capabilities";
import type { RealtimeEvent } from "./contracts/realtime-event";

export interface AspSocialTransport {
  getShareUrl(): Promise<string | null>;
  getConnectionState(): Promise<unknown>;
  follow(target: string): Promise<unknown>;
  unfollow(target: string): Promise<unknown>;
  listFollowing(): Promise<string[]>;
  sendMessage(input: { target: string; text: string; metadata?: unknown }): Promise<unknown>;
  sendAction(input: { target: string; actionId: string; payload?: unknown; metadata?: unknown }): Promise<unknown>;
  listInboxItems(): Promise<unknown[]>;
  subscribe(ownerId: string): AsyncIterable<unknown>;
  publishCard(envelope: CardEnvelope): Promise<unknown>;
  clearCard(contractId: string): Promise<unknown>;
  readCard(target: string, contractId: string): Promise<unknown>;
  getTargetCapabilities?(target: string): Promise<unknown>;
}

export interface AspSocialClient {
  getOwnCapabilities(): TargetCapabilities;
  getTargetCapabilities(target: string): Promise<TargetCapabilities>;
  getShareUrl(): Promise<string | null>;
  getConnectionState(): Promise<unknown>;
  follow(target: string): Promise<unknown>;
  unfollow(target: string): Promise<unknown>;
  listFollowing(): Promise<string[]>;
  sendMessage(input: { target: string; text: string; metadata?: unknown }): Promise<unknown>;
  sendAction(input: { target: string; actionId: string; payload?: unknown; metadata?: unknown }): Promise<unknown>;
  listInboxItems(): Promise<unknown[]>;
  subscribe(ownerId: string): AsyncIterable<RealtimeEvent>;
  publishCard(envelope: CardEnvelope): Promise<unknown>;
  clearCard(contractId: string): Promise<unknown>;
  readCard(target: string, contractId: string): Promise<CardEnvelope | null>;
}

export interface CreateAspSocialOptions {
  transport: AspSocialTransport;
  capabilities?: Partial<TargetCapabilities> | null;
  packs?: Array<{ capabilities?: Partial<TargetCapabilities> | null }>;
}

export function createAspSocial(options: CreateAspSocialOptions): AspSocialClient;

export interface AspSocialNodeRuntimeOptions {
  identityDir?: string;
  hostedHandleDomain?: string;
  hubApiBaseUrl?: string | null;
  appId?: string | null;
  installId?: string | null;
  fetchImpl?: typeof fetch;
  importModule?: () => Promise<unknown>;
}

export class AspSocialNodeRuntime {
  constructor(options?: AspSocialNodeRuntimeOptions);
  getShareUrl(): Promise<string | null>;
  getConnectionState(): Promise<unknown>;
  getTargetCapabilities(target: string): Promise<TargetCapabilities>;
  follow(target: string): Promise<unknown>;
  unfollow(target: string): Promise<unknown>;
  listFollowing(): Promise<string[]>;
  publishCardEnvelope(envelope: CardEnvelope): Promise<unknown>;
  publishCard(envelope: CardEnvelope): Promise<unknown>;
  clearCard(contractId: string): Promise<unknown>;
  readCardEnvelope(target: string, contractId: string): Promise<CardEnvelope | null>;
  readCard(target: string, contractId: string): Promise<CardEnvelope | null>;
  sendMessage(input: { target: string; text: string; metadata?: unknown }): Promise<unknown>;
  sendAction(input: { target: string; actionId: string; payload?: unknown; metadata?: unknown }): Promise<unknown>;
  listInboxItems(): Promise<unknown[]>;
  subscribe(ownerId?: string | null): AsyncIterable<RealtimeEvent>;
}

export function createAspSocialNodeRuntime(options?: AspSocialNodeRuntimeOptions): AspSocialNodeRuntime;

export const DEFAULT_ASP_IDENTITY_DIR: string;
export const COMPANION_ACTION_IDS: string[];
export const COMPANION_PACK_ID: string;
export const companionPack: {
  id: string;
  supportedActions: string[];
  capabilities: TargetCapabilities;
  toWireAction(actionId: string): string | null;
  fromWireAction(action: string): string | null;
};
export type { CardCapability, CardEnvelope, RealtimeEvent, TargetCapabilities };
