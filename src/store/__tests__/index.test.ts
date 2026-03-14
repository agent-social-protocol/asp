import { afterEach, describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('store path resolution', () => {
  afterEach(() => {
    delete process.env.ASP_STORE_DIR;
    vi.resetModules();
  });

  it('falls back to ~/.asp when no runtime config has been applied', async () => {
    delete process.env.ASP_STORE_DIR;
    vi.resetModules();

    const { getStorePaths } = await import('../index.js');

    expect(getStorePaths().storeDir).toBe(join(homedir(), '.asp'));
  });

  it('uses ASP_STORE_DIR before any store defaults are configured', async () => {
    process.env.ASP_STORE_DIR = '/tmp/asp-env-store';
    vi.resetModules();

    const { getStorePaths } = await import('../index.js');

    expect(getStorePaths().storeDir).toBe('/tmp/asp-env-store');
  });
});
