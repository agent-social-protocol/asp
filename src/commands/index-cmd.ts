import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { getStorePaths, storeInitialized } from '../store/index.js';
import { readManifest } from '../store/manifest-store.js';
import { readIndexes, addIndex, removeIndex, updateSyncTime } from '../store/index-store.js';
import { output } from '../utils/output.js';
import { signPayload } from '../utils/crypto.js';
import { signedRegisterBody } from '../utils/remote-auth.js';
import { pushManifestToIndexes } from '../utils/index-push.js';
import { getCliRuntimeConfig } from '../config/cli.js';

const DEFAULT_INDEX = getCliRuntimeConfig().coreIndexUrl;

async function buildIndexAuthHeader(method: string, path: string): Promise<string> {
  const manifest = await readManifest();
  if (!manifest) throw new Error('Not initialized');
  const { privateKeyPath } = getStorePaths();
  if (!existsSync(privateKeyPath)) throw new Error('Private key not found');

  const privateKeyPem = await readFile(privateKeyPath, 'utf-8');
  const endpoint = manifest.entity.id;
  const timestamp = String(Date.now());
  const payload = `${endpoint}:${timestamp}:${method}:${path}`;
  const signature = signPayload(payload, privateKeyPem);

  return `ASP-Sig ${endpoint}:${timestamp}:${signature}`;
}

export const indexCommand = new Command('index')
  .description('Manage index registrations — be discoverable on the ASP network');

indexCommand
  .command('register [url]')
  .alias('add')
  .description(`Register with a Core Index (default: ${DEFAULT_INDEX})`)
  .action(async (url, _opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const indexUrl = url || DEFAULT_INDEX;
    const entry = await addIndex(indexUrl);

    // Try to sync manifest to the index
    const manifest = await readManifest();
    let synced = false;
    if (manifest) {
      try {
        const registerUrl = new URL('/register', indexUrl);
        const res = await fetch(registerUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: await signedRegisterBody(manifest.entity.id),
        });
        if (res.ok) {
          await updateSyncTime(indexUrl);
          synced = true;
        }
      } catch {
        // Index not reachable — saved locally, will sync later
      }
    }

    if (json) {
      output({ status: 'added', index: indexUrl, synced, entry }, true);
    } else {
      console.log(`Added index: ${indexUrl}`);
      if (synced) {
        console.log(`  Synced successfully.`);
      } else {
        console.log(`  Could not reach index — saved locally. Run \`asp index sync\` later.`);
      }
    }
  });

indexCommand
  .command('list')
  .description('Show registered indexes')
  .action(async (_opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const indexes = await readIndexes();

    if (json) {
      output({ indexes }, true);
      return;
    }

    if (indexes.length === 0) {
      console.log('No indexes registered. Run `asp index register` to be discoverable.');
      return;
    }

    console.log(`${indexes.length} index(es):\n`);
    for (const idx of indexes) {
      const synced = idx.last_synced ? `synced ${idx.last_synced}` : 'not synced';
      console.log(`  ${idx.url} (${synced})`);
    }
  });

indexCommand
  .command('sync')
  .description('Push current manifest to all registered indexes')
  .action(async (_opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const manifest = await readManifest();
    if (!manifest) {
      output(json ? { error: 'Manifest not found' } : 'Manifest not found. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }
    const results = await pushManifestToIndexes(manifest.entity.id);

    if (results.length === 0) {
      output(json ? { error: 'No indexes registered' } : 'No indexes registered. Run `asp index register` first.', json);
      process.exitCode = 1;
      return;
    }

    if (json) {
      output({ results }, true);
    } else {
      for (const r of results) {
        if (r.ok) {
          console.log(`  ✓ ${r.url}`);
        } else {
          console.log(`  ✗ ${r.url} — ${r.error}`);
        }
      }
    }
  });

indexCommand
  .command('remove <url>')
  .description('Unregister from an index')
  .action(async (url, _opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const removed = await removeIndex(url);

    if (json) {
      output({ status: removed ? 'removed' : 'not_found', url }, true);
    } else if (removed) {
      console.log(`Removed index: ${url}`);
    } else {
      console.log(`Index not found: ${url}`);
    }
  });

indexCommand
  .command('search')
  .description('Search a registered index for entities')
  .option('--tags <tags>', 'Comma-separated tags to search')
  .option('--type <type>', 'Entity type filter (person|agent|org|service|bot)')
  .option('--skills <skills>', 'Comma-separated skills to search')
  .option('-q, --query <query>', 'Search by name or handle')
  .option('--index-url <url>', 'Specific index to search (default: first registered)')
  .action(async (opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const indexes = await readIndexes();
    const targetIndex = opts.indexUrl || indexes[0]?.url;

    if (!targetIndex) {
      output(json ? { error: 'No index registered' } : 'No index registered. Run `asp index register` first.', json);
      process.exitCode = 1;
      return;
    }

    try {
      const searchUrl = new URL('/search', targetIndex);
      if (opts.tags) searchUrl.searchParams.set('tags', opts.tags);
      if (opts.type) searchUrl.searchParams.set('type', opts.type);
      if (opts.skills) searchUrl.searchParams.set('skills', opts.skills);
      if (opts.query) searchUrl.searchParams.set('q', opts.query);

      const authHeader = await buildIndexAuthHeader('GET', '/search');
      const res = await fetch(searchUrl.toString(), {
        headers: { Authorization: authHeader },
      });
      if (!res.ok) {
        const msg = `Index returned HTTP ${res.status}`;
        output(json ? { error: msg } : msg, json);
        process.exitCode = 1;
        return;
      }

      const data = await res.json() as { results: Array<{
        endpoint: string; name?: string; type?: string;
        handle?: string; tags?: string[]; skills?: string[];
      }> };
      const results = data.results;

      if (json) {
        output({ index: targetIndex, results }, true);
        return;
      }

      if (results.length === 0) {
        console.log('No results found.');
      } else {
        console.log(`${results.length} result(s) from ${targetIndex}:\n`);
        for (const r of results) {
          const handleLabel = r.handle ? ` (@${r.handle.replace(/^@/, '')})` : '';
          console.log(`  ${r.name || r.endpoint}${handleLabel} [${r.type || '?'}]`);
          console.log(`    ${r.endpoint}`);
          if (r.tags?.length) {
            console.log(`    tags: ${r.tags.join(', ')}`);
          }
          if (r.skills?.length) {
            console.log(`    skills: ${r.skills.join(', ')}`);
          }
        }
      }

      // Nudge if not registered with the index being searched
      const isRegistered = indexes.some(i => i.url === targetIndex);
      if (!isRegistered) {
        console.log(`\nYou're not registered with this index. Run \`asp index register ${targetIndex}\` so others can find you too.`);
      }
    } catch (err) {
      const msg = `Could not reach index: ${(err as Error).message}`;
      output(json ? { error: msg } : msg, json);
      process.exitCode = 1;
    }
  });
