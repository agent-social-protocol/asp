import { Command } from 'commander';
import { storeInitialized } from '../store/index.js';
import { readFollowing } from '../store/following-store.js';
import { fetchFeed } from '../utils/fetch-feed.js';
import { output } from '../utils/output.js';
import { outputCliError } from '../utils/cli-error.js';
import type { FeedEntry } from '../models/feed-entry.js';
import { normalizeFeedEntriesForAgent } from '../utils/agent-items.js';

interface MergedEntry extends FeedEntry {
  source: string;
}

export const feedCommand = new Command('feed')
  .description('Fetch and display feed from entities you follow')
  .option('--from <url>', 'Only show posts from this source')
  .option('--since <date>', 'Only show posts since this date')
  .option('--type <signal_type>', 'Filter by signal type')
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

    let subs = await readFollowing();
    if (opts.from) {
      subs = subs.filter((s) => s.url.includes(opts.from));
    }

    if (subs.length === 0) {
      if (json) {
        output({
          ok: true,
          schema: 'asp.feed.v2',
          counts: { items: 0 },
          items: [],
          warnings: [],
        }, true);
      } else {
        output('Not following anyone. Run `asp follow @handle` first.', false);
      }
      return;
    }

    const results = await Promise.allSettled(
      subs.map((s) => fetchFeed(s.url, { since: opts.since, signalType: opts.type }))
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
      filtered = filtered.filter((e) => new Date(e.published).getTime() >= sinceDate);
    }

    // Client-side signal_type filter (in case remote doesn't support it)
    if (opts.type) {
      filtered = filtered.filter((e) => e.signal_type === opts.type);
    }

    // Sort newest first
    filtered.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());

    if (json) {
      output({
        ok: true,
        schema: 'asp.feed.v2',
        counts: {
          items: filtered.length,
        },
        items: normalizeFeedEntriesForAgent(filtered),
        warnings: errors.map((entry) => ({
          code: 'feed_fetch_failed',
          source: entry.source,
          message: entry.error,
        })),
      }, true);
      return;
    }

    if (filtered.length === 0) {
      console.log('No new posts.');
    } else {
      for (const entry of filtered) {
        console.log(`\n--- ${entry.title} ---`);
        console.log(`  From:      ${entry.source}`);
        console.log(`  Published: ${entry.published}`);
        if (entry.signal_type) console.log(`  Type:      ${entry.signal_type}`);
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
