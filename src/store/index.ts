import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StoreConfig {
  storeDir?: string;
}

export interface StorePaths {
  storeDir: string;
  manifestPath: string;
  feedPath: string;
  followingPath: string;
  notificationsPath: string;
  relationshipsPath: string;
  inboxPath: string;
  reputationPath: string;
  behaviorPath: string;
  privateKeyPath: string;
  encryptionKeyPath: string;
  indexesPath: string;
}

let configuredStoreDir: string | undefined;

export function configureStoreDefaults(config: Required<Pick<StoreConfig, 'storeDir'>>): void {
  configuredStoreDir = config.storeDir;
}

function resolveStoreDir(config: StoreConfig = {}): string {
  return config.storeDir
    ?? configuredStoreDir
    ?? process.env.ASP_STORE_DIR
    ?? join(homedir(), '.asp');
}

export function getStorePaths(config: StoreConfig = {}): StorePaths {
  const storeDir = resolveStoreDir(config);
  return {
    storeDir,
    manifestPath: join(storeDir, 'manifest.yaml'),
    feedPath: join(storeDir, 'feed.yaml'),
    followingPath: join(storeDir, 'following.yaml'),
    notificationsPath: join(storeDir, 'notifications.yaml'),
    relationshipsPath: join(storeDir, 'relationships.yaml'),
    inboxPath: join(storeDir, 'inbox.yaml'),
    reputationPath: join(storeDir, 'reputation.yaml'),
    behaviorPath: join(storeDir, 'behavior.yaml'),
    privateKeyPath: join(storeDir, 'private.pem'),
    encryptionKeyPath: join(storeDir, 'encryption.pem'),
    indexesPath: join(storeDir, 'indexes.yaml'),
  };
}

export async function ensureStoreExists(config: StoreConfig = {}): Promise<void> {
  const { storeDir } = getStorePaths(config);
  if (!existsSync(storeDir)) {
    await mkdir(storeDir, { recursive: true });
  }
}

export function storeInitialized(config: StoreConfig = {}): boolean {
  return existsSync(getStorePaths(config).manifestPath);
}
