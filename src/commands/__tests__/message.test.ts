import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadInboxCommand() {
  vi.doMock('../../store/index.js', () => ({
    getStorePaths: vi.fn().mockReturnValue({
      encryptionKeyPath: '/tmp/missing-encryption.pem',
      privateKeyPath: '/tmp/private.pem',
    }),
    storeInitialized: vi.fn().mockReturnValue(true),
  }));
  vi.doMock('../../utils/own-inbox.js', () => ({
    readOwnInboxPage: vi.fn().mockResolvedValue({
      entries: [{
        id: 'follow-1',
        from: 'https://bob.asp.social',
        to: 'https://alice.asp.social',
        kind: 'interaction',
        type: 'follow',
        timestamp: '2026-03-31T09:30:00.000Z',
        received_at: '2026-03-31T09:30:01.000Z',
        signature: 'sig',
      }],
      nextCursor: null,
    }),
  }));
  vi.doMock('../../utils/remote-auth.js', () => ({
    handleFromEndpoint: vi.fn((endpoint: string) => endpoint.includes('bob') ? 'bob' : null),
  }));

  const { inboxCommand } = await import('../message.js');
  return { inboxCommand };
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('inbox command', () => {
  it('renders interaction entries in the default inbox view', async () => {
    const { inboxCommand } = await loadInboxCommand();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await inboxCommand.parseAsync([], { from: 'user' });

    expect(logSpy).toHaveBeenCalledWith('1 inbox entry:\n');
    expect(logSpy).toHaveBeenCalledWith('  [follow] @bob started following you');
  });
});
