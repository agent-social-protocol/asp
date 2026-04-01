import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboxEntry } from '../../models/inbox-entry.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('readOwnInboxPage', () => {
  it('reads hosted inbox entries through the protocol inbox endpoint', async () => {
    const entry: InboxEntry = {
      id: 'follow-1',
      from: 'https://bob.asp.social',
      to: 'https://alice.asp.social',
      kind: 'interaction',
      type: 'follow',
      timestamp: '2026-03-31T10:00:00.000Z',
      received_at: '2026-03-31T10:00:01.000Z',
      signature: 'sig',
    };

    vi.doMock('../remote-auth.js', () => ({
      isHosted: vi.fn().mockResolvedValue(true),
      buildAuthHeader: vi.fn().mockResolvedValue('ASP-Sig test'),
    }));
    vi.doMock('../../store/manifest-store.js', () => ({
      readManifest: vi.fn().mockResolvedValue({
        entity: { id: 'https://alice.asp.social' },
      }),
    }));
    vi.doMock('../../store/inbox-store.js', () => ({
      readInbox: vi.fn(),
    }));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ entries: [entry], next_cursor: 'cursor-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { readOwnInboxPage } = await import('../own-inbox.js');
    const result = await readOwnInboxPage({
      direction: 'received',
      kind: 'interaction',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://alice.asp.social/asp/inbox?kind=interaction&direction=received',
      expect.objectContaining({
        headers: { Authorization: 'ASP-Sig test' },
      }),
    );
    expect(result.entries).toEqual([entry]);
    expect(result.nextCursor).toBe('cursor-1');
  });

  it('filters local inbox entries by direction, kind, and since', async () => {
    vi.doMock('../remote-auth.js', () => ({
      isHosted: vi.fn().mockResolvedValue(false),
      buildAuthHeader: vi.fn(),
    }));
    vi.doMock('../../store/manifest-store.js', () => ({
      readManifest: vi.fn(),
    }));
    vi.doMock('../../store/inbox-store.js', () => ({
      readInbox: vi.fn().mockResolvedValue({
        sent: [{
          id: 'message-1',
          from: 'https://alice.asp.social',
          to: 'https://bob.asp.social',
          kind: 'message',
          type: 'note',
          timestamp: '2026-03-31T09:00:00.000Z',
          initiated_by: 'human',
          content: { text: 'hello' },
        }],
        received: [
          {
            id: 'follow-1',
            from: 'https://bob.asp.social',
            to: 'https://alice.asp.social',
            kind: 'interaction',
            type: 'follow',
            timestamp: '2026-03-31T09:30:00.000Z',
            received_at: '2026-03-31T09:30:01.000Z',
            signature: 'sig',
          },
          {
            id: 'follow-2',
            from: 'https://carol.asp.social',
            to: 'https://alice.asp.social',
            kind: 'interaction',
            type: 'follow',
            timestamp: '2026-03-31T11:00:00.000Z',
            received_at: '2026-03-31T11:00:01.000Z',
            signature: 'sig',
          },
        ],
      }),
    }));

    const { readOwnInboxPage } = await import('../own-inbox.js');
    const result = await readOwnInboxPage({
      direction: 'received',
      kind: 'interaction',
      since: '2026-03-31T10:00:00.000Z',
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.id).toBe('follow-2');
    expect(result.nextCursor).toBeNull();
  });
});
