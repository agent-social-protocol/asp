import { Command } from 'commander';
import { storeInitialized } from '../store/index.js';
import { readRelationships, addRelationship, removeRelationship } from '../store/relationship-store.js';
import { output } from '../utils/output.js';
import type { Relationship } from '../models/manifest.js';

export const relationshipListCommand = new Command('relationships')
  .description('List all relationships')
  .option('--type <type>', 'Filter by relationship type')
  .action(async (opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    let rels = await readRelationships();

    if (opts.type) {
      rels = rels.filter((r) => r.type === opts.type);
    }

    if (json) {
      output(rels, true);
      return;
    }

    if (rels.length === 0) {
      console.log(opts.type ? `No ${opts.type} relationships.` : 'No relationships.');
      return;
    }

    console.log(`${rels.length} relationship(s):\n`);
    for (const r of rels) {
      console.log(`  [${r.type}] -> ${r.target}`);
      if (r.level !== undefined) console.log(`    Level:   ${r.level}`);
      if (r.context) console.log(`    Context: ${r.context}`);
      console.log(`    Added:   ${r.created_at}`);
    }
  });

export const relationshipAddCommand = new Command('relationship-add')
  .description('Add a relationship')
  .argument('<type>', 'Relationship type (e.g. owns, represents, trusts, reports_to, delegates_to)')
  .argument('<target-url>', 'Target entity URL')
  .option('--level <n>', 'Trust level (0-1, for trusts type)')
  .option('--context <ctx>', 'Context (for collaborates type)')
  .action(async (type, targetUrl, opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const rel: Relationship = {
      type,
      target: targetUrl,
      created_by: 'human',
      created_at: new Date().toISOString(),
      ...(opts.level !== undefined && { level: parseFloat(opts.level) }),
      ...(opts.context && { context: opts.context }),
    };

    try {
      await addRelationship(rel);
    } catch (err) {
      output(json ? { error: (err as Error).message } : (err as Error).message, json);
      process.exitCode = 1;
      return;
    }

    if (json) {
      output({ status: 'added', relationship: rel }, true);
    } else {
      console.log(`Added ${type} relationship -> ${targetUrl}`);
    }
  });

export const relationshipRemoveCommand = new Command('relationship-remove')
  .description('Remove a relationship')
  .argument('<type>', 'Relationship type')
  .argument('<target-url>', 'Target entity URL')
  .action(async (type, targetUrl, _opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    try {
      await removeRelationship(type, targetUrl);
    } catch (err) {
      output(json ? { error: (err as Error).message } : (err as Error).message, json);
      process.exitCode = 1;
      return;
    }

    if (json) {
      output({ status: 'removed', type, target: targetUrl }, true);
    } else {
      console.log(`Removed ${type} relationship -> ${targetUrl}`);
    }
  });
