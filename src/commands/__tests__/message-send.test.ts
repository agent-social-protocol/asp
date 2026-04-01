import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadMessageCommand() {
  const addMessage = vi.fn().mockResolvedValue(undefined);
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });

  vi.doMock('../../store/index.js', () => ({
    getStorePaths: vi.fn().mockReturnValue({
      encryptionKeyPath: '/tmp/encryption.pem',
      privateKeyPath: '/tmp/private.pem',
    }),
    storeInitialized: vi.fn().mockReturnValue(true),
  }));
  vi.doMock('../../store/manifest-store.js', () => ({
    readManifest: vi.fn().mockResolvedValue({
      entity: { id: 'https://alice.asp.social' },
    }),
  }));
  vi.doMock('../../store/inbox-store.js', () => ({
    addMessage,
  }));
  vi.doMock('../../utils/send-message.js', () => ({
    sendMessage,
  }));
  vi.doMock('../../utils/output.js', () => ({
    output: vi.fn(),
  }));
  vi.doMock('../../utils/encrypt-message.js', async () => {
    const actual = await vi.importActual<typeof import('../../utils/encrypt-message.js')>('../../utils/encrypt-message.js');
    return {
      ...actual,
      getRecipientEncryptionKey: vi.fn().mockResolvedValue({ status: 'unsupported' }),
    };
  });
  vi.doMock('../../identity/resolve-target.js', () => ({
    resolveEndpoint: vi.fn().mockResolvedValue('https://bob.asp.social'),
  }));
  vi.doMock('node:fs', () => ({
    existsSync: vi.fn().mockReturnValue(false),
  }));
  vi.doMock('node:fs/promises', () => ({
    readFile: vi.fn(),
  }));

  const { messageCommand } = await import('../message.js');
  return { messageCommand, addMessage, sendMessage };
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('message command send path', () => {
  it('defaults message intent to chat when --intent is omitted', async () => {
    const { messageCommand, addMessage, sendMessage } = await loadMessageCommand();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await messageCommand.parseAsync(['@bob', '--text', 'Hey, got a minute?'], { from: 'user' });

    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({
      intent: 'chat',
    }));
    expect(sendMessage).toHaveBeenCalledWith(
      'https://bob.asp.social',
      expect.objectContaining({
        intent: 'chat',
        content: expect.objectContaining({
          text: 'Hey, got a minute?',
        }),
      }),
    );
    expect(logSpy).toHaveBeenCalledWith('Message sent to https://bob.asp.social');
  });
});
