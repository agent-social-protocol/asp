import { Command } from 'commander';
import { storeInitialized } from '../store/index.js';
import { deleteEntry } from '../store/feed-store.js';
import { output } from '../utils/output.js';
import { isHosted, buildAuthHeader } from '../utils/remote-auth.js';
import { readManifest } from '../store/manifest-store.js';
import { buildEndpointPath, buildEndpointUrl } from '../utils/endpoint-url.js';

export const deleteCommand = new Command('delete')
  .description('Delete a post from your feed')
  .argument('<id>', 'Post ID to delete')
  .action(async (id, _opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
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
      const auth = await buildAuthHeader('DELETE', buildEndpointPath(endpoint, feedPath));
      const res = await fetch(buildEndpointUrl(endpoint, feedPath), {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      const data = await res.json() as Record<string, string>;
      if (!res.ok) {
        output(json ? data : `Failed: ${data.error}`, json);
        process.exitCode = 1;
        return;
      }
      output(json ? data : `Deleted: ${id}`, json);
    } else {
      const deleted = await deleteEntry(id);
      if (!deleted) {
        output(json ? { error: 'Post not found' } : `Post not found: ${id}`, json);
        process.exitCode = 1;
        return;
      }
      output(json ? { status: 'deleted', id } : `Deleted: ${id}`, json);
    }
  });
