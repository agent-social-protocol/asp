import { mergeRuntimeConfig, normalizeBaseUrl, requireConfigValue, type ASPRuntimeConfig } from './runtime.js';
import { accountDomainOrigin, normalizeAccountIdentifier, splitAccountIdentifier } from '../utils/webfinger.js';

const HOSTED_DEFAULTS = {
  coreIndexUrl: 'https://aspnetwork.dev',
  hubApiBaseUrl: 'https://asp.social/api',
  hubWebBaseUrl: 'https://asp.social',
  hostedHandleDomain: 'asp.social',
} satisfies ASPRuntimeConfig;

export function getHostedRuntimeConfig(overrides: Partial<ASPRuntimeConfig> = {}): Required<Pick<
  ASPRuntimeConfig,
  'coreIndexUrl' | 'hubApiBaseUrl' | 'hubWebBaseUrl' | 'hostedHandleDomain'
>> & ASPRuntimeConfig {
  const config = mergeRuntimeConfig(HOSTED_DEFAULTS, {
    coreIndexUrl: process.env.ASP_CORE_INDEX_URL,
    hubApiBaseUrl: process.env.ASP_HUB_API_URL,
    hubWebBaseUrl: process.env.ASP_HUB_WEB_URL,
    hostedHandleDomain: process.env.ASP_HOSTED_HANDLE_DOMAIN,
  }, overrides);

  return {
    ...config,
    coreIndexUrl: normalizeBaseUrl(requireConfigValue(config, 'coreIndexUrl')),
    hubApiBaseUrl: normalizeBaseUrl(requireConfigValue(config, 'hubApiBaseUrl')),
    hubWebBaseUrl: normalizeBaseUrl(requireConfigValue(config, 'hubWebBaseUrl')),
    hostedHandleDomain: requireConfigValue(config, 'hostedHandleDomain'),
  };
}

export function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, '');
}

export function buildHostedEndpoint(handle: string, config: ASPRuntimeConfig = getHostedRuntimeConfig()): string {
  const hosted = getHostedRuntimeConfig(config);
  return `https://${normalizeHandle(handle)}.${hosted.hostedHandleDomain}`;
}

export function buildHostedProfileUrl(handle: string, config: ASPRuntimeConfig = getHostedRuntimeConfig()): string {
  const hosted = getHostedRuntimeConfig(config);
  return `${hosted.hubWebBaseUrl}/@${normalizeHandle(handle)}`;
}

export function handleFromHostedEndpoint(endpoint: string, config: ASPRuntimeConfig = getHostedRuntimeConfig()): string | null {
  try {
    const hosted = getHostedRuntimeConfig(config);
    const host = new URL(endpoint).hostname;
    const suffix = `.${hosted.hostedHandleDomain}`;
    if (host.endsWith(suffix) && host !== hosted.hostedHandleDomain) {
      return host.slice(0, -suffix.length);
    }
  } catch {}
  return null;
}

export function isHostedEndpoint(endpoint: string, config: ASPRuntimeConfig = getHostedRuntimeConfig()): boolean {
  return handleFromHostedEndpoint(endpoint, config) !== null;
}

export function resolveHostedTargetEndpoint(target: string, config: ASPRuntimeConfig = getHostedRuntimeConfig()): string {
  if (target.startsWith('https://') || target.startsWith('http://')) return target;
  const account = normalizeAccountIdentifier(target);
  if (account) {
    const parts = splitAccountIdentifier(account)!;
    const hosted = getHostedRuntimeConfig(config);
    if (parts.domain === hosted.hostedHandleDomain) {
      return buildHostedEndpoint(parts.username, hosted);
    }
    return accountDomainOrigin(parts.domain);
  }
  if (target.startsWith('@')) {
    return buildHostedEndpoint(target, config);
  }
  if (target.includes('.')) return `https://${target}`;
  return buildHostedEndpoint(target, config);
}
