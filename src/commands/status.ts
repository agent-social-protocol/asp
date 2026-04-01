import { Command } from 'commander';
import { storeInitialized } from '../store/index.js';
import { readManifest } from '../store/manifest-store.js';
import { readFollowing } from '../store/following-store.js';
import { readFeed } from '../store/feed-store.js';
import { readNotifications } from '../store/notification-store.js';
import { readRelationships } from '../store/relationship-store.js';
import { readIndexes } from '../store/index-store.js';
import { readBehavior } from '../store/behavior-store.js';
import { output } from '../utils/output.js';
import { isHosted, handleFromEndpoint } from '../utils/remote-auth.js';
import { buildHostedProfileUrl } from '../config/hosted.js';
import { readOwnInboxPage } from '../utils/own-inbox.js';

export const statusCommand = new Command('status')
  .description('Show current ASP node status — identity, network, and activity overview')
  .action(async (_opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const manifest = await readManifest();
    const followingList = await readFollowing();
    const feed = await readFeed();
    const notifications = await readNotifications();
    const relationships = await readRelationships();
    const indexes = await readIndexes();
    const behavior = await readBehavior();

    let inboxEntryCount: number;
    let newInboxEntries: number;
    try {
      const [inboxPage, newInboxPage] = await Promise.all([
        readOwnInboxPage({ direction: 'received' }),
        readOwnInboxPage({ direction: 'received', since: notifications.last_checked }),
      ]);
      inboxEntryCount = inboxPage.entries.length;
      newInboxEntries = newInboxPage.entries.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output(json ? { error: message } : `Could not read inbox (${message})`, json);
      process.exitCode = 1;
      return;
    }

    const entity = manifest?.entity;
    const newPosts = notifications.new_posts.length;

    if (json) {
      output({
        identity: {
          id: entity?.id,
          type: entity?.type,
          name: entity?.name,
          handle: entity?.handle,
          tags: entity?.tags,
        },
        network: {
          following: followingList.length,
          relationships: relationships.length,
        },
        activity: {
          feed_posts: feed.length,
          inbox_entries: inboxEntryCount,
          new_posts: newPosts,
          new_inbox_entries: newInboxEntries,
        },
        indexes: indexes.map(i => ({ url: i.url, last_synced: i.last_synced })),
        autonomy: behavior?.autonomy_level,
      }, true);
      return;
    }

    console.log(`\nASP Status`);
    console.log(`──────────`);
    console.log(`  Identity:      ${entity?.handle} (${entity?.id}) [${entity?.type}]`);
    if (entity?.tags?.length) {
      console.log(`  Tags:          ${entity.tags.join(', ')}`);
    }
    console.log(`  Autonomy:      ${behavior?.autonomy_level}`);
    console.log('');
    console.log(`  Following:      ${followingList.length}`);
    console.log(`  Relationships: ${relationships.length}`);
    console.log('');
    console.log(`  Feed posts:    ${feed.length}`);
    console.log(`  Inbox entries: ${inboxEntryCount}`);
    console.log(`  Notifications: ${newPosts} new posts, ${newInboxEntries} new inbox entries`);
    console.log('');
    if (indexes.length === 0) {
      console.log(`  Indexes:       (none) — run \`asp index register\` to be discoverable`);
    } else {
      console.log(`  Indexes:`);
      for (const idx of indexes) {
        const synced = idx.last_synced ? `synced ${idx.last_synced}` : 'not synced';
        console.log(`    ${idx.url} (${synced})`);
      }
    }

    // Dynamic suggestions
    const suggestions: string[] = [];

    if (feed.length === 0) {
      suggestions.push('Publish your first post: asp publish "Hello, ASP world!"');
    }

    if (followingList.length === 0) {
      suggestions.push('Follow someone: asp follow @handle');
    }

    if (indexes.length === 0) {
      suggestions.push('Be discoverable: asp index register');
    }

    if (inboxEntryCount > 0) {
      suggestions.push(`Read inbox: asp inbox (${inboxEntryCount} entries)`);
    }

    const hosted = await isHosted();
    if (hosted && entity?.id) {
      const handle = handleFromEndpoint(entity.id);
      if (handle) {
        suggestions.push(`Share your profile: ${buildHostedProfileUrl(handle)}`);
      }
    }

    if (suggestions.length > 0) {
      console.log('');
      console.log(`  Suggestions:`);
      for (const s of suggestions) {
        console.log(`    → ${s}`);
      }
    }

    console.log('');
  });
