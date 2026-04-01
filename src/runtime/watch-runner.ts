import type { InboxEntry } from '../models/inbox-entry.js';
import { ASPClient } from '../lib/asp-client.js';
import type { ASPDeliveryMode } from '../lib/types.js';
import { getStorePaths } from '../store/index.js';
import { summarizeInboxEntry } from '../utils/inbox-display.js';
import {
  readInboxWatchJournal,
  writeInboxWatchJournal,
  writeInboxWatchState,
  type InboxWatchJournalRecord,
  type InboxWatchState,
} from './watch-store.js';

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function buildStartingState(startedAt: string): InboxWatchState {
  return {
    status: 'starting',
    pid: process.pid,
    mode: 'none',
    started_at: startedAt,
    updated_at: startedAt,
    last_event_at: null,
    last_error: null,
    event_count: 0,
    last_entry_id: null,
    last_entry_summary: null,
  };
}

function withUpdatedAt(state: InboxWatchState): InboxWatchState {
  return {
    ...state,
    updated_at: new Date().toISOString(),
  };
}

export async function runInboxWatcher(input: {
  daemonChild?: boolean;
  quiet?: boolean;
} = {}): Promise<void> {
  const client = new ASPClient({ identityDir: getStorePaths().storeDir });
  const startedAt = new Date().toISOString();
  let state = buildStartingState(startedAt);
  let journal = await readInboxWatchJournal();
  let stopped = false;
  let persistenceFailed = false;
  let resolveShutdown!: () => void;
  const shutdown = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  let persistenceQueue = Promise.resolve();

  const persistState = async () => {
    state = withUpdatedAt(state);
    await writeInboxWatchState(state);
  };

  const cleanupListeners = () => {
    client.off('delivery_mode_changed', updateMode);
    client.off('entry', handleEntry);
    client.off('error', handleError);
    process.off('SIGINT', signalStop);
    process.off('SIGTERM', signalStop);
    process.off('unhandledRejection', handleUnhandledRejection);
    process.off('uncaughtException', handleUncaughtException);
  };

  const stopWithPersistenceFailure = async (failure: Error) => {
    if (persistenceFailed) {
      return;
    }

    persistenceFailed = true;
    stopped = true;
    client.disconnect();
    state = {
      ...state,
      status: 'error',
      pid: null,
      mode: 'none',
      last_error: failure.message,
    };

    try {
      await persistState();
    } catch {
      if (!input.daemonChild && !input.quiet) {
        console.error(`Inbox watcher persistence failed: ${failure.message}`);
      }
    }

    cleanupListeners();
    process.exitCode = 1;
    resolveShutdown();
  };

  const enqueuePersistence = (task: () => Promise<void>) => {
    if (stopped) {
      return;
    }

    persistenceQueue = persistenceQueue
      .then(async () => {
        if (stopped) {
          return;
        }
        await task();
      })
      .catch(async (error) => {
        await stopWithPersistenceFailure(toError(error));
      });
  };

  const updateMode = (mode: ASPDeliveryMode) => {
    enqueuePersistence(async () => {
      state = {
        ...state,
        status: 'running',
        mode,
      };
      await persistState();
    });

    if (!input.daemonChild && !input.quiet) {
      console.log(`Inbox watcher mode: ${mode}`);
    }
  };

  const handleEntry = (entry: InboxEntry) => {
    const summary = summarizeInboxEntry(entry);
    const receivedAt = new Date().toISOString();
    const deliveryMode = client.deliveryMode;

    enqueuePersistence(async () => {
      const record: InboxWatchJournalRecord = {
        received_at: receivedAt,
        summary,
        entry,
      };
      journal = await writeInboxWatchJournal([...journal, record]);
      state = {
        ...state,
        status: 'running',
        mode: deliveryMode,
        event_count: state.event_count + 1,
        last_event_at: receivedAt,
        last_entry_id: entry.id,
        last_entry_summary: summary,
        last_error: null,
      };
      await persistState();
    });
  };

  const handleError = (error: Error) => {
    const deliveryMode = client.deliveryMode;

    enqueuePersistence(async () => {
      state = {
        ...state,
        status: 'running',
        mode: deliveryMode,
        last_error: error.message,
      };
      await persistState();
    });
  };

  const stop = async (nextStatus: 'stopped' | 'error', error?: Error) => {
    if (stopped) {
      return;
    }

    stopped = true;
    client.disconnect();
    await persistenceQueue;
    if (persistenceFailed) {
      return;
    }
    state = {
      ...state,
      status: nextStatus,
      pid: null,
      mode: 'none',
      last_error: error ? error.message : state.last_error,
    };

    try {
      await persistState();
    } finally {
      cleanupListeners();
      if (nextStatus === 'error') {
        process.exitCode = 1;
      }
      resolveShutdown();
    }
  };

  const signalStop = () => {
    void stop('stopped');
  };

  const handleUnhandledRejection = (reason: unknown) => {
    void stop('error', toError(reason));
  };

  const handleUncaughtException = (error: Error) => {
    void stop('error', error);
  };

  await persistState();

  if (input.daemonChild && typeof process.send === 'function') {
    process.send({
      type: 'spawned',
      pid: process.pid,
      mode: client.deliveryMode,
    });
  }

  client.on('delivery_mode_changed', updateMode);
  client.on('entry', handleEntry);
  client.on('error', handleError);
  process.on('SIGINT', signalStop);
  process.on('SIGTERM', signalStop);
  process.on('unhandledRejection', handleUnhandledRejection);
  process.on('uncaughtException', handleUncaughtException);

  try {
    await client.connect();
    await persistenceQueue;
    if (!stopped) {
      state = {
        ...state,
        status: 'running',
        mode: client.deliveryMode,
        started_at: state.started_at ?? startedAt,
      };
      await persistState();
    }

    if (!input.daemonChild && !input.quiet) {
      console.log(`Watching inbox via ${client.deliveryMode}. Press Ctrl+C to stop.`);
    }
  } catch (error) {
    const failure = toError(error);
    if (!stopped) {
      await stop('error', failure);
      throw failure;
    }
  }

  await shutdown;
}
