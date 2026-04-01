import { Command } from 'commander';
import { storeInitialized } from '../store/index.js';
import { readFollowing } from '../store/following-store.js';
import { readNotifications, updateLastChecked } from '../store/notification-store.js';
import { fetchFeed } from '../utils/fetch-feed.js';
import { output } from '../utils/output.js';
import { outputCliError } from '../utils/cli-error.js';
import type { FeedEntry } from '../models/feed-entry.js';
import { summarizeInboxEntry } from '../utils/inbox-display.js';
import { readOwnInboxPage } from '../utils/own-inbox.js';
import { normalizeFeedEntriesForAgent, normalizeInboxEntriesForAgent, type AgentItemWarning } from '../utils/agent-items.js';
import { resolveReadableInboxEntries } from '../utils/readable-inbox.js';

export const notificationsCommand = new Command('notifications')
  .description('Check new posts and inbox activity since last checked')
  .option('--peek', 'Show updates without marking them as checked')
  .action(async (opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      outputCliError({
        code: 'not_initialized',
        message: 'Not initialized',
        hint: 'Run `asp init` first.',
        human: 'Not initialized. Run `asp init` first.',
      }, json);
      process.exitCode = 1;
      return;
    }

    const notifs = await readNotifications();
    const subs = await readFollowing();

    // Fetch new posts since last check
    const newPosts: Array<FeedEntry & { source: string }> = [];
    const results: Array<PromiseSettledResult<{ source: string; entries: FeedEntry[]; error?: string }>> = [];

    if (subs.length > 0) {
      results.push(...await Promise.allSettled(
        subs.map((s) => fetchFeed(s.url, { since: notifs.last_checked }))
      ));

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
      const readableInbox = await resolveReadableInboxEntries(inboxPage.entries);
      newEntries = readableInbox.entries;
      const warningItems = readableInbox.warnings;
      const postItems = normalizeFeedEntriesForAgent(newPosts);
      const inboxItems = normalizeInboxEntriesForAgent(newEntries);
      const items = [...postItems, ...inboxItems].sort((a, b) => {
        const aSort = a.resource === 'feed_entry' ? a.timestamps.sort_at : a.timestamps.sort_at;
        const bSort = b.resource === 'feed_entry' ? b.timestamps.sort_at : b.timestamps.sort_at;
        return new Date(bSort).getTime() - new Date(aSort).getTime();
      });

      const warnings: AgentItemWarning[] = [
        ...warningItems,
        ...results
          .filter((result): result is PromiseFulfilledResult<{ source: string; entries: FeedEntry[]; error?: string }> => result.status === 'fulfilled' && !!result.value.error)
          .map((result) => ({
            code: 'feed_fetch_failed',
            source: result.value.source,
            message: result.value.error as string,
          })),
      ];

      if (json) {
        output({
          ok: true,
          schema: 'asp.notifications.v2',
          peek: !!opts.peek,
          last_checked: notifs.last_checked,
          counts: {
            items: items.length,
            feed_items: postItems.length,
            inbox_items: inboxItems.length,
          },
          items,
          warnings,
        }, true);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputCliError({
        code: 'notifications_fetch_failed',
        message,
        human: `Could not check inbox updates (${message})`,
      }, json);
      process.exitCode = 1;
      return;
    }

    if (!opts.peek) {
      await updateLastChecked();
    }
  });
