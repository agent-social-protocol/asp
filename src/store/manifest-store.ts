import { existsSync } from 'node:fs';
import { getStorePaths } from './index.js';
import { loadYaml, dumpYaml } from '../utils/yaml.js';
import type { Manifest } from '../models/manifest.js';

export async function readManifest(): Promise<Manifest | null> {
  const { manifestPath } = getStorePaths();
  if (!existsSync(manifestPath)) return null;
  return loadYaml<Manifest>(manifestPath);
}

export async function writeManifest(manifest: Manifest): Promise<void> {
  await dumpYaml(getStorePaths().manifestPath, manifest);
}
