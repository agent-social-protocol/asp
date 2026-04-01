// Library exports
export { ASPNode } from './lib/asp-node.js';
export type { ASPEventMap } from './lib/asp-node.js';
export { ASPClient } from './lib/asp-client.js';
export type { ASPClientEventMap } from './lib/asp-client.js';
export { MemoryStore, FileStore } from './lib/store.js';
export type { ASPStore, StoreData } from './lib/store.js';
export type { ASPNodeOptions, ASPHttpHandler, ASPClientOptions, ASPDeliveryMode } from './lib/types.js';
export { createASPHandler } from './lib/handler.js';
export type { ASPHandlerCallbacks, ASPHandlerOptions } from './lib/handler.js';

// Re-export models
export type { Manifest, Entity, Relationship, EntityType, Verification, Skill } from './models/manifest.js';
export type { InboxEntry, InboxEntryKind, InboxEntryContent } from './models/inbox-entry.js';
export type { Message, MessageAttachment, MessageInitiator } from './models/message.js';
export type { Interaction } from './models/interaction.js';
export type { FeedEntry } from './models/feed-entry.js';
export type { Following } from './models/following.js';
export type {
  SurfaceKind,
  SurfaceExposure,
  WatchMode,
  WatchSupport,
  SurfaceDescriptor,
  InboxSurfaceDescriptor,
  NotificationsSurfaceDescriptor,
  IdentitySelection,
  SurfaceCapabilities,
} from './models/surface-capabilities.js';
// Application layer — reference implementation, not protocol spec
export type { ReputationRecord } from './reputation/models.js';
export type { BehaviorConfig } from './config/behavior.js';

// Re-export model utilities
export { isManifest, createDefaultManifest } from './models/manifest.js';
export { isInboxEntry, isMessageEntry, isInteractionEntry, validateInboxEntry } from './models/inbox-entry.js';
export { isMessage } from './models/message.js';
export { isInteraction } from './models/interaction.js';
export { SurfaceCapabilitiesSchema, REFERENCE_SURFACE_CAPABILITIES } from './models/surface-capabilities.js';

// Re-export utilities
// Application layer — reference implementation, not protocol spec
export { computeTrust } from './reputation/calculator.js';
export { fetchManifest, verifyEntity, verifyRepresentation } from './utils/verify-identity.js';
export { fetchFeed } from './utils/fetch-feed.js';
export type { RemoteFeed } from './utils/fetch-feed.js';
export { sendEntry } from './utils/send-entry.js';
export { sendMessage } from './utils/send-message.js';
export { sendInteraction } from './utils/send-interaction.js';
export { generateKeyPair, signPayload, generateEncryptionKeyPair, eciesEncrypt, eciesDecrypt } from './utils/crypto.js';
export type { ASPKeyPair, EncryptionKeyPair, EncryptedPayload } from './utils/crypto.js';
export { getRecipientEncryptionKey, isEncryptedMessage, encryptMessageContent, decryptMessageContent } from './utils/encrypt-message.js';
