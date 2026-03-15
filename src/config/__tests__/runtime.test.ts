import { describe, expect, it } from 'vitest';
import { getCliRuntimeConfig, getStoreDisplayPath } from '../cli.js';
import {
  buildHostedEndpoint,
  buildHostedProfileUrl,
  getHostedRuntimeConfig,
  handleFromHostedEndpoint,
  isHostedEndpoint,
  resolveHostedTargetEndpoint,
} from '../hosted.js';
import { mergeRuntimeConfig } from '../runtime.js';

describe('runtime config helpers', () => {
  it('keeps core config empty until a higher layer applies defaults', () => {
    expect(mergeRuntimeConfig()).toEqual({});
  });

  it('resolves hosted endpoints using the configured hosted domain', () => {
    const config = getHostedRuntimeConfig({ hostedHandleDomain: 'agents.example' });

    expect(buildHostedEndpoint('@alice', config)).toBe('https://alice.agents.example');
    expect(resolveHostedTargetEndpoint('bob', config)).toBe('https://bob.agents.example');
    expect(buildHostedProfileUrl('@alice', getHostedRuntimeConfig({ hubWebBaseUrl: 'https://hub.example' }))).toBe('https://hub.example/@alice');
  });

  it('detects hosted endpoints using the configured domain suffix', () => {
    const config = getHostedRuntimeConfig({ hostedHandleDomain: 'agents.example' });

    expect(handleFromHostedEndpoint('https://alice.agents.example', config)).toBe('alice');
    expect(isHostedEndpoint('https://alice.agents.example', config)).toBe(true);
    expect(isHostedEndpoint('https://alice.other.example', config)).toBe(false);
  });

  it('uses asp.social as the protocol-layer hosted default', () => {
    const config = getHostedRuntimeConfig();

    expect(config.hubWebBaseUrl).toBe('https://asp.social');
    expect(config.hubApiBaseUrl).toBe('https://asp.social/api');
    expect(config.hostedHandleDomain).toBe('asp.social');
    expect(buildHostedEndpoint('@alice', config)).toBe('https://alice.asp.social');
    expect(buildHostedProfileUrl('@alice', config)).toBe('https://asp.social/@alice');
  });

  it('applies CLI defaults separately from hosted defaults', () => {
    const config = getCliRuntimeConfig({ storeDir: '/tmp/asp-test-home' });

    expect(config.storeDir).toBe('/tmp/asp-test-home');
    expect(config.coreIndexUrl).toBe('https://aspnetwork.dev');
    expect(getStoreDisplayPath(config)).toBe('/tmp/asp-test-home');
  });
});
