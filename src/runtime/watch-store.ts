import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { InboxEntry } from '../models/inbox-entry.js';
import type { ASPDeliveryMode } from '../lib/types.js';
import { getStorePaths } from '../store/index.js';
import { summarizeInboxEntry } from '../utils/inbox-display.js';

const WATCH_JOURNAL_LIMIT = 100;

export type InboxWatchStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface InboxWatchState {
  status: InboxWatchStatus;
  pid: number | null;
  mode: ASPDeliveryMode;
  started_at: string | null;
  updated_at: string;
  last_event_at: string | null;
  last_error: string | null;
  event_count: number;
  last_entry_id: string | null;
  last_entry_summary: string | null;
}

export interface InboxWatchJournalRecord {
  received_at: string;
  summary: string;
  entry: InboxEntry;
}

function buildDefaultState(): InboxWatchState {
  return {
    status: 'stopped',
    pid: null,
    mode: 'none',
    started_at: null,
    updated_at: new Date(0).toISOString(),
    last_event_at: null,
    last_error: null,
    event_count: 0,
    last_entry_id: null,
    last_entry_summary: null,
  };
}

export function getInboxWatchPaths(): { runtimeDir: string; statePath: string; journalPath: string } {
  const { runtimeDir } = getStorePaths();
  return {
    runtimeDir,
    statePath: `${runtimeDir}/inbox-watch.json`,
    journalPath: `${runtimeDir}/inbox-watch-events.json`,
  };
}

export async function ensureInboxWatchRuntimeDir(): Promise<void> {
  const { runtimeDir } = getInboxWatchPaths();
  if (!existsSync(runtimeDir)) {
    await mkdir(runtimeDir, { recursive: true });
  }
}

export async function readInboxWatchState(): Promise<InboxWatchState> {
  const { statePath } = getInboxWatchPaths();
  if (!existsSync(statePath)) {
    return buildDefaultState();
  }

  const parsed = JSON.parse(await readFile(statePath, 'utf-8')) as Partial<InboxWatchState>;
  return {
    ...buildDefaultState(),
    ...parsed,
    status: parsed.status ?? 'stopped',
    pid: typeof parsed.pid === 'number' ? parsed.pid : null,
    mode: parsed.mode ?? 'none',
    started_at: typeof parsed.started_at === 'string' ? parsed.started_at : null,
    updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : new Date().toISOString(),
    last_event_at: typeof parsed.last_event_at === 'string' ? parsed.last_event_at : null,
    last_error: typeof parsed.last_error === 'string' ? parsed.last_error : null,
    event_count: typeof parsed.event_count === 'number' ? parsed.event_count : 0,
    last_entry_id: typeof parsed.last_entry_id === 'string' ? parsed.last_entry_id : null,
    last_entry_summary: typeof parsed.last_entry_summary === 'string' ? parsed.last_entry_summary : null,
  };
}

export async function writeInboxWatchState(state: InboxWatchState): Promise<void> {
  await ensureInboxWatchRuntimeDir();
  const { statePath } = getInboxWatchPaths();
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

export async function patchInboxWatchState(
  patch: Partial<InboxWatchState> | ((current: InboxWatchState) => InboxWatchState),
): Promise<InboxWatchState> {
  const current = await readInboxWatchState();
  const next = typeof patch === 'function'
    ? patch(current)
    : {
      ...current,
      ...patch,
    };
  next.updated_at = new Date().toISOString();
  await writeInboxWatchState(next);
  return next;
}

export async function readInboxWatchJournal(): Promise<InboxWatchJournalRecord[]> {
  const { journalPath } = getInboxWatchPaths();
  if (!existsSync(journalPath)) {
    return [];
  }

  const parsed = JSON.parse(await readFile(journalPath, 'utf-8')) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((value): value is InboxWatchJournalRecord => {
    return !!value
      && typeof value === 'object'
      && typeof (value as InboxWatchJournalRecord).received_at === 'string'
      && typeof (value as InboxWatchJournalRecord).summary === 'string'
      && typeof (value as InboxWatchJournalRecord).entry?.id === 'string';
  });
}

export async function appendInboxWatchJournal(entry: InboxEntry): Promise<InboxWatchJournalRecord[]> {
  await ensureInboxWatchRuntimeDir();
  const { journalPath } = getInboxWatchPaths();
  const current = await readInboxWatchJournal();
  current.push({
    received_at: new Date().toISOString(),
    summary: summarizeInboxEntry(entry),
    entry,
  });
  const trimmed = current.slice(-WATCH_JOURNAL_LIMIT);
  await writeFile(journalPath, JSON.stringify(trimmed, null, 2));
  return trimmed;
}
