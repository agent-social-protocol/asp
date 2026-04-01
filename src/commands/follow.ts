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

function isAlreadyFollowingError(error: unknown, url: string): boolean {
  return error instanceof Error && error.message === `Already following ${url}`;
}

function isNotFollowingError(error: unknown, url: string): boolean {
  return error instanceof Error && error.message === `Not following ${url}`;
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

    let targetUrl: string;
    try {
      targetUrl = await resolveEndpoint(target);
    } catch (err) {
      output(json ? { error: (err as Error).message } : (err as Error).message, json);
      process.exitCode = 1;
      return;
    }

    // Validate target
    const targetManifest = await fetchTargetManifest(targetUrl);
    if (!targetManifest) {
      output(json ? { error: `Could not reach ${target}` } : `Could not reach ${target}. Check the handle or URL.`, json);
      process.exitCode = 1;
      return;
    }

    // Send follow interaction (suppress output — follow handles its own)
    const result = await doInteraction('follow', targetUrl, undefined, false, json, true);
    if (result.status === 'error') {
      process.exitCode = 1;
      return;
    }

    let localSaved = true;
    try {
      await addFollowing({
        url: targetUrl,
        name: targetManifest.entity?.name,
        handle: targetManifest.entity?.handle,
        added: new Date().toISOString(),
        created_by: 'human',
      });
    } catch (error) {
      if (!isAlreadyFollowingError(error, targetUrl)) {
        localSaved = false;
      }
    }

    const targetDisplay = displayHandle(targetUrl);

    if (!localSaved) {
      const error = `Could not save local following state for ${targetDisplay}`;
      if (json) {
        output({
          status: 'error',
          error,
          target: { url: targetUrl, name: targetManifest.entity?.name, handle: targetManifest.entity?.handle },
          remote_notified: result.remote_notified,
          local_following_saved: false,
        }, true);
      } else {
        console.log(`\n  ✗ Could not follow ${targetDisplay}`);
        console.log(`    (${error})`);
      }
      process.exitCode = 1;
      return;
    }

    if (json) {
      const partial = !result.remote_notified;
      output({
        status: partial ? 'partial' : 'followed',
        target: { url: targetUrl, name: targetManifest.entity?.name, handle: targetManifest.entity?.handle },
        remote_notified: result.remote_notified,
        local_following_saved: true,
        ...(result.warning && { warning: result.warning }),
      }, true);
      return;
    }

    if (result.remote_notified) {
      console.log(`\n  \u2713 Following ${targetDisplay}`);
    } else {
      console.log(`\n  \u2713 Following ${targetDisplay} locally`);
    }
    if (!result.remote_notified && result.warning) {
      console.log(`    (could not notify them: ${result.warning.replace(/^Could not notify:\s*/, '')})`);
    } else if (result.warning) {
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

    let targetUrl: string;
    try {
      targetUrl = await resolveEndpoint(target);
    } catch (err) {
      output(json ? { error: (err as Error).message } : (err as Error).message, json);
      process.exitCode = 1;
      return;
    }

    // Send unfollow interaction (suppress output — unfollow handles its own)
    const result = await doInteraction('unfollow', targetUrl, undefined, false, false, true);

    let localSaved = true;
    try {
      await removeFollowing(targetUrl);
    } catch (error) {
      if (!isNotFollowingError(error, targetUrl)) {
        localSaved = false;
      }
    }

    if (!localSaved) {
      const error = `Could not update local following state for ${displayHandle(targetUrl)}`;
      if (json) {
        output({
          status: 'error',
          error,
          target: { url: targetUrl, handle: displayHandle(targetUrl) },
          remote_notified: result.remote_notified,
          local_following_saved: false,
        }, true);
      } else {
        console.log(`  \u2717 Could not unfollow ${displayHandle(targetUrl)}`);
        console.log(`    (${error})`);
      }
      process.exitCode = 1;
      return;
    }

    if (json) {
      output({
        status: result.remote_notified ? 'unfollowed' : 'partial',
        target: { url: targetUrl, handle: displayHandle(targetUrl) },
        remote_notified: result.remote_notified,
        local_following_saved: true,
        ...(result.warning && { warning: result.warning }),
      }, true);
      return;
    }

    if (result.remote_notified) {
      console.log(`  \u2713 Unfollowed ${displayHandle(targetUrl)}`);
    } else {
      console.log(`  \u2713 Unfollowed ${displayHandle(targetUrl)} locally`);
    }
    if (!result.remote_notified && result.warning) {
      console.log(`    (could not notify them: ${result.warning.replace(/^Could not notify:\s*/, '')})`);
    } else if (result.warning) {
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
