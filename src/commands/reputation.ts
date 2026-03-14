import { Command } from 'commander';
import { storeInitialized } from '../store/index.js';
import { readManifest } from '../store/manifest-store.js';
import { getReputationRecord } from '../store/reputation-store.js';
import { addMessage } from '../store/inbox-store.js';
import { sendMessage } from '../utils/send-message.js';
import { computeTrust } from '../reputation/calculator.js';
import { generateMessageId } from '../utils/id.js';
import { output } from '../utils/output.js';
import type { Message } from '../models/message.js';

export const reputationCommand = new Command('reputation')
  .description('View trust assessment for an entity')
  .argument('<entity-url>', 'Entity URL to look up')
  .action(async (entityUrl, _opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const record = await getReputationRecord(entityUrl);
    if (!record) {
      if (json) {
        output({ entity: entityUrl, status: 'no_data' }, true);
      } else {
        console.log(`No reputation data for ${entityUrl}`);
      }
      return;
    }

    const trust = computeTrust(record);

    if (json) {
      output({ ...record, computed_trust: trust }, true);
    } else {
      console.log(`Reputation for ${entityUrl}:\n`);
      console.log(`  Trust Score:    ${trust.toFixed(3)}`);
      console.log(`  Interactions:   ${record.direct.interactions_count}`);
      console.log(`  Content Quality: ${record.direct.content_quality}`);
      console.log(`  Commitments:    ${record.direct.commitments_fulfilled}`);
      console.log(`  Social Score:   ${record.social.social_trust_score}`);
      console.log(`  Trusted By:     ${record.social.trusted_by.length} entities`);
      console.log(`  Subscribers:    ${record.network.subscribers_count}`);
      console.log(`  Blocks:         ${record.network.block_count}`);
      console.log(`  Reports:        ${record.network.report_count}`);
      console.log(`  Last Computed:  ${record.last_computed}`);
    }
  });

export const trustQueryCommand = new Command('trust-query')
  .description('Ask a trusted agent about another entity')
  .argument('<via-url>', 'URL of the agent to ask')
  .option('--about <url>', 'URL of the entity to ask about')
  .action(async (viaUrl, opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    if (!opts.about) {
      output(json ? { error: 'Specify --about <url>' } : 'Specify --about <url> to indicate who to ask about.', json);
      process.exitCode = 1;
      return;
    }

    const manifest = await readManifest();
    const fromId = manifest?.entity?.id || 'local';

    const message: Message = {
      id: generateMessageId(),
      from: fromId,
      to: viaUrl,
      timestamp: new Date().toISOString(),
      intent: 'request',
      content: {
        text: `trust_query: What is your assessment of ${opts.about}?`,
        data: { about: opts.about },
      },
      initiated_by: 'human',
    };

    // Save locally
    await addMessage(message);

    // Send to the trusted agent
    const result = await sendMessage(viaUrl, message);
    if (!result.ok) {
      if (json) {
        output({ status: 'saved_locally', warning: `Could not deliver: ${result.error}`, message }, true);
      } else {
        console.log(`Query saved locally (could not deliver: ${result.error})`);
      }
      return;
    }

    if (json) {
      output({ status: 'sent', message }, true);
    } else {
      console.log(`Trust query sent to ${viaUrl} about ${opts.about}`);
      console.log(`  Message ID: ${message.id}`);
    }
  });
