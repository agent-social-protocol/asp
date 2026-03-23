import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { getStorePaths, storeInitialized } from '../store/index.js';
import { readManifest } from '../store/manifest-store.js';
import { addSentInteraction } from '../store/interaction-store.js';
import { sendInteraction } from '../utils/send-interaction.js';
import { signPayload } from '../utils/crypto.js';
import { output } from '../utils/output.js';
import { resolveEndpoint, parsePostUrl } from '../identity/resolve-target.js';
import type { Interaction } from '../models/interaction.js';
import { buildInboxEntrySignaturePayload, interactionToInboxEntry } from '../utils/inbox-entry.js';

export interface InteractionResult {
  status: 'sent' | 'saved_locally' | 'error';
  warning?: string;
}

export async function doInteraction(action: string, target: string, content: string | undefined, isLocal: boolean, json: boolean, silent = false, resourceTarget?: string): Promise<InteractionResult> {
  if (!storeInitialized()) {
    output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
    process.exitCode = 1;
    return { status: 'error' };
  }

  const manifest = await readManifest();
  const from = manifest?.entity.id;
  const timestamp = new Date().toISOString();
  const entryId = crypto.randomUUID();

  const interaction: Interaction = {
    id: entryId,
    action,
    to: target,
    target: resourceTarget || target,
    timestamp,
    ...(content && { content }),
    ...(isLocal && { local: true }),
    ...(!isLocal && from && { from }),
  };

  // Auto-sign if private key exists and sending remotely
  const { privateKeyPath } = getStorePaths();
  if (!isLocal && from && existsSync(privateKeyPath)) {
    const privateKeyPem = await readFile(privateKeyPath, 'utf-8');
    const payload = buildInboxEntrySignaturePayload(interactionToInboxEntry(interaction));
    interaction.signature = signPayload(payload, privateKeyPem);
  }

  // Save locally
  await addSentInteraction(interaction);

  // Send to remote if not local-only
  if (!isLocal && target) {
    const result = await sendInteraction(target, interaction);
    if (!result.ok) {
      const warning = `Could not notify: ${result.error}`;
      if (json) {
        output({ status: 'saved_locally', warning, interaction }, true);
      } else if (!silent) {
        console.log(`${action} saved locally (${warning})`);
      }
      return { status: 'saved_locally', warning };
    }
  }

  if (json) {
    output({ status: isLocal ? 'saved_locally' : 'sent', interaction }, true);
  } else if (!silent) {
    console.log(`${action}: ${resourceTarget || target}`);
  }
  return { status: isLocal ? 'saved_locally' : 'sent' };
}

export const interactCommand = new Command('interact')
  .description('Send an interaction (common actions: like, comment, repost, endorse, flag)')
  .argument('<action>', 'Action to perform (e.g. like, comment, endorse, flag)')
  .argument('<target>', 'Target (@handle, domain, or URL)')
  .argument('[content]', 'Optional content (e.g. comment text)')
  .option('--local', 'Save locally only, do not send to target')
  .action(async (action, target, content, opts, cmd) => {
    let resolved: string;
    try {
      resolved = await resolveEndpoint(target);
    } catch (err) {
      output(cmd.optsWithGlobals().json ? { error: (err as Error).message } : (err as Error).message, cmd.optsWithGlobals().json);
      process.exitCode = 1;
      return;
    }
    const { baseUrl, postId } = parsePostUrl(resolved);
    const endpoint = baseUrl;
    const resource = postId ? resolved : undefined;
    await doInteraction(action, endpoint, content, !!opts.local,
      cmd.optsWithGlobals().json, false, resource);
  });
