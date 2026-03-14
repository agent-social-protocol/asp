import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { generateEncryptionKeyPair, generateKeyPair } from '../utils/crypto.js';
import { createDefaultBehavior, type BehaviorConfig } from '../config/behavior.js';
import { createDefaultManifest, type EntityType, type Manifest } from '../models/manifest.js';
import { ensureStoreExists, getStorePaths } from '../store/index.js';
import { readManifest } from '../store/manifest-store.js';
import { writeManifest } from '../store/manifest-store.js';
import { writeFeed } from '../store/feed-store.js';
import { writeFollowing } from '../store/following-store.js';
import { writeInteractions } from '../store/interaction-store.js';
import { writeNotifications } from '../store/notification-store.js';
import { writeRelationships } from '../store/relationship-store.js';
import { writeInbox } from '../store/inbox-store.js';
import { writeReputationRecords } from '../store/reputation-store.js';
import { writeBehavior } from '../store/behavior-store.js';

export interface InitializeIdentityOptions {
  id: string;
  type: EntityType;
  name: string;
  handle: string;
  bio: string;
  languages: string[];
  tags?: string[];
  skills?: string[];
  represents?: string;
  autonomy?: 'low' | 'medium' | 'high';
}

export interface InitializedIdentity {
  manifest: Manifest;
  behavior: BehaviorConfig;
  publicKey: string;
  encryptionKey: string;
}

export async function enableManifestEncryption(): Promise<{
  manifest: Manifest | null;
  encryptionKey: string;
}> {
  const { encryptionKeyPath } = getStorePaths();
  if (existsSync(encryptionKeyPath)) {
    throw new Error('Encryption already enabled');
  }

  const { publicKey: encryptionKey, privateKey } = generateEncryptionKeyPair();
  await writeFile(encryptionKeyPath, privateKey, { mode: 0o600 });

  const manifest = await readManifest();
  if (manifest) {
    manifest.verification.encryption_key = encryptionKey;
    if (!manifest.capabilities.includes('encrypted-dm')) {
      manifest.capabilities.push('encrypted-dm');
    }
    await writeManifest(manifest);
  }

  return { manifest, encryptionKey };
}

export async function initializeLocalIdentity(opts: InitializeIdentityOptions): Promise<InitializedIdentity> {
  await ensureStoreExists();
  const { privateKeyPath, encryptionKeyPath } = getStorePaths();

  const { publicKey, privateKey } = generateKeyPair();
  await writeFile(privateKeyPath, privateKey, { mode: 0o600 });

  const { publicKey: encryptionKey, privateKey: encryptionPrivateKey } = generateEncryptionKeyPair();
  await writeFile(encryptionKeyPath, encryptionPrivateKey, { mode: 0o600 });

  const manifest = createDefaultManifest({
    id: opts.id,
    type: opts.type,
    name: opts.name,
    handle: opts.handle,
    bio: opts.bio,
    tags: opts.tags,
    skills: opts.skills,
    languages: opts.languages,
    represents: opts.represents,
    publicKey,
    encryptionKey,
  });

  const behavior = createDefaultBehavior(
    (opts.type === 'agent' || opts.type === 'bot') ? (opts.autonomy ?? 'medium') : 'medium',
  );

  await writeManifest(manifest);
  await writeFeed([]);
  await writeFollowing([]);
  await writeInteractions({ sent: [], received: [] });
  await writeNotifications({ last_checked: new Date().toISOString(), new_posts: [], new_interactions: [] });
  await writeRelationships([]);
  await writeInbox({ messages: [] });
  await writeReputationRecords([]);
  await writeBehavior(behavior);

  return {
    manifest,
    behavior,
    publicKey,
    encryptionKey,
  };
}
