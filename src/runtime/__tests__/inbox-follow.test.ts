import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboxEntry } from '../../models/inbox-entry.js';

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('inbox follow runtime', () => {
  it('streams connected and entry events as json lines until aborted', async () => {
    let client: MockASPClient | null = null;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.doMock('../../lib/asp-client.js', () => ({
      ASPClient: vi.fn().mockImplementation(() => {
        client = new MockASPClient();
        return client;
      }),
    }));
    vi.doMock('../../store/index.js', () => ({
      getStorePaths: vi.fn().mockReturnValue({ storeDir: '/tmp/asp-test' }),
    }));

    const { runInboxFollow } = await import('../inbox-follow.js');
    const controller = new AbortController();
    const followPromise = runInboxFollow({
      json: true,
      signal: controller.signal,
      type: 'follow',
    });
    await flushMicrotasks();

    const followEntry: InboxEntry = {
      id: 'follow-1',
      from: 'https://bob.asp.social',
      to: 'https://alice.asp.social',
      kind: 'interaction',
      type: 'follow',
      timestamp: '2026-04-01T11:00:00.000Z',
      received_at: '2026-04-01T11:00:01.000Z',
      signature: 'sig-follow',
    };
    const otherEntry: InboxEntry = {
      id: 'wave-1',
      from: 'https://carol.asp.social',
      to: 'https://alice.asp.social',
      kind: 'interaction',
      type: 'wave',
      timestamp: '2026-04-01T11:01:00.000Z',
      received_at: '2026-04-01T11:01:01.000Z',
      signature: 'sig-wave',
    };

    client?.emit('entry', followEntry);
    client?.emit('entry', otherEntry);
    await flushMicrotasks();

    controller.abort();
    await followPromise;

    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({
      type: 'mode',
      mode: 'stream',
    }));
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({
      type: 'connected',
      mode: 'stream',
    }));
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({
      type: 'entry',
      cursor: '2026-04-01T11:00:01.000Z',
      entry: followEntry,
    }));
    expect(logSpy).not.toHaveBeenCalledWith(JSON.stringify({
      type: 'entry',
      cursor: '2026-04-01T11:01:01.000Z',
      entry: otherEntry,
    }));
    expect(client?.disconnect).toHaveBeenCalled();
  });
});
