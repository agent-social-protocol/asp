import { Command } from 'commander';
import { storeInitialized } from '../store/index.js';
import { readManifest, writeManifest } from '../store/manifest-store.js';
import { prompt, closePrompts } from '../utils/prompts.js';
import { output } from '../utils/output.js';
import { getHostedRuntimeConfig, isHostedEndpoint } from '../config/hosted.js';
import { syncHostedManifestTargets } from '../hosted/onboarding.js';
import { migrateLegacyHostedManifest } from '../hosted/manifest-migration.js';
import type { EntityType, Manifest, Relationship } from '../models/manifest.js';

function parseCsv(input: string): string[] {
  return input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function upsertRepresentsRelationship(
  relationships: Relationship[],
  target: string,
): Relationship[] {
  const filtered = relationships.filter((relationship) => relationship.type !== 'represents');
  if (!target) {
    return filtered;
  }

  return [
    ...filtered,
    {
      type: 'represents',
      target,
      created_at: new Date().toISOString(),
    },
  ];
}

const identityEditCommand = new Command('edit')
  .description('Edit local identity details and sync hosted profiles when applicable')
  .option('--name <name>', 'Display name')
  .option('--handle <handle>', 'Handle (e.g. @yourname)')
  .option('--bio <bio>', 'Short bio')
  .option('--languages <langs>', 'Comma-separated languages')
  .option('--type <type>', 'Entity type (person|agent|org|service|bot)')
  .option('--id <url>', 'Public endpoint URL for this identity')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--skills <skills>', 'Comma-separated skills')
  .option('--represents <url>', 'URL of entity this agent represents')
  .option('--clear-represents', 'Remove the current represents relationship')
  .action(async (opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const manifest = await readManifest({ autoMigrate: false });
    if (!manifest) {
      output(json ? { error: 'Manifest not found' } : 'Manifest not found. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const hostedIdentity = isHostedEndpoint(manifest.entity.id);
    const requestedHandle = typeof opts.handle === 'string'
      ? opts.handle.replace(/^@/, '')
      : undefined;
    const requestedId = typeof opts.id === 'string'
      ? opts.id.trim()
      : undefined;

    if (hostedIdentity && requestedHandle && requestedHandle !== manifest.entity.handle) {
      output(
        json
          ? { error: 'Hosted identities cannot change handle locally' }
          : 'Hosted identities cannot change handle locally. Rename the hosted account first, then refresh your local manifest.',
        json,
      );
      process.exitCode = 1;
      return;
    }

    if (hostedIdentity && requestedId && requestedId !== manifest.entity.id) {
      const hostedSurface = new URL(getHostedRuntimeConfig().hubWebBaseUrl).host;
      output(
        json
          ? { error: 'Hosted identities cannot change endpoint locally' }
          : `Hosted identities cannot change endpoint locally. The hosted endpoint is managed by ${hostedSurface}.`,
        json,
      );
      process.exitCode = 1;
      return;
    }

    const currentRepresents = manifest.relationships.find((relationship) => relationship.type === 'represents')?.target ?? '';
    const hasInlineUpdates = [
      opts.name,
      opts.handle,
      opts.bio,
      opts.languages,
      opts.type,
      opts.id,
      opts.tags,
      opts.skills,
      opts.represents,
      opts.clearRepresents,
    ].some(Boolean);

    if (json && !hasInlineUpdates) {
      output({ error: 'No fields to update' }, true);
      process.exitCode = 1;
      return;
    }

    let name: string;
    let handle: string;
    let bio: string;
    let languagesRaw: string;
    let entityType: EntityType;
    let entityId: string;
    let tagsRaw: string;
    let skillsRaw: string;
    let represents: string;

    try {
      name = opts.name ?? await prompt('Name', manifest.entity.name);
      handle = hostedIdentity
        ? manifest.entity.handle
        : (opts.handle ?? await prompt('Handle (e.g. @yourname)', manifest.entity.handle)).replace(/^@/, '');
      bio = opts.bio ?? await prompt('Bio', manifest.entity.bio || '');
      languagesRaw = opts.languages ?? await prompt('Languages (comma-separated)', manifest.entity.languages.join(', '));
      entityType = (opts.type ?? await prompt('Type', manifest.entity.type)) as EntityType;
      entityId = hostedIdentity
        ? manifest.entity.id
        : opts.id ?? await prompt('Entity URL', manifest.entity.id);
      tagsRaw = opts.tags ?? await prompt('Tags (comma-separated)', (manifest.entity.tags ?? []).join(', '));
      skillsRaw = opts.skills ?? await prompt(
        'Skills (comma-separated)',
        (manifest.skills ?? []).map((skill) => typeof skill === 'string' ? skill : skill.name).join(', '),
      );
      represents = opts.clearRepresents
        ? ''
        : opts.represents ?? await prompt('Represents URL (blank to clear)', currentRepresents);
    } finally {
      closePrompts();
    }

    manifest.entity.name = name;
    manifest.entity.handle = handle;
    manifest.entity.bio = bio;
    manifest.entity.languages = parseCsv(languagesRaw);
    manifest.entity.type = entityType;
    manifest.entity.id = entityId;

    const tags = parseCsv(tagsRaw).map((tag) => tag.toLowerCase());
    if (tags.length > 0) {
      manifest.entity.tags = tags;
    } else {
      delete manifest.entity.tags;
    }

    const skills = parseCsv(skillsRaw).map((skill) => skill.toLowerCase());
    if (skills.length > 0) {
      manifest.skills = skills;
    } else {
      delete manifest.skills;
    }

    manifest.relationships = upsertRepresentsRelationship(manifest.relationships, represents.trim());

    await writeManifest(manifest);

    const syncResults = hostedIdentity
      ? await syncHostedManifestTargets(manifest)
      : null;

    if (syncResults && (!syncResults.hubResult?.ok || syncResults.indexResults.some((result) => !result.ok))) {
      process.exitCode = 1;
    }

    if (json) {
      output({
        status: 'updated',
        manifest,
        ...(syncResults
          ? {
              hub: syncResults.hubResult,
              indexes: syncResults.indexResults,
            }
          : {}),
      }, true);
      return;
    }

    console.log('\nUpdated local identity.');
    console.log(`  Handle:    ${manifest.entity.handle}`);
    console.log(`  Endpoint:  ${manifest.entity.id}`);
    console.log(`  Type:      ${manifest.entity.type}`);
    console.log(`  Languages: ${manifest.entity.languages.join(', ')}`);
    if (manifest.entity.tags?.length) {
      console.log(`  Tags:      ${manifest.entity.tags.join(', ')}`);
    }
    if (manifest.skills?.length) {
      console.log(`  Skills:    ${manifest.skills.map((skill) => typeof skill === 'string' ? skill : skill.name).join(', ')}`);
    }
    if (represents.trim()) {
      console.log(`  Represents:${represents.trim()}`);
    }
    if (!syncResults) {
      console.log('\nThis only updates your local manifest. Make sure your public endpoint serves the new manifest before running `asp index sync`.');
      return;
    }

    console.log('\nHosted sync results:');
    if (syncResults.hubResult) {
      console.log(`  Hub:       ${syncResults.hubResult.ok ? 'synced' : `failed - ${syncResults.hubResult.error}`}`);
    }
    if (syncResults.indexResults.length === 0) {
      console.log('  Indexes:   none configured locally');
      return;
    }

    for (const result of syncResults.indexResults) {
      console.log(`  Index:     ${result.url} - ${result.ok ? 'synced' : `failed - ${result.error}`}`);
    }
  });

const identityMigrateHostedEndpointCommand = new Command('migrate-hosted-endpoint')
  .description('Migrate a legacy hosted .letus.social identity to the canonical hosted endpoint')
  .action(async (_opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const manifest = await readManifest({ autoMigrate: false });
    if (!manifest) {
      output(json ? { error: 'Manifest not found' } : 'Manifest not found. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    const migration = migrateLegacyHostedManifest(manifest);
    if (!migration.ok) {
      output(json ? { error: migration.error } : migration.error, json);
      process.exitCode = 1;
      return;
    }

    if (!migration.updated) {
      if (json) {
        output({
          status: 'unchanged',
          endpoint: manifest.entity.id,
        }, true);
        return;
      }

      console.log('\nHosted endpoint already uses the canonical domain.');
      console.log(`  Endpoint:  ${manifest.entity.id}`);
      return;
    }

    await writeManifest(manifest);
    const syncResults = await syncHostedManifestTargets(manifest);
    if (!syncResults.hubResult?.ok || syncResults.indexResults.some((result) => !result.ok)) {
      process.exitCode = 1;
    }

    if (json) {
      output({
        status: 'migrated',
        previous_endpoint: migration.previousEndpoint,
        endpoint: migration.nextEndpoint,
        rewritten_endpoint_fields: migration.rewrittenEndpointFields,
        hub: syncResults.hubResult,
        indexes: syncResults.indexResults,
      }, true);
      return;
    }

    console.log('\nMigrated hosted endpoint to the canonical protocol domain.');
    console.log(`  Previous:  ${migration.previousEndpoint}`);
    console.log(`  Current:   ${migration.nextEndpoint}`);
    if (migration.rewrittenEndpointFields.length > 0) {
      console.log(`  Endpoints: ${migration.rewrittenEndpointFields.join(', ')}`);
    }

    console.log('\nHosted sync results:');
    if (syncResults.hubResult) {
      console.log(`  Hub:       ${syncResults.hubResult.ok ? 'synced' : `failed - ${syncResults.hubResult.error}`}`);
    }
    if (syncResults.indexResults.length === 0) {
      console.log('  Indexes:   none configured locally');
      return;
    }

    for (const result of syncResults.indexResults) {
      console.log(`  Index:     ${result.url} - ${result.ok ? 'synced' : `failed - ${result.error}`}`);
    }
  });

export const identityCommand = new Command('identity')
  .description('Manage local identity state')
  .addCommand(identityEditCommand)
  .addCommand(identityMigrateHostedEndpointCommand);
