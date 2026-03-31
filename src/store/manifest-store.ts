import { existsSync } from 'node:fs';
import { getStorePaths } from './index.js';
import { loadYaml, dumpYaml } from '../utils/yaml.js';
import type { Manifest } from '../models/manifest.js';
import { migrateLegacyHostedManifest } from '../hosted/manifest-migration.js';

async function loadManifestFromStore(): Promise<Manifest | null> {
  const { manifestPath } = getStorePaths();
  if (!existsSync(manifestPath)) return null;
  return loadYaml<Manifest>(manifestPath);
}

export async function readManifest(
  options: { autoMigrate?: boolean } = {},
): Promise<Manifest | null> {
  const manifest = await loadManifestFromStore();
  if (!manifest) return null;
  if (options.autoMigrate === false) {
    return manifest;
  }

  const migration = migrateLegacyHostedManifest(manifest);
  if (!migration.ok) {
    throw new Error(migration.error);
  }
  if (migration.updated) {
    await dumpYaml(getStorePaths().manifestPath, manifest);
  }
  return manifest;
}

export async function writeManifest(manifest: Manifest): Promise<void> {
  await dumpYaml(getStorePaths().manifestPath, manifest);
}
