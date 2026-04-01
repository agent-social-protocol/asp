import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { ASPDeliveryMode } from '../lib/types.js';
import {
  patchInboxWatchState,
  readInboxWatchJournal,
  readInboxWatchState,
  type InboxWatchJournalRecord,
  type InboxWatchState,
} from './watch-store.js';

interface SpawnedMessage {
  type: 'spawned';
  pid: number;
  mode?: ASPDeliveryMode;
}

export interface InboxWatchStatusView extends InboxWatchState {
  running: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isDeliveryMode(value: unknown): value is ASPDeliveryMode {
  return value === 'none' || value === 'poll' || value === 'stream';
}

function isSpawnedMessage(value: unknown): value is SpawnedMessage {
  return isRecord(value)
    && value.type === 'spawned'
    && typeof value.pid === 'number'
    && (value.mode === undefined || isDeliveryMode(value.mode));
}

function isProcessAlive(pid: number | null): boolean {
  if (!pid || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function resolveStatusView(): Promise<InboxWatchStatusView> {
  const state = await readInboxWatchState();
  const running = (state.status === 'starting' || state.status === 'running') && isProcessAlive(state.pid);
  if (running) {
    return { ...state, running: true };
  }

  if (state.status === 'starting' || state.status === 'running') {
    const repaired = await patchInboxWatchState((current) => ({
      ...current,
      status: current.last_error ? 'error' : 'stopped',
      pid: null,
      mode: 'none',
      last_error: current.last_error ?? 'Inbox watcher is not running',
    }));
    return { ...repaired, running: false };
  }

  return {
    ...state,
    pid: null,
    running: false,
  };
}

export async function getInboxWatchStatus(): Promise<InboxWatchStatusView> {
  return resolveStatusView();
}

export async function readInboxWatchRecent(limit: number): Promise<InboxWatchJournalRecord[]> {
  const journal = await readInboxWatchJournal();
  return journal.slice(-limit);
}

export async function startInboxWatchDaemon(input: {
  cliScriptPath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<
  | { status: 'already_running'; state: InboxWatchStatusView }
  | { status: 'started'; pid: number; mode: ASPDeliveryMode; state: InboxWatchStatusView }
> {
  const current = await resolveStatusView();
  if (current.running && current.pid) {
    return { status: 'already_running', state: current };
  }

  const child = spawn(process.execPath, [input.cliScriptPath, 'watch', 'run', '--daemon-child'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: input.env ?? process.env,
  });

  const started = await waitForDaemonSpawn(child);
  child.disconnect();
  child.unref();

  return {
    status: 'started',
    pid: started.pid,
    mode: started.mode,
    state: await resolveStatusView(),
  };
}

export async function stopInboxWatchDaemon(): Promise<
  | { status: 'not_running'; state: InboxWatchStatusView }
  | { status: 'stopped'; state: InboxWatchStatusView }
  | { status: 'timeout'; state: InboxWatchStatusView }
> {
  const current = await resolveStatusView();
  if (!current.running || !current.pid) {
    return { status: 'not_running', state: current };
  }

  try {
    process.kill(current.pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return { status: 'not_running', state: await resolveStatusView() };
    }
    throw error;
  }

  const exited = await waitForProcessExit(current.pid);
  const state = await resolveStatusView();
  return { status: exited ? 'stopped' : 'timeout', state };
}

async function waitForDaemonSpawn(child: ChildProcess): Promise<{ pid: number; mode: ASPDeliveryMode }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for inbox watcher to start'));
    }, 5_000);

    const cleanup = () => {
      clearTimeout(timeout);
      child.removeListener('message', onMessage);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    };

    const onMessage = (message: unknown) => {
      if (!isSpawnedMessage(message)) {
        return;
      }

      cleanup();
      resolve({
        pid: message.pid,
        mode: message.mode ?? 'none',
      });
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Inbox watcher exited before startup (code ${code ?? 'unknown'})`));
    };

    child.on('message', onMessage);
    child.on('error', onError);
    child.on('exit', onExit);
  });
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessAlive(pid);
}
