import { Command } from 'commander';
import { storeInitialized } from '../store/index.js';
import { readFollowing } from '../store/following-store.js';
import { readNotifications, updateLastChecked } from '../store/notification-store.js';
import { fetchFeed } from '../utils/fetch-feed.js';
import { output } from '../utils/output.js';
import type { FeedEntry } from '../models/feed-entry.js';
import { summarizeInboxEntry } from '../utils/inbox-display.js';
import { readOwnInboxPage } from '../utils/own-inbox.js';

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

    let newEntries;
    try {
      const inboxPage = await readOwnInboxPage({
        direction: 'received',
        since: notifs.last_checked,
      });
      newEntries = inboxPage.entries;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output(json ? { error: message } : `Could not check inbox updates (${message})`, json);
      process.exitCode = 1;
      return;
    }

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
            console.log(`  ${summarizeInboxEntry(entry)}`);
          }
        }
      }
    }

    // Update last checked
    await updateLastChecked();
  });
