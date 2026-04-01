import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadNotificationsCommand() {
  const updateLastChecked = vi.fn().mockResolvedValue(undefined);

  vi.doMock('../../store/index.js', () => ({
    storeInitialized: vi.fn().mockReturnValue(true),
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
    readOwnInboxPage: vi.fn().mockResolvedValue({ entries: [], nextCursor: null }),
  }));
  vi.doMock('../../utils/output.js', () => ({
    output: vi.fn(),
  }));

  const { notificationsCommand } = await import('../notifications.js');
  return { notificationsCommand, updateLastChecked };
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
});
