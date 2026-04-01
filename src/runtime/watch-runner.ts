import type { InboxEntry } from '../models/inbox-entry.js';
import { ASPClient } from '../lib/asp-client.js';
import type { ASPDeliveryMode } from '../lib/types.js';
import { getStorePaths } from '../store/index.js';
import { summarizeInboxEntry } from '../utils/inbox-display.js';
import {
  appendInboxWatchJournal,
  patchInboxWatchState,
  readInboxWatchState,
} from './watch-store.js';

export async function runInboxWatcher(input: {
  daemonChild?: boolean;
  quiet?: boolean;
} = {}): Promise<void> {
  const client = new ASPClient({ identityDir: getStorePaths().storeDir });
  const startedAt = new Date().toISOString();
  let stopped = false;

  await patchInboxWatchState({
    status: 'starting',
    pid: process.pid,
    mode: 'none',
    started_at: startedAt,
    last_error: null,
    event_count: 0,
    last_event_at: null,
    last_entry_id: null,
    last_entry_summary: null,
  });

  process.send?.({
    type: 'spawned',
    pid: process.pid,
    mode: client.deliveryMode,
  });

  const updateMode = (mode: ASPDeliveryMode) => {
    void patchInboxWatchState((current) => ({
      ...current,
      status: 'running',
      mode,
    }));
    if (!input.daemonChild && !input.quiet) {
      console.log(`Inbox watcher mode: ${mode}`);
    }
  };

  const handleEntry = (entry: InboxEntry) => {
    const summary = summarizeInboxEntry(entry);
    void appendInboxWatchJournal(entry);
    void patchInboxWatchState((current) => ({
      ...current,
      status: 'running',
      mode: client.deliveryMode,
      event_count: current.event_count + 1,
      last_event_at: new Date().toISOString(),
      last_entry_id: entry.id,
      last_entry_summary: summary,
      last_error: null,
    }));
  };

  const handleError = (error: Error) => {
    void patchInboxWatchState((current) => ({
      ...current,
      status: 'running',
      mode: client.deliveryMode,
      last_error: error.message,
    }));
  };

  const stop = async (nextStatus: 'stopped' | 'error', error?: Error) => {
    if (stopped) {
      return;
    }
    stopped = true;
    client.disconnect();
    await patchInboxWatchState((current) => ({
      ...current,
      status: nextStatus,
      pid: null,
      mode: 'none',
      last_error: error ? error.message : current.last_error,
    }));
  };

  client.on('delivery_mode_changed', updateMode);
  client.on('entry', handleEntry);
  client.on('error', handleError);

  const signalStop = () => {
    void stop('stopped').finally(() => process.exit(0));
  };

  process.on('SIGINT', signalStop);
  process.on('SIGTERM', signalStop);
  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    void stop('error', error).finally(() => process.exit(1));
  });
  process.on('uncaughtException', (error) => {
    void stop('error', error).finally(() => process.exit(1));
  });

  try {
    await client.connect();
    await patchInboxWatchState((current) => ({
      ...current,
      status: 'running',
      mode: client.deliveryMode,
      started_at: current.started_at ?? startedAt,
    }));

    if (!input.daemonChild && !input.quiet) {
      console.log(`Watching inbox via ${client.deliveryMode}. Press Ctrl+C to stop.`);
    }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    await stop('error', failure);
    throw failure;
  }

  await new Promise<void>((resolve) => {
    const interval = setInterval(async () => {
      const state = await readInboxWatchState();
      if (state.status === 'stopped' || state.status === 'error') {
        clearInterval(interval);
        resolve();
      }
    }, 1_000);
  });
}
