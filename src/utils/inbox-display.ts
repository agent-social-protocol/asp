import type { InboxEntry } from '../models/inbox-entry.js';
import { handleFromEndpoint } from './remote-auth.js';

export function formatInboxActor(endpoint: string | undefined): string {
  if (!endpoint) return 'Someone';
  const handle = handleFromEndpoint(endpoint);
  return handle ? `@${handle}` : endpoint;
}

export function summarizeInboxEntry(entry: InboxEntry): string {
  const actor = formatInboxActor(entry.from);
  const text = entry.content?.text?.trim();

  if (entry.kind === 'message') {
    return text ? `${actor}: ${text}` : `${actor} sent ${entry.type}`;
  }

  switch (entry.type) {
    case 'follow':
      return `${actor} started following you`;
    case 'unfollow':
      return `${actor} unfollowed you`;
    case 'wave':
      return `${actor} sent you a wave`;
    case 'like':
      return `${actor} liked ${entry.target ?? 'your post'}`;
    case 'comment':
      if (text) {
        return `${actor} commented: "${text}"`;
      }
      return `${actor} commented on ${entry.target ?? 'your post'}`;
    default:
      if (text) {
        return `${actor} ${entry.type}: "${text}"`;
      }
      return entry.target ? `${actor} ${entry.type}: ${entry.target}` : `${actor} ${entry.type}`;
  }
}
