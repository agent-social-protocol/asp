import { Command } from 'commander';
import { storeInitialized } from '../store/index.js';
import { prompt, closePrompts } from '../utils/prompts.js';
import { output } from '../utils/output.js';
import type { EntityType } from '../models/manifest.js';
import { getStoreDisplayPath } from '../config/cli.js';
import { enableManifestEncryption, initializeLocalIdentity } from '../identity/bootstrap.js';
import { describeDetectedAgentFrameworks, detectAgentFrameworks } from '../hosted/onboarding.js';

export const initCommand = new Command('init')
  .description('Initialize your ASP identity')
  .option('--name <name>', 'Your name')
  .option('--handle <handle>', 'Handle (e.g. @yourname)')
  .option('--bio <bio>', 'Short bio')
  .option('--languages <langs>', 'Comma-separated languages', 'en')
  .option('--type <type>', 'Entity type (person|agent|org|service|bot)', 'person')
  .option('--id <url>', 'Entity URL identity (e.g. https://jason.dev)')
  .option('--tags <tags>', 'Comma-separated tags (e.g. ai,music,nyc)')
  .option('--autonomy <level>', 'Agent autonomy level (low|medium|high)', 'medium')
  .option('--represents <url>', 'URL of entity this agent represents')
  .option('--skills <skills>', 'Comma-separated skills (e.g. translation,scheduling,code-review)')
  .option('--enable-encryption', 'Add encryption key to existing identity')
  .action(async (opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    // Upgrade path: add encryption to existing identity
    if (opts.enableEncryption) {
      if (!storeInitialized()) {
        output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
        process.exitCode = 1;
        return;
      }
      let encKeyStr: string;
      try {
        ({ encryptionKey: encKeyStr } = await enableManifestEncryption());
      } catch (err) {
        output(
          json ? { error: (err as Error).message } : `${(err as Error).message} (${getStoreDisplayPath()}/encryption.pem exists).`,
          json,
        );
        return;
      }
      if (json) {
        output({ status: 'encryption_enabled', encryption_key: encKeyStr }, true);
      } else {
        console.log(`Encryption enabled.`);
        console.log(`  Key: ${encKeyStr.slice(0, 30)}...`);
        console.log(`  Stored: ${getStoreDisplayPath()}/encryption.pem`);
      }
      return;
    }

    if (storeInitialized()) {
      output(
        json
          ? { error: 'Already initialized', next: 'asp identity edit' }
          : 'Identity already exists. Run `asp identity edit` to change it.',
        json,
      );
      process.exitCode = 1;
      return;
    }

    let name: string, handle: string, bio: string, langs: string, id: string;
    try {
      name = opts.name || await prompt('Your name');
      handle = opts.handle || await prompt('Handle (e.g. @yourname)');
      handle = handle.replace(/^@/, '');
      bio = opts.bio || await prompt('Short bio');
      langs = opts.languages || await prompt('Languages (comma-separated)', 'en');
      id = opts.id || await prompt('Entity URL (e.g. https://jason.dev)', `https://${handle.replace('@', '')}.dev`);
    } finally {
      closePrompts();
    }
    const languages = langs.split(',').map((l: string) => l.trim()).filter(Boolean);
    const entityType = (opts.type || 'person') as EntityType;
    const tags = opts.tags
      ? opts.tags.split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean)
      : undefined;

    const skills = opts.skills
      ? opts.skills.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
      : undefined;

    const { manifest, behavior, publicKey } = await initializeLocalIdentity({
      id,
      type: entityType,
      name,
      handle,
      bio,
      tags,
      skills,
      languages,
      represents: opts.represents,
      autonomy: opts.autonomy as 'low' | 'medium' | 'high' | undefined,
    });

    const detectedFrameworks = detectAgentFrameworks();
    const detectedRuntimeNames = detectedFrameworks.map((framework) => framework.name);

    if (json) {
      output({ status: 'initialized', manifest, behavior, detected_agent_runtimes: detectedRuntimeNames }, true);
    } else {
      console.log(`\nInitialized ASP identity:`);
      console.log(`  ID:        ${manifest.entity.id}`);
      console.log(`  Type:      ${manifest.entity.type}`);
      console.log(`  Name:      ${manifest.entity.name}`);
      console.log(`  Handle:    ${manifest.entity.handle}`);
      console.log(`  Bio:       ${manifest.entity.bio}`);
      if (manifest.entity.tags?.length) {
        console.log(`  Tags:      ${manifest.entity.tags.join(', ')}`);
      }
      console.log(`  Languages: ${manifest.entity.languages.join(', ')}`);
      console.log(`  Key:       ${publicKey.slice(0, 30)}...`);
      console.log(`  Autonomy:  ${behavior.autonomy_level}`);
      if (opts.represents) {
        console.log(`  Represents: ${opts.represents}`);
      }
      console.log(`\nStored at ${getStoreDisplayPath()}/`);
      console.log(`  Private key: ${getStoreDisplayPath()}/private.pem (keep this safe!)`);
      console.log(`\nNext steps:`);
      console.log(`  asp serve --port 3000              Start your endpoint`);
      console.log(`  asp index register                 Register on ASP Index`);
      console.log(`  asp identity edit                  Update local identity details later`);
      if (detectedFrameworks.length > 0) {
        console.log(`  asp tools install --all            Enable ASP tools in detected runtimes`);
      }
      console.log(`  asp follow @handle                 Follow someone`);
      console.log(`\nYour public endpoint is ${manifest.entity.id}. Make sure it serves this manifest before registering with an index.`);
      if (detectedFrameworks.length > 0) {
        console.log(`Detected agent runtimes: ${describeDetectedAgentFrameworks(detectedFrameworks)}`);
        console.log('Run `asp tools install --all` whenever you want ASP tools in those runtimes.');
      }
    }
  });
