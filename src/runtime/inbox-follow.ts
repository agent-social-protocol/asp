import type { InboxEntry, InboxEntryKind } from '../models/inbox-entry.js';
import { getInboxEntryCursor } from '../models/inbox-entry.js';
import { ASPClient } from '../lib/asp-client.js';
import { getStorePaths } from '../store/index.js';
import { summarizeInboxEntry } from '../utils/inbox-display.js';

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function matchesFollowFilter(entry: InboxEntry, filters: {
  thread?: string;
  kind?: InboxEntryKind;
  type?: string;
}): boolean {
  if (filters.thread && entry.kind === 'message' && entry.thread_id !== filters.thread) {
    return false;
  }

  if (filters.thread && entry.kind !== 'message') {
    return false;
  }

  if (filters.kind && entry.kind !== filters.kind) {
    return false;
  }

  if (filters.type && entry.type !== filters.type) {
    return false;
  }

  return true;
}

export async function runInboxFollow(input: {
  json?: boolean;
  thread?: string;
  kind?: InboxEntryKind;
  type?: string;
  signal?: AbortSignal;
} = {}): Promise<void> {
  const client = new ASPClient({ identityDir: getStorePaths().storeDir });
  let stopped = false;
  let resolveShutdown!: () => void;
  const shutdown = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });

  const cleanupListeners = () => {
    client.off('delivery_mode_changed', handleMode);
    client.off('entry', handleEntry);
    client.off('error', handleError);
    process.off('SIGINT', handleStopSignal);
    process.off('SIGTERM', handleStopSignal);
    input.signal?.removeEventListener('abort', handleAbort);
  };

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    client.disconnect();
    cleanupListeners();
    resolveShutdown();
  };

  const handleStopSignal = () => {
    stop();
  };

  const handleAbort = () => {
    stop();
  };

  const handleMode = () => {
    if (client.deliveryMode === 'none') {
      return;
    }

    if (input.json) {
      console.log(JSON.stringify({
        type: 'mode',
        mode: client.deliveryMode,
      }));
      return;
    }

    console.log(`Inbox follow mode: ${client.deliveryMode}`);
  };

  const handleEntry = (entry: InboxEntry) => {
    if (!matchesFollowFilter(entry, input)) {
      return;
    }

    if (input.json) {
      console.log(JSON.stringify({
        type: 'entry',
        cursor: getInboxEntryCursor(entry),
        entry,
      }));
      return;
    }

    console.log(`[${entry.type}] ${summarizeInboxEntry(entry)}`);
  };

  const handleError = (error: Error) => {
    if (input.json) {
      console.log(JSON.stringify({
        type: 'error',
        error: error.message,
      }));
      return;
    }

    console.error(`Inbox follow error: ${error.message}`);
  };

  client.on('delivery_mode_changed', handleMode);
  client.on('entry', handleEntry);
  client.on('error', handleError);
  process.on('SIGINT', handleStopSignal);
  process.on('SIGTERM', handleStopSignal);

  if (input.signal) {
    if (input.signal.aborted) {
      stop();
      return;
    } else {
      input.signal.addEventListener('abort', handleAbort, { once: true });
    }
  }

  try {
    await client.connect();
    if (stopped) {
      return;
    }

    if (input.json) {
      console.log(JSON.stringify({
        type: 'connected',
        mode: client.deliveryMode,
      }));
    } else {
      console.log(`Following inbox via ${client.deliveryMode}. Press Ctrl+C to stop.`);
    }
  } catch (error) {
    cleanupListeners();
    if (stopped) {
      return;
    }
    throw toError(error);
  }

  await shutdown;
}
