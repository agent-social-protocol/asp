import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadStatusCommand() {
  vi.doMock('../../store/index.js', () => ({
    storeInitialized: vi.fn().mockReturnValue(true),
  }));
  vi.doMock('../../store/manifest-store.js', () => ({
    readManifest: vi.fn().mockResolvedValue({
      entity: {
        id: 'https://alice.asp.social',
        type: 'person',
        handle: '@alice',
        name: 'Alice',
        tags: ['builders'],
      },
    }),
  }));
  vi.doMock('../../store/following-store.js', () => ({
    readFollowing: vi.fn().mockResolvedValue([]),
  }));
  vi.doMock('../../store/feed-store.js', () => ({
    readFeed: vi.fn().mockResolvedValue([]),
  }));
  vi.doMock('../../store/notification-store.js', () => ({
    readNotifications: vi.fn().mockResolvedValue({
      last_checked: '2026-04-01T00:00:00.000Z',
      new_posts: [],
      new_entries: [],
    }),
  }));
  vi.doMock('../../store/relationship-store.js', () => ({
    readRelationships: vi.fn().mockResolvedValue([]),
  }));
  vi.doMock('../../store/index-store.js', () => ({
    readIndexes: vi.fn().mockResolvedValue([]),
  }));
  vi.doMock('../../store/behavior-store.js', () => ({
    readBehavior: vi.fn().mockResolvedValue({ autonomy_level: 'manual' }),
  }));
  vi.doMock('../../utils/own-inbox.js', () => ({
    readOwnInboxPage: vi.fn().mockRejectedValue(new Error('Hub returned 503')),
  }));
  vi.doMock('../../utils/output.js', () => ({
    output: vi.fn(),
  }));
  vi.doMock('../../utils/remote-auth.js', () => ({
    isHosted: vi.fn().mockResolvedValue(true),
    handleFromEndpoint: vi.fn(() => 'alice'),
  }));

  const { statusCommand } = await import('../status.js');
  return { statusCommand };
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('status command', () => {
  it('degrades gracefully when inbox reads fail', async () => {
    const { statusCommand } = await loadStatusCommand();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await statusCommand.parseAsync([], { from: 'user' });

    expect(logSpy).toHaveBeenCalledWith('  Inbox entries: unavailable');
    expect(logSpy).toHaveBeenCalledWith('  Inbox warning: Hub returned 503');
    expect(process.exitCode).toBeUndefined();
  });
});
