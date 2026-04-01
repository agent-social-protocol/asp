import { afterEach, describe, expect, it, vi } from 'vitest';

function makeManifestYaml(): string {
  return [
    'protocol: asp/1.0',
    'entity:',
    '  id: https://bob.asp.social',
    '  type: person',
    '  name: Bob',
    '  handle: bob',
    'capabilities:',
    '  - feed',
    '  - inbox',
    'verification:',
    '  public_key: ed25519:test',
    '',
  ].join('\n');
}

async function loadFollowCommand(mocks?: {
  interactionResult?: {
    status: 'sent' | 'saved_locally' | 'error';
    remote_notified: boolean;
    saved_locally: boolean;
    warning?: string;
    error?: string;
  };
  addFollowingError?: Error;
}) {
  const addFollowing = vi.fn();
  if (mocks?.addFollowingError) {
    addFollowing.mockRejectedValue(mocks.addFollowingError);
  } else {
    addFollowing.mockResolvedValue(undefined);
  }

  vi.doMock('../../store/index.js', () => ({
    storeInitialized: vi.fn().mockReturnValue(true),
  }));
  vi.doMock('../../store/following-store.js', () => ({
    readFollowing: vi.fn().mockResolvedValue([]),
    addFollowing,
    removeFollowing: vi.fn(),
  }));
  vi.doMock('../interact.js', () => ({
    doInteraction: vi.fn().mockResolvedValue(mocks?.interactionResult ?? {
      status: 'sent',
      remote_notified: true,
      saved_locally: true,
    }),
  }));
  vi.doMock('../../identity/resolve-target.js', () => ({
    resolveEndpoint: vi.fn().mockResolvedValue('https://bob.asp.social'),
  }));
  vi.doMock('../../utils/remote-auth.js', () => ({
    handleFromEndpoint: vi.fn(() => 'bob'),
  }));
  vi.doMock('../../utils/output.js', () => ({
    output: vi.fn(),
  }));

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    text: async () => makeManifestYaml(),
  }));

  const { followCommand } = await import('../follow.js');
  return { followCommand, addFollowing };
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('follow command', () => {
  it('shows a local-only success message when remote notification fails', async () => {
    const { followCommand } = await loadFollowCommand({
      interactionResult: {
        status: 'saved_locally',
        remote_notified: false,
        saved_locally: true,
        warning: 'Could not notify: HTTP 400',
      },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await followCommand.parseAsync(['@bob'], { from: 'user' });

    expect(logSpy).toHaveBeenCalledWith('\n  ✓ Following @bob locally');
    expect(logSpy).toHaveBeenCalledWith('    (could not notify them: HTTP 400)');
    expect(process.exitCode).toBeUndefined();
  });

  it('fails when local following state cannot be saved', async () => {
    const { followCommand } = await loadFollowCommand({
      addFollowingError: new Error('disk full'),
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await followCommand.parseAsync(['@bob'], { from: 'user' });

    expect(logSpy).toHaveBeenCalledWith('\n  ✗ Could not follow @bob');
    expect(process.exitCode).toBe(1);
  });
});
