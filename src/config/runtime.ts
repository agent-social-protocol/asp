export interface ASPRuntimeConfig {
  storeDir?: string;
  coreIndexUrl?: string;
  hubApiBaseUrl?: string;
  hubWebBaseUrl?: string;
  hostedHandleDomain?: string;
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function mergeRuntimeConfig(...layers: Array<Partial<ASPRuntimeConfig> | undefined>): ASPRuntimeConfig {
  const merged: ASPRuntimeConfig = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer) as Array<[keyof ASPRuntimeConfig, string | undefined]>) {
      if (value !== undefined) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

export function requireConfigValue(
  config: ASPRuntimeConfig,
  key: keyof ASPRuntimeConfig,
): string {
  const value = config[key];
  if (!value) {
    throw new Error(`Missing runtime config: ${String(key)}`);
  }
  return value;
}
