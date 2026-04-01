import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadInboxCommand(options: {
  entries?: Array<Record<string, unknown>>;
  encryptionKeyAvailable?: boolean;
  decryptThrows?: boolean;
} = {}) {
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
  vi.doMock('../../utils/own-inbox.js', () => ({
    readOwnInboxPage: vi.fn().mockResolvedValue({
      entries: options.entries ?? [{
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
  vi.doMock('../../utils/output.js', () => ({
    output,
  }));
  vi.doMock('../../utils/remote-auth.js', () => ({
    handleFromEndpoint: vi.fn((endpoint: string) => endpoint.includes('bob') ? 'bob' : null),
  }));
  vi.doMock('../../runtime/inbox-follow.js', () => ({
    runInboxFollow: vi.fn().mockResolvedValue(undefined),
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
          intent: 'note',
          content: { text: 'hello' },
          initiated_by: 'human' as const,
        };
      }),
    };
  });

  const { inboxCommand } = await import('../message.js');
  const { runInboxFollow } = await import('../../runtime/inbox-follow.js');
  return { inboxCommand, output, runInboxFollow };
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

  it('surfaces a warning when an encrypted inbox entry cannot be decrypted locally', async () => {
    const { inboxCommand } = await loadInboxCommand({
      encryptionKeyAvailable: true,
      decryptThrows: true,
      entries: [{
        id: 'msg-1',
        from: 'https://bob.asp.social',
        to: 'https://alice.asp.social',
        kind: 'message',
        type: 'note',
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
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await inboxCommand.parseAsync([], { from: 'user' });

    expect(logSpy).toHaveBeenCalledWith('Warning: 1 encrypted inbox entry could not be decrypted locally.');
  });

  it('returns one normalized item array in json mode without duplicate projections', async () => {
    const { inboxCommand, output } = await loadInboxCommand({
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
        thread_id: 'thread-1',
        content: {
          text: 'hello',
        },
      }],
    });
    vi.spyOn(inboxCommand, 'optsWithGlobals').mockReturnValue({ json: true } as never);

    await inboxCommand.parseAsync([], { from: 'user' });

    const payload = output.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      ok: true,
      schema: 'asp.inbox.v2',
      page: { next_cursor: null },
      warnings: [],
    });
    expect(payload).not.toHaveProperty('messages');
    expect(payload).not.toHaveProperty('interactions');
    expect(payload).not.toHaveProperty('entries');
    expect(payload.items).toEqual([
      expect.objectContaining({
        resource: 'inbox_entry',
        kind: 'message',
        type: 'chat',
        actor: expect.objectContaining({
          id: 'https://bob.asp.social',
          handle: 'bob',
          display: '@bob',
        }),
        content: expect.objectContaining({
          state: 'decrypted',
          text: 'hello',
          preview: 'hello',
        }),
        affordances: {
          reply: {
            to: 'https://bob.asp.social',
            reply_to: 'msg-1',
            thread_id: 'thread-1',
          },
        },
      }),
    ]);
  });

  it('delegates inbox --follow to the foreground follow runtime', async () => {
    const { inboxCommand, runInboxFollow } = await loadInboxCommand();

    await inboxCommand.parseAsync(['--follow', '--type', 'follow'], { from: 'user' });

    expect(runInboxFollow).toHaveBeenCalledWith({
      json: undefined,
      thread: undefined,
      type: 'follow',
      kind: undefined,
    });
  });

  it('fails fast when inbox --follow is used with sent direction', async () => {
    const { inboxCommand, runInboxFollow, output } = await loadInboxCommand();

    await inboxCommand.parseAsync(['--follow', '--direction', 'sent'], { from: 'user' });

    expect(runInboxFollow).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(output).toHaveBeenCalledWith('`asp inbox --follow` only supports received inbox activity.', undefined);
  });
});
