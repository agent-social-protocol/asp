import { homedir } from 'node:os';
import { join } from 'node:path';
import { getHostedRuntimeConfig } from './hosted.js';
import { mergeRuntimeConfig, requireConfigValue, type ASPRuntimeConfig } from './runtime.js';

export function getCliRuntimeConfig(overrides: Partial<ASPRuntimeConfig> = {}): Required<Pick<
  ASPRuntimeConfig,
  'storeDir' | 'coreIndexUrl' | 'hubApiBaseUrl' | 'hubWebBaseUrl' | 'hostedHandleDomain'
>> & ASPRuntimeConfig {
  const storeDir = process.env.ASP_STORE_DIR ?? join(homedir(), '.asp');
  const config = mergeRuntimeConfig(getHostedRuntimeConfig(), { storeDir }, overrides);

  return {
    ...getHostedRuntimeConfig(config),
    storeDir: requireConfigValue(config, 'storeDir'),
  };
}

export function getStoreDisplayPath(config: ASPRuntimeConfig = getCliRuntimeConfig()): string {
  const storeDir = requireConfigValue(config, 'storeDir');
  const home = homedir();
  return storeDir.startsWith(`${home}/`)
    ? storeDir.replace(home, '~')
    : storeDir;
}
