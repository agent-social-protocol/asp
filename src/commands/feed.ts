import { Command } from 'commander';
import { storeInitialized } from '../store/index.js';
import { readFollowing } from '../store/following-store.js';
import { fetchFeed } from '../utils/fetch-feed.js';
import { output } from '../utils/output.js';
import type { FeedEntry } from '../models/feed-entry.js';

interface MergedEntry extends FeedEntry {
  source: string;
}

export const feedCommand = new Command('feed')
  .description('Fetch and display feed from entities you follow')
  .option('--from <url>', 'Only show posts from this source')
  .option('--since <date>', 'Only show posts since this date')
  .action(async (opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    let subs = await readFollowing();
    if (opts.from) {
      subs = subs.filter((s) => s.url.includes(opts.from));
    }

    if (subs.length === 0) {
      output(json ? { entries: [] } : 'Not following anyone. Run `asp follow @handle` first.', json);
      return;
    }

    const results = await Promise.allSettled(
      subs.map((s) => fetchFeed(s.url, { since: opts.since }))
    );

    const merged: MergedEntry[] = [];
    const errors: Array<{ source: string; error: string }> = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { source, entries, error } = result.value;
        if (error) {
          errors.push({ source, error });
        } else {
          for (const entry of entries) {
            merged.push({ ...entry, source });
          }
        }
      }
    }

    // Filter by since date if provided
    let filtered = merged;
    if (opts.since) {
      const sinceDate = new Date(opts.since).getTime();
      filtered = merged.filter((e) => new Date(e.published).getTime() >= sinceDate);
    }

    // Sort newest first
    filtered.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());

    if (json) {
      output({ entries: filtered, errors: errors.length ? errors : undefined }, true);
      return;
    }

    if (filtered.length === 0) {
      console.log('No new posts.');
    } else {
      for (const entry of filtered) {
        console.log(`\n--- ${entry.title} ---`);
        console.log(`  From:      ${entry.source}`);
        console.log(`  Published: ${entry.published}`);
        if (entry.topics?.length) console.log(`  Tags:      ${entry.topics.join(', ')}`);
        console.log(`  ${entry.summary.slice(0, 200)}${entry.summary.length > 200 ? '...' : ''}`);
      }
    }

    if (errors.length) {
      console.log(`\nErrors fetching from ${errors.length} source(s):`);
      for (const e of errors) {
        console.log(`  ${e.source}: ${e.error}`);
      }
    }
  });
