import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboxWatchState } from '../watch-store.js';

class FakeChildProcess extends EventEmitter {
  pid: number;
  disconnect = vi.fn();
  unref = vi.fn();

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

function buildState(overrides: Partial<InboxWatchState> = {}): InboxWatchState {
  return {
    status: 'stopped',
    pid: null,
    mode: 'none',
    started_at: null,
    updated_at: '2026-04-01T00:00:00.000Z',
    last_event_at: null,
    last_error: null,
    event_count: 0,
    last_entry_id: null,
    last_entry_summary: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('watch control', () => {
  it('starts the watcher daemon and returns its pid', async () => {
    const child = new FakeChildProcess(4321);
    const spawn = vi.fn().mockImplementation(() => {
      queueMicrotask(() => {
        child.emit('message', { type: 'spawned', pid: 4321, mode: 'stream' });
      });
      return child;
    });
    const readInboxWatchState = vi.fn()
      .mockResolvedValueOnce(buildState())
      .mockResolvedValueOnce(buildState({
        status: 'starting',
        pid: 4321,
        mode: 'stream',
        started_at: '2026-04-01T00:00:00.000Z',
      }));

    vi.doMock('node:child_process', () => ({ spawn }));
    vi.doMock('../watch-store.js', () => ({
      readInboxWatchState,
      patchInboxWatchState: vi.fn(),
      readInboxWatchJournal: vi.fn().mockResolvedValue([]),
    }));

    const { startInboxWatchDaemon } = await import('../watch-control.js');
    const result = await startInboxWatchDaemon({
      cliScriptPath: '/tmp/asp.js',
      env: { TEST: '1' },
    });

    expect(result).toMatchObject({
      status: 'started',
      pid: 4321,
      mode: 'stream',
    });
    expect(spawn).toHaveBeenCalledWith(process.execPath, ['/tmp/asp.js', 'watch', 'run', '--daemon-child'], expect.any(Object));
    expect(child.disconnect).toHaveBeenCalledTimes(1);
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it('repairs stale running state when the watcher pid is gone', async () => {
    const readInboxWatchState = vi.fn().mockResolvedValue(buildState({
      status: 'running',
      pid: 9999,
      mode: 'stream',
      started_at: '2026-04-01T00:00:00.000Z',
    }));
    const patchInboxWatchState = vi.fn().mockResolvedValue(buildState({
      status: 'error',
      pid: null,
      mode: 'none',
      last_error: 'Inbox watcher is not running',
    }));

    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });
    vi.doMock('../watch-store.js', () => ({
      readInboxWatchState,
      patchInboxWatchState,
      readInboxWatchJournal: vi.fn().mockResolvedValue([]),
    }));

    const { getInboxWatchStatus } = await import('../watch-control.js');
    const result = await getInboxWatchStatus();

    expect(result).toMatchObject({
      running: false,
      status: 'error',
      pid: null,
    });
    expect(patchInboxWatchState).toHaveBeenCalledTimes(1);
  });

  it('stops the watcher daemon with SIGTERM', async () => {
    let alive = true;
    const readInboxWatchState = vi.fn()
      .mockResolvedValueOnce(buildState({
        status: 'running',
        pid: 2468,
        mode: 'stream',
      }))
      .mockResolvedValueOnce(buildState({
        status: 'stopped',
        pid: null,
        mode: 'none',
      }));

    vi.spyOn(process, 'kill').mockImplementation((_pid: number, signal?: number | NodeJS.Signals) => {
      if (signal === 'SIGTERM') {
        alive = false;
        return true as never;
      }
      if (signal === 0 || signal === undefined) {
        if (alive) {
          return true as never;
        }
        throw new Error('ESRCH');
      }
      return true as never;
    });
    vi.doMock('../watch-store.js', () => ({
      readInboxWatchState,
      patchInboxWatchState: vi.fn(),
      readInboxWatchJournal: vi.fn().mockResolvedValue([]),
    }));

    const { stopInboxWatchDaemon } = await import('../watch-control.js');
    const result = await stopInboxWatchDaemon();

    expect(result).toMatchObject({
      status: 'stopped',
    });
    expect(process.kill).toHaveBeenCalledWith(2468, 'SIGTERM');
  });

  it('returns timeout when the watcher does not exit after SIGTERM', async () => {
    vi.useFakeTimers();

    const readInboxWatchState = vi.fn()
      .mockResolvedValueOnce(buildState({
        status: 'running',
        pid: 1357,
        mode: 'stream',
      }))
      .mockResolvedValueOnce(buildState({
        status: 'running',
        pid: 1357,
        mode: 'stream',
      }));

    vi.spyOn(process, 'kill').mockImplementation((_pid: number, signal?: number | NodeJS.Signals) => {
      if (signal === 'SIGTERM' || signal === 0 || signal === undefined) {
        return true as never;
      }
      return true as never;
    });
    vi.doMock('../watch-store.js', () => ({
      readInboxWatchState,
      patchInboxWatchState: vi.fn(),
      readInboxWatchJournal: vi.fn().mockResolvedValue([]),
    }));

    const { stopInboxWatchDaemon } = await import('../watch-control.js');
    const stopPromise = stopInboxWatchDaemon();
    await vi.advanceTimersByTimeAsync(3_100);
    const result = await stopPromise;

    expect(result).toMatchObject({
      status: 'timeout',
      state: {
        status: 'running',
        pid: 1357,
      },
    });

  });
});
