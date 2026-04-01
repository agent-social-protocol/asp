import type { FeedEntry } from '../models/feed-entry.js';
import { getInboxEntryCursor, type InboxEntry } from '../models/inbox-entry.js';
import type { MessageAttachment } from '../models/message.js';
import { isAspPostUrl } from './interaction-policy.js';
import { summarizeInboxEntry } from './inbox-display.js';
import { handleFromEndpoint } from './remote-auth.js';

export interface AgentActorRef {
  id: string;
  handle: string | null;
  display: string;
}

export interface AgentTargetRef {
  id: string;
  kind: 'post' | 'endpoint' | 'resource';
  handle: string | null;
  display: string;
}

export interface AgentItemWarning {
  code: string;
  message: string;
  item_id?: string;
  source?: string;
}

export interface AgentInboxItem {
  resource: 'inbox_entry';
  id: string;
  kind: 'message' | 'interaction';
  type: string;
  actor: AgentActorRef;
  recipient: AgentActorRef;
  target: AgentTargetRef | null;
  content: {
    state: 'none' | 'decrypted' | 'encrypted_unavailable';
    text: string | null;
    preview: string | null;
    data?: Record<string, unknown>;
    attachments?: MessageAttachment[];
  };
  thread: {
    id: string | null;
    reply_to: string | null;
  };
  timestamps: {
    occurred_at: string;
    received_at: string | null;
    sort_at: string;
  };
  summary: string;
  affordances: {
    reply?: {
      to: string;
      reply_to: string;
      thread_id?: string;
    };
    follow_back?: {
      target: string;
    };
  };
}

export interface AgentFeedItem {
  resource: 'feed_entry';
  id: string;
  author: AgentActorRef | null;
  source: AgentActorRef;
  title: string;
  summary: string;
  topics: string[];
  signal_type: string | null;
  content_url: string | null;
  content_type: string | null;
  timestamps: {
    published_at: string;
    updated_at: string | null;
    sort_at: string;
  };
}

export type AgentNotificationItem = AgentInboxItem | AgentFeedItem;

function deriveHandle(value: string): string | null {
  const hostedHandle = handleFromEndpoint(value);
  if (hostedHandle) {
    return hostedHandle;
  }

  try {
    const url = new URL(value);
    const profileHandle = url.pathname.match(/^\/@([^/?#]+)\/?$/)?.[1];
    if (profileHandle) {
      return decodeURIComponent(profileHandle);
    }
    return null;
  } catch {
    return null;
  }
}

function makeActorRef(value: string | undefined): AgentActorRef {
  const id = value ?? '';
  const handle = id ? deriveHandle(id) : null;
  return {
    id,
    handle,
    display: handle ? `@${handle}` : id || 'Unknown',
  };
}

function makeTargetRef(value: string | undefined): AgentTargetRef | null {
  if (!value) {
    return null;
  }

  const handle = deriveHandle(value);
  return {
    id: value,
    kind: isAspPostUrl(value)
      ? 'post'
      : handle
        ? 'endpoint'
        : 'resource',
    handle,
    display: handle ? `@${handle}` : value,
  };
}

function previewText(text: string | undefined): string | null {
  const normalized = text?.trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function summarizeAgentInboxEntry(entry: InboxEntry, actor: AgentActorRef, contentState: AgentInboxItem['content']['state']): string {
  if (entry.kind === 'message' && contentState === 'encrypted_unavailable') {
    return `${actor.display} sent an encrypted message`;
  }
  return summarizeInboxEntry(entry);
}

export function normalizeInboxEntriesForAgent(entries: InboxEntry[]): AgentInboxItem[] {
  return entries
    .map((entry) => {
      const actor = makeActorRef(entry.from);
      const recipient = makeActorRef(entry.to);
      const text = entry.content?.text;
      const encryptedUnavailable = entry.kind === 'message' && text === '[encrypted]' && !!entry.content?.data?.encrypted;
      const contentState: AgentInboxItem['content']['state'] = encryptedUnavailable
        ? 'encrypted_unavailable'
        : text || entry.content?.data || entry.content?.attachments
          ? 'decrypted'
          : 'none';

      const affordances: AgentInboxItem['affordances'] = {};
      if (entry.kind === 'message') {
        affordances.reply = {
          to: entry.from,
          reply_to: entry.id,
          ...(entry.thread_id ? { thread_id: entry.thread_id } : {}),
        };
      }
      if (entry.kind === 'interaction' && entry.type === 'follow' && entry.from && entry.from !== entry.to) {
        affordances.follow_back = { target: entry.from };
      }

      return {
        resource: 'inbox_entry' as const,
        id: entry.id,
        kind: entry.kind,
        type: entry.type,
        actor,
        recipient,
        target: makeTargetRef(entry.target),
        content: {
          state: contentState,
          text: encryptedUnavailable ? null : text ?? null,
          preview: encryptedUnavailable ? null : previewText(text),
          ...(encryptedUnavailable ? {} : entry.content?.data ? { data: entry.content.data } : {}),
          ...(encryptedUnavailable ? {} : entry.content?.attachments ? { attachments: entry.content.attachments } : {}),
        },
        thread: {
          id: entry.thread_id ?? null,
          reply_to: entry.reply_to ?? null,
        },
        timestamps: {
          occurred_at: entry.timestamp,
          received_at: entry.received_at ?? null,
          sort_at: getInboxEntryCursor(entry),
        },
        summary: summarizeAgentInboxEntry(entry, actor, contentState),
        affordances,
      };
    })
    .sort((a, b) => new Date(b.timestamps.sort_at).getTime() - new Date(a.timestamps.sort_at).getTime());
}

export function normalizeFeedEntriesForAgent(entries: Array<FeedEntry & { source: string }>): AgentFeedItem[] {
  return entries
    .map((entry) => ({
      resource: 'feed_entry' as const,
      id: entry.id,
      author: entry.author ? makeActorRef(entry.author) : null,
      source: makeActorRef(entry.source),
      title: entry.title,
      summary: entry.summary,
      topics: entry.topics,
      signal_type: entry.signal_type ?? null,
      content_url: entry.content_url ?? null,
      content_type: entry.content_type ?? null,
      timestamps: {
        published_at: entry.published,
        updated_at: entry.updated ?? null,
        sort_at: entry.updated ?? entry.published,
      },
    }))
    .sort((a, b) => new Date(b.timestamps.sort_at).getTime() - new Date(a.timestamps.sort_at).getTime());
}
