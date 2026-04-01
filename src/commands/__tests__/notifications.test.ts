import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadNotificationsCommand(options: {
  entries?: Array<Record<string, unknown>>;
  encryptionKeyAvailable?: boolean;
  decryptThrows?: boolean;
} = {}) {
  const updateLastChecked = vi.fn().mockResolvedValue(undefined);
  const output = vi.fn();

  vi.doMock('../../store/index.js', () => ({
    getStorePaths: vi.fn().mockReturnValue({
      encryptionKeyPath: '/tmp/encryption.pem',
      privateKeyPath: '/tmp/private.pem',
    }),
    storeInitialized: vi.fn().mockReturnValue(true),
  }));
  vi.doMock('node:fs', () => ({
    existsSync: vi.fn((path: string) => options.encryptionKeyAvailable === true && path === '/tmp/encryption.pem'),
  }));
  vi.doMock('node:fs/promises', () => ({
    readFile: vi.fn().mockResolvedValue('test-private-key'),
  }));
  vi.doMock('../../store/following-store.js', () => ({
    readFollowing: vi.fn().mockResolvedValue([]),
  }));
  vi.doMock('../../store/notification-store.js', () => ({
    readNotifications: vi.fn().mockResolvedValue({
      last_checked: '2026-04-01T00:00:00.000Z',
      new_posts: [],
      new_entries: [],
    }),
    updateLastChecked,
  }));
  vi.doMock('../../utils/fetch-feed.js', () => ({
    fetchFeed: vi.fn(),
  }));
  vi.doMock('../../utils/own-inbox.js', () => ({
    readOwnInboxPage: vi.fn().mockResolvedValue({
      entries: options.entries ?? [],
      nextCursor: null,
    }),
  }));
  vi.doMock('../../utils/output.js', () => ({
    output,
  }));
  vi.doMock('../../utils/remote-auth.js', () => ({
    handleFromEndpoint: vi.fn((endpoint: string) => endpoint.includes('bob') ? 'bob' : null),
  }));
  vi.doMock('../../utils/encrypt-message.js', async () => {
    const actual = await vi.importActual<typeof import('../../utils/encrypt-message.js')>('../../utils/encrypt-message.js');
    return {
      ...actual,
      decryptMessageContent: vi.fn(() => {
        if (options.decryptThrows) {
          throw new Error('Wrong key');
        }
        return {
          id: 'msg-1',
          from: 'https://bob.asp.social',
          to: 'https://alice.asp.social',
          timestamp: '2026-03-31T10:00:00.000Z',
          intent: 'chat',
          content: { text: 'hello' },
          initiated_by: 'human' as const,
        };
      }),
    };
  });

  const { notificationsCommand } = await import('../notifications.js');
  return { notificationsCommand, updateLastChecked, output };
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('notifications command', () => {
  it('does not advance last_checked in peek mode', async () => {
    const { notificationsCommand, updateLastChecked } = await loadNotificationsCommand();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await notificationsCommand.parseAsync(['--peek'], { from: 'user' });

    expect(updateLastChecked).not.toHaveBeenCalled();
  });

  it('advances last_checked by default', async () => {
    const { notificationsCommand, updateLastChecked } = await loadNotificationsCommand();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await notificationsCommand.parseAsync([], { from: 'user' });

    expect(updateLastChecked).toHaveBeenCalledTimes(1);
  });

  it('returns normalized notification items with decrypted inbox content in json mode', async () => {
    const { notificationsCommand, output } = await loadNotificationsCommand({
      encryptionKeyAvailable: true,
      entries: [{
        id: 'msg-1',
        from: 'https://bob.asp.social',
        to: 'https://alice.asp.social',
        kind: 'message',
        type: 'chat',
        timestamp: '2026-03-31T10:00:00.000Z',
        received_at: '2026-03-31T10:00:01.000Z',
        signature: 'sig',
        initiated_by: 'human',
        content: {
          text: '[encrypted]',
          data: {
            encrypted: {
              v: 1,
              eph: 'eph',
              nonce: 'nonce',
              ciphertext: 'ciphertext',
              tag: 'tag',
            },
          },
        },
      }],
    });
    vi.spyOn(notificationsCommand, 'optsWithGlobals').mockReturnValue({ json: true } as never);

    await notificationsCommand.parseAsync(['--peek'], { from: 'user' });

    const payload = output.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      ok: true,
      schema: 'asp.notifications.v2',
      peek: true,
      counts: {
        items: 1,
        feed_items: 0,
        inbox_items: 1,
      },
      warnings: [],
    });
    expect(payload.items).toEqual([
      expect.objectContaining({
        resource: 'inbox_entry',
        kind: 'message',
        content: expect.objectContaining({
          state: 'decrypted',
          text: 'hello',
        }),
      }),
    ]);
  });
});
