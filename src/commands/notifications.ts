import { Command } from 'commander';
import { storeInitialized } from '../store/index.js';
import { readFollowing } from '../store/following-store.js';
import { readNotifications, updateLastChecked } from '../store/notification-store.js';
import { readInbox } from '../store/inbox-store.js';
import { fetchFeed } from '../utils/fetch-feed.js';
import { output } from '../utils/output.js';
import type { FeedEntry } from '../models/feed-entry.js';
import type { InboxEntry } from '../models/inbox-entry.js';

function describeInboxEntry(entry: InboxEntry): string {
  const actor = entry.from || 'Someone';
  if (entry.kind === 'interaction') {
    if (entry.type === 'comment') {
      return `${actor} commented: "${entry.content?.text ?? ''}"`;
    }
    return `${actor} ${entry.type}: ${entry.target || 'you'}`;
  }

  const summary = entry.content?.text?.trim();
  if (summary) {
    return `${actor} sent ${entry.type}: "${summary}"`;
  }
  return `${actor} sent ${entry.type}`;
}

export const notificationsCommand = new Command('notifications')
  .description('Check for new posts and inbox activity')
  .action(async (_opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const notifs = await readNotifications();
    const subs = await readFollowing();
    const inbox = await readInbox();

    // Fetch new posts since last check
    const newPosts: Array<FeedEntry & { source: string }> = [];

    if (subs.length > 0) {
      const results = await Promise.allSettled(
        subs.map((s) => fetchFeed(s.url, { since: notifs.last_checked }))
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && !result.value.error) {
          for (const entry of result.value.entries) {
            if (new Date(entry.published).getTime() > new Date(notifs.last_checked).getTime()) {
              newPosts.push({ ...entry, source: result.value.source });
            }
          }
        }
      }
    }

    // Get recent received inbox entries (since last check)
    const lastChecked = new Date(notifs.last_checked).getTime();
    const newEntries = inbox.received.filter(
      (entry) => new Date(entry.received_at ?? entry.timestamp).getTime() > lastChecked
    );

    if (json) {
      output({ new_posts: newPosts, new_entries: newEntries }, true);
    } else {
      if (newPosts.length === 0 && newEntries.length === 0) {
        console.log('No new notifications.');
      } else {
        if (newPosts.length > 0) {
          console.log(`\n${newPosts.length} new post(s):\n`);
          for (const post of newPosts) {
            console.log(`  [${post.source}] ${post.title}`);
            console.log(`    ${post.published}`);
          }
        }

        if (newEntries.length > 0) {
          console.log(`\n${newEntries.length} new inbox entr${newEntries.length === 1 ? 'y' : 'ies'}:\n`);
          for (const entry of newEntries) {
            console.log(`  ${describeInboxEntry(entry)}`);
          }
        }
      }
    }

    // Update last checked
    await updateLastChecked();
  });
