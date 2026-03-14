import { Command } from 'commander';
import { storeInitialized } from '../store/index.js';
import { readFollowing } from '../store/following-store.js';
import { readNotifications, writeNotifications, updateLastChecked } from '../store/notification-store.js';
import { readInteractions } from '../store/interaction-store.js';
import { fetchFeed } from '../utils/fetch-feed.js';
import { output } from '../utils/output.js';
import type { FeedEntry } from '../models/feed-entry.js';

export const notificationsCommand = new Command('notifications')
  .description('Check for new posts and interactions')
  .action(async (_opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const notifs = await readNotifications();
    const subs = await readFollowing();
    const interactions = await readInteractions();

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

    // Get recent received interactions (since last check)
    const lastChecked = new Date(notifs.last_checked).getTime();
    const newInteractions = interactions.received.filter(
      (i) => new Date(i.timestamp).getTime() > lastChecked
    );

    if (json) {
      output({ new_posts: newPosts, new_interactions: newInteractions }, true);
    } else {
      if (newPosts.length === 0 && newInteractions.length === 0) {
        console.log('No new notifications.');
      } else {
        if (newPosts.length > 0) {
          console.log(`\n${newPosts.length} new post(s):\n`);
          for (const post of newPosts) {
            console.log(`  [${post.source}] ${post.title}`);
            console.log(`    ${post.published}`);
          }
        }

        if (newInteractions.length > 0) {
          console.log(`\n${newInteractions.length} new interaction(s):\n`);
          for (const i of newInteractions) {
            const who = i.from || 'Someone';
            if (i.action === 'comment') {
              console.log(`  ${who} commented: "${i.content}"`);
            } else {
              console.log(`  ${who} ${i.action}: ${i.target || 'you'}`);
            }
          }
        }
      }
    }

    // Update last checked
    await updateLastChecked();
  });
