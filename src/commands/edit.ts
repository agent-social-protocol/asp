import { Command } from 'commander';
import { storeInitialized } from '../store/index.js';
import { updateEntry } from '../store/feed-store.js';
import { output } from '../utils/output.js';
import { isHosted, buildAuthHeader } from '../utils/remote-auth.js';
import { readManifest } from '../store/manifest-store.js';
import { buildEndpointPath, buildEndpointUrl } from '../utils/endpoint-url.js';

export const editCommand = new Command('edit')
  .description('Edit an existing post')
  .argument('<id>', 'Post ID to edit')
  .option('--title <title>', 'New title')
  .option('--content <content>', 'New content')
  .option('--tags <tags>', 'New comma-separated tags')
  .action(async (id, opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const updates: Record<string, unknown> = {};
    if (opts.title) updates.title = opts.title;
    if (opts.content) updates.summary = opts.content;
    if (opts.tags) updates.topics = opts.tags.split(',').map((t: string) => t.trim()).filter(Boolean);

    if (Object.keys(updates).length === 0) {
      output(json ? { error: 'No fields to update' } : 'Provide --title, --content, or --tags.', json);
      process.exitCode = 1;
      return;
    }

    const hosted = await isHosted();
    if (hosted) {
      const manifest = await readManifest();
      if (!manifest) {
        output(json ? { error: 'Manifest not found' } : 'Manifest not found.', json);
        process.exitCode = 1;
        return;
      }
      const endpoint = manifest.entity.id;
      const feedPath = `/asp/feed/${encodeURIComponent(id)}`;
      const auth = await buildAuthHeader('PUT', buildEndpointPath(endpoint, feedPath));
      const res = await fetch(buildEndpointUrl(endpoint, feedPath), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(updates),
      });
      const data = await res.json() as Record<string, string>;
      if (!res.ok) {
        output(json ? data : `Failed: ${data.error}`, json);
        process.exitCode = 1;
        return;
      }
      output(json ? data : `Updated: ${id}`, json);
    } else {
      const result = await updateEntry(id, updates as { title?: string; summary?: string; topics?: string[] });
      if (!result) {
        output(json ? { error: 'Post not found' } : `Post not found: ${id}`, json);
        process.exitCode = 1;
        return;
      }
      output(json ? result : `Updated: ${id}`, json);
    }
  });
