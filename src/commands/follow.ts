// src/commands/follow.ts
import { Command } from 'commander';
import yaml from 'js-yaml';
import { storeInitialized } from '../store/index.js';
import { readFollowing, addFollowing, removeFollowing } from '../store/following-store.js';
import { doInteraction } from './interact.js';
import { resolveEndpoint } from '../identity/resolve-target.js';
import { handleFromEndpoint } from '../utils/remote-auth.js';
import { output } from '../utils/output.js';
import type { Manifest } from '../models/manifest.js';
import { buildEndpointUrl } from '../utils/endpoint-url.js';

async function fetchTargetManifest(url: string): Promise<Manifest | null> {
  try {
    const manifestUrl = buildEndpointUrl(url, '/.well-known/asp.yaml').toString();
    const res = await fetch(manifestUrl);
    if (!res.ok) return null;
    const text = await res.text();
    return yaml.load(text) as Manifest;
  } catch {
    return null;
  }
}

function displayHandle(endpoint: string): string {
  const h = handleFromEndpoint(endpoint);
  return h ? `@${h}` : endpoint.replace(/^https?:\/\//, '');
}

export const followCommand = new Command('follow')
  .description('Follow an entity (sends a follow interaction and adds to your following list)')
  .argument('<target>', 'Target to follow (@handle, domain, or URL)')
  .action(async (target, _opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(
        json
          ? { error: 'Not initialized', next: 'asp init' }
          : 'Not initialized. Run `asp init` to create a local identity first, or `npx create-asp-agent` for the public onboarding flow.',
        json,
      );
      process.exitCode = 1;
      return;
    }

    const targetUrl = await resolveEndpoint(target);

    // Validate target
    const targetManifest = await fetchTargetManifest(targetUrl);
    if (!targetManifest) {
      output(json ? { error: `Could not reach ${target}` } : `Could not reach ${target}. Check the handle or URL.`, json);
      process.exitCode = 1;
      return;
    }

    // Send follow interaction (suppress output — follow handles its own)
    const result = await doInteraction('follow', targetUrl, undefined, false, false, true);

    // Save follow locally
    try {
      await addFollowing({
        url: targetUrl,
        name: targetManifest.entity?.name,
        handle: targetManifest.entity?.handle,
        added: new Date().toISOString(),
        created_by: 'human',
      });
    } catch {
      // Already following — not an error
    }

    const targetDisplay = displayHandle(targetUrl);

    if (json) {
      output({
        status: result.status === 'error' ? 'error' : 'followed',
        target: { url: targetUrl, name: targetManifest.entity?.name, handle: targetManifest.entity?.handle },
        ...(result.warning && { warning: result.warning }),
      }, true);
      return;
    }

    console.log(`\n  \u2713 Now following ${targetDisplay}`);
    if (result.warning) {
      console.log(`    (${result.warning})`);
    }
    console.log('');
  });

export const unfollowCommand = new Command('unfollow')
  .description('Unfollow an entity (sends an unfollow interaction and removes from following list)')
  .argument('<target>', 'Target to unfollow (@handle, domain, or URL)')
  .action(async (target, _opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const targetUrl = await resolveEndpoint(target);

    // Send unfollow interaction (suppress output — unfollow handles its own)
    const result = await doInteraction('unfollow', targetUrl, undefined, false, false, true);

    // Remove local follow
    try {
      await removeFollowing(targetUrl);
    } catch {
      // Not following — not an error
    }

    if (json) {
      output({
        status: result.status === 'error' ? 'error' : 'unfollowed',
        target: { url: targetUrl, handle: displayHandle(targetUrl) },
        ...(result.warning && { warning: result.warning }),
      }, true);
      return;
    }

    console.log(`  \u2713 Unfollowed ${displayHandle(targetUrl)}`);
    if (result.warning) {
      console.log(`    (${result.warning})`);
    }
  });

export const followingCommand = new Command('following')
  .description('List all entities you follow')
  .action(async (_opts, cmd) => {
    const json = cmd.optsWithGlobals().json;
    const subs = await readFollowing();

    if (json) {
      output({ following: subs }, true);
      return;
    }

    if (subs.length === 0) {
      console.log('Not following anyone.');
      return;
    }

    console.log(`Following ${subs.length} entit${subs.length === 1 ? 'y' : 'ies'}:\n`);
    for (const s of subs) {
      console.log(`  ${s.name || 'Unknown'} (${s.handle || s.url})`);
      console.log(`    URL:   ${s.url}`);
      console.log(`    Since: ${s.added}`);
    }
  });
