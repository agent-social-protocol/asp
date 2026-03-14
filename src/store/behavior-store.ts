import { existsSync } from 'node:fs';
import { getStorePaths, type StoreConfig } from './index.js';
import { loadYaml, dumpYaml } from '../utils/yaml.js';
import type { BehaviorConfig } from '../config/behavior.js';

export async function readBehavior(config: StoreConfig = {}): Promise<BehaviorConfig | null> {
  const { behaviorPath } = getStorePaths(config);
  if (!existsSync(behaviorPath)) return null;
  return loadYaml<BehaviorConfig>(behaviorPath);
}

export async function writeBehavior(config: BehaviorConfig, storeConfig: StoreConfig = {}): Promise<void> {
  await dumpYaml(getStorePaths(storeConfig).behaviorPath, config);
}
