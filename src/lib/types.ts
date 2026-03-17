import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Manifest } from '../models/manifest.js';
import type { ASPStore } from './store.js';
import type { Message } from '../models/message.js';
import type { Interaction } from '../models/interaction.js';

export interface ASPNodeOptions {
  manifest: Manifest;
  privateKey?: string;
  store?: ASPStore;
  feedLimit?: number;
}

export type ASPHttpHandler = (req: IncomingMessage, res: ServerResponse) => void;

export interface ASPClientOptions {
  identityDir?: string;
  identityProvider?: ASPIdentityProvider;
  transport?: ASPClientTransport;
  coreIndexUrl?: string;
}

export interface ASPClientIdentity {
  manifest: Manifest;
  privateKey: string | null;
  encryptionKey: string | null;
  identityDir?: string;
}

export interface ASPIdentityProvider {
  loadIdentity(): ASPClientIdentity;
}

export interface ASPClientRuntime {
  manifest: Manifest;
  makeAuthHeader(method: string, pathname: string): Promise<string>;
}

export interface ASPClientTransportOptions {
  coreIndexUrl?: string;
}

export interface ASPSearchOptions {
  q?: string;
  type?: string;
  tags?: string | string[];
  skills?: string | string[];
  tag?: string;
  skill?: string;
}

export interface ASPSearchResult {
  endpoint: string;
  name?: string;
  type?: string;
  handle?: string;
  bio?: string;
  tags?: string[];
  skills?: string[];
}

export interface ASPPublishResult {
  ok: boolean;
  id: string;
  error?: string;
}

export interface ASPClientTransport {
  searchIndex(
    runtime: ASPClientRuntime,
    opts: ASPSearchOptions,
  ): Promise<ASPSearchResult[]>;
  getInbox(
    runtime: ASPClientRuntime,
    opts?: { since?: string; thread?: string },
  ): Promise<Message[]>;
  getInteractions(
    runtime: ASPClientRuntime,
    opts?: { since?: string; action?: string },
  ): Promise<Interaction[]>;
  publish(
    runtime: ASPClientRuntime,
    opts: { title: string; summary: string; topics?: string[]; signalType?: string; metadata?: Record<string, unknown> },
  ): Promise<ASPPublishResult>;
}
