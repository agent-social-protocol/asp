import { existsSync } from 'node:fs';
import { getStorePaths } from './index.js';
import { loadYaml, dumpYaml } from '../utils/yaml.js';
import type { Manifest } from '../models/manifest.js';
import { migrateLegacyHostedManifest } from '../hosted/manifest-migration.js';

export async function readManifest(): Promise<Manifest | null> {
  const { manifestPath } = getStorePaths();
  if (!existsSync(manifestPath)) return null;
  const manifest = await loadYaml<Manifest>(manifestPath);
  const migration = migrateLegacyHostedManifest(manifest);
  if (!migration.ok) {
    throw new Error(migration.error);
  }
  if (migration.updated) {
    await dumpYaml(manifestPath, manifest);
  }
  return manifest;
}

export async function writeManifest(manifest: Manifest): Promise<void> {
  await dumpYaml(getStorePaths().manifestPath, manifest);
}
