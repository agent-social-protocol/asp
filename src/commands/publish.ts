import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { storeInitialized } from '../store/index.js';
import { readFeed, prependEntry } from '../store/feed-store.js';
import { generateId } from '../utils/id.js';
import { output } from '../utils/output.js';
import { isHosted, buildAuthHeader, handleFromEndpoint } from '../utils/remote-auth.js';
import { readManifest } from '../store/manifest-store.js';
import type { FeedEntry } from '../models/feed-entry.js';
import { buildHostedProfileUrl } from '../config/hosted.js';
import { buildEndpointPath, buildEndpointUrl } from '../utils/endpoint-url.js';

export const publishCommand = new Command('publish')
  .description('Publish a new post to your feed')
  .argument('[content]', 'Inline content for the post')
  .option('--file <path>', 'Read content from a file')
  .option('--title <title>', 'Post title')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (inlineContent, opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    let content: string;
    if (opts.file) {
      content = await readFile(opts.file, 'utf-8');
    } else if (inlineContent) {
      content = inlineContent;
    } else {
      output(json ? { error: 'No content' } : 'Provide content as argument or --file <path>.', json);
      process.exitCode = 1;
      return;
    }

    const title = opts.title || content.slice(0, 60).replace(/\n/g, ' ');
    const topics = opts.tags ? opts.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];

    const manifest = await readManifest();
    const existing = await readFeed();
    const id = generateId(title, existing);

    const entry: FeedEntry = {
      id,
      title,
      published: new Date().toISOString(),
      topics,
      summary: content,
      ...(manifest?.entity.id && { author: manifest.entity.id }),
    };

    const hosted = await isHosted();
    if (hosted) {
      const endpoint = manifest!.entity.id;
      const feedUrl = buildEndpointUrl(endpoint, '/asp/feed');
      const auth = await buildAuthHeader('POST', buildEndpointPath(endpoint, '/asp/feed'));
      const res = await fetch(feedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: auth,
        },
        body: JSON.stringify(entry),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        output(json ? err : `Failed to publish: ${(err as Record<string, string>).error}`, json);
        process.exitCode = 1;
        return;
      }
    } else {
      await prependEntry(entry);
    }

    if (json) {
      output(entry, true);
    } else {
      console.log(`Published: ${entry.id}`);
      console.log(`  Title:  ${entry.title}`);
      if (topics.length) console.log(`  Tags:   ${topics.join(', ')}`);

      // Post-publish tip for hosted users
      if (hosted) {
        const handle = handleFromEndpoint(manifest!.entity.id);
        if (handle) {
          console.log(`\n  Tip: Share ${buildHostedProfileUrl(handle)} — others can follow with:`);
          console.log(`  asp follow @${handle}`);
        }
      }
    }
  });
