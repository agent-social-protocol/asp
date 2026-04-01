import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboxEntry } from '../../models/inbox-entry.js';
import type { InboxWatchJournalRecord, InboxWatchState } from '../watch-store.js';

class MockASPClient extends EventEmitter {
  deliveryMode: 'none' | 'poll' | 'stream' = 'none';
  disconnect = vi.fn(() => {
    this.deliveryMode = 'none';
  });

  async connect(): Promise<void> {
    this.deliveryMode = 'stream';
    this.emit('delivery_mode_changed', 'stream');
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function setProcessSendMock() {
  const sendSpy = vi.fn();
  Object.defineProperty(process, 'send', {
    configurable: true,
    writable: true,
    value: sendSpy,
  });
  return sendSpy;
}

const originalProcessSend = process.send;

afterEach(() => {
  Object.defineProperty(process, 'send', {
    configurable: true,
    writable: true,
    value: originalProcessSend,
  });
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('watch runner', () => {
  it('serializes journal and state writes across multiple entries', async () => {
    let client: MockASPClient | null = null;
    const stateWrites: InboxWatchState[] = [];
    const journalWrites: InboxWatchJournalRecord[][] = [];

    vi.doMock('../../lib/asp-client.js', () => ({
      ASPClient: vi.fn().mockImplementation(() => {
        client = new MockASPClient();
        return client;
      }),
    }));
    vi.doMock('../../store/index.js', () => ({
      getStorePaths: vi.fn().mockReturnValue({ storeDir: '/tmp/asp-test' }),
    }));
    vi.doMock('../watch-store.js', () => ({
      readInboxWatchJournal: vi.fn().mockResolvedValue([]),
      writeInboxWatchJournal: vi.fn().mockImplementation(async (records: InboxWatchJournalRecord[]) => {
        journalWrites.push(structuredClone(records));
        return records;
      }),
      writeInboxWatchState: vi.fn().mockImplementation(async (state: InboxWatchState) => {
        stateWrites.push(structuredClone(state));
      }),
    }));
    const sendSpy = setProcessSendMock();

    const { runInboxWatcher } = await import('../watch-runner.js');
    const runPromise = runInboxWatcher({ daemonChild: false, quiet: true });
    await flushMicrotasks();

    const firstEntry: InboxEntry = {
      id: 'entry-1',
      from: 'https://bob.asp.social',
      to: 'https://alice.asp.social',
      kind: 'interaction',
      type: 'follow',
      timestamp: '2026-04-01T10:00:00.000Z',
      received_at: '2026-04-01T10:00:01.000Z',
      signature: 'sig-1',
    };
    const secondEntry: InboxEntry = {
      id: 'entry-2',
      from: 'https://carol.asp.social',
      to: 'https://alice.asp.social',
      kind: 'interaction',
      type: 'wave',
      timestamp: '2026-04-01T10:01:00.000Z',
      received_at: '2026-04-01T10:01:01.000Z',
      signature: 'sig-2',
    };

    client?.emit('entry', firstEntry);
    client?.emit('entry', secondEntry);
    await flushMicrotasks();
    await flushMicrotasks();

    process.emit('SIGTERM', 'SIGTERM');
    await runPromise;

    expect(journalWrites.at(-1)).toHaveLength(2);
    expect(journalWrites.at(-1)?.map((record) => record.entry.id)).toEqual(['entry-1', 'entry-2']);
    expect(stateWrites.at(-1)).toMatchObject({
      status: 'stopped',
      pid: null,
      mode: 'none',
      event_count: 2,
      last_entry_id: 'entry-2',
    });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(client?.disconnect).toHaveBeenCalled();
  });

  it('sends the spawned handshake only for daemon children', async () => {
    let client: MockASPClient | null = null;

    vi.doMock('../../lib/asp-client.js', () => ({
      ASPClient: vi.fn().mockImplementation(() => {
        client = new MockASPClient();
        return client;
      }),
    }));
    vi.doMock('../../store/index.js', () => ({
      getStorePaths: vi.fn().mockReturnValue({ storeDir: '/tmp/asp-test' }),
    }));
    vi.doMock('../watch-store.js', () => ({
      readInboxWatchJournal: vi.fn().mockResolvedValue([]),
      writeInboxWatchJournal: vi.fn().mockResolvedValue([]),
      writeInboxWatchState: vi.fn().mockResolvedValue(undefined),
    }));
    const sendSpy = setProcessSendMock();

    const { runInboxWatcher } = await import('../watch-runner.js');
    const runPromise = runInboxWatcher({ daemonChild: true, quiet: true });
    await flushMicrotasks();

    process.emit('SIGTERM', 'SIGTERM');
    await runPromise;

    expect(sendSpy).toHaveBeenCalledWith({
      type: 'spawned',
      pid: process.pid,
      mode: 'none',
    });
    expect(client?.disconnect).toHaveBeenCalled();
  });

  it('keeps the final state as error when journal persistence fails during shutdown', async () => {
    let client: MockASPClient | null = null;
    const stateWrites: InboxWatchState[] = [];
    let rejectJournalWrite!: (error: Error) => void;
    let resolveJournalWriteStarted!: () => void;
    const journalWriteStarted = new Promise<void>((resolve) => {
      resolveJournalWriteStarted = resolve;
    });

    vi.doMock('../../lib/asp-client.js', () => ({
      ASPClient: vi.fn().mockImplementation(() => {
        client = new MockASPClient();
        return client;
      }),
    }));
    vi.doMock('../../store/index.js', () => ({
      getStorePaths: vi.fn().mockReturnValue({ storeDir: '/tmp/asp-test' }),
    }));
    vi.doMock('../watch-store.js', () => ({
      readInboxWatchJournal: vi.fn().mockResolvedValue([]),
      writeInboxWatchJournal: vi.fn().mockImplementation(() => new Promise<InboxWatchJournalRecord[]>((_resolve, reject) => {
        resolveJournalWriteStarted();
        rejectJournalWrite = reject;
      })),
      writeInboxWatchState: vi.fn().mockImplementation(async (state: InboxWatchState) => {
        stateWrites.push(structuredClone(state));
      }),
    }));
    setProcessSendMock();

    const { runInboxWatcher } = await import('../watch-runner.js');
    const runPromise = runInboxWatcher({ daemonChild: false, quiet: true });
    await flushMicrotasks();

    client?.emit('entry', {
      id: 'entry-1',
      from: 'https://bob.asp.social',
      to: 'https://alice.asp.social',
      kind: 'interaction',
      type: 'follow',
      timestamp: '2026-04-01T10:00:00.000Z',
      received_at: '2026-04-01T10:00:01.000Z',
      signature: 'sig-1',
    } satisfies InboxEntry);
    await journalWriteStarted;
    process.emit('SIGTERM', 'SIGTERM');
    rejectJournalWrite(new Error('disk full'));
    await runPromise;

    expect(stateWrites.at(-1)).toMatchObject({
      status: 'error',
      pid: null,
      mode: 'none',
      last_error: 'disk full',
    });
    expect(process.exitCode).toBe(1);
  });
});
