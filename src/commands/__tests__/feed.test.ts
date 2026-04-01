import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadFeedCommand() {
  const output = vi.fn();

  vi.doMock('../../store/index.js', () => ({
    storeInitialized: vi.fn().mockReturnValue(true),
  }));
  vi.doMock('../../store/following-store.js', () => ({
    readFollowing: vi.fn().mockResolvedValue([
      { url: 'https://bob.asp.social' },
    ]),
  }));
  vi.doMock('../../utils/fetch-feed.js', () => ({
    fetchFeed: vi.fn().mockResolvedValue({
      source: 'https://bob.asp.social',
      entries: [{
        id: 'post-1',
        title: 'Shipped inbox v2',
        published: '2026-04-01T10:00:00.000Z',
        topics: ['asp'],
        summary: 'Unified machine-readable inbox and notifications output.',
        author: 'https://bob.asp.social',
        signal_type: 'post',
      }],
    }),
  }));
  vi.doMock('../../utils/output.js', () => ({
    output,
  }));
  vi.doMock('../../utils/remote-auth.js', () => ({
    handleFromEndpoint: vi.fn((endpoint: string) => endpoint.includes('bob') ? 'bob' : null),
  }));

  const { feedCommand } = await import('../feed.js');
  return { feedCommand, output };
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('feed command', () => {
  it('returns normalized feed items in json mode', async () => {
    const { feedCommand, output } = await loadFeedCommand();
    vi.spyOn(feedCommand, 'optsWithGlobals').mockReturnValue({ json: true } as never);

    await feedCommand.parseAsync([], { from: 'user' });

    expect(output).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      schema: 'asp.feed.v2',
      counts: { items: 1 },
      warnings: [],
      items: [
        expect.objectContaining({
          resource: 'feed_entry',
          id: 'post-1',
          title: 'Shipped inbox v2',
          source: expect.objectContaining({
            id: 'https://bob.asp.social',
            handle: 'bob',
            display: '@bob',
          }),
        }),
      ],
    }), true);
  });
});
