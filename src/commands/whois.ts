import { Command } from 'commander';
import yaml from 'js-yaml';
import { storeInitialized } from '../store/index.js';
import { getReputationRecord } from '../store/reputation-store.js';
import { readRelationships } from '../store/relationship-store.js';
import { readFollowing } from '../store/following-store.js';
import { output } from '../utils/output.js';
import type { Manifest } from '../models/manifest.js';
import { resolveEndpoint, normalizeEndpoint } from '../identity/resolve-target.js';
import { buildEndpointUrl } from '../utils/endpoint-url.js';

export const whoisCommand = new Command('whois')
  .description('Look up an entity — fetch manifest and compute trust')
  .argument('<url>', 'Target (@handle, domain, or URL)')
  .action(async (url, _opts, cmd) => {
    const json = cmd.optsWithGlobals().json;
    try {
      url = normalizeEndpoint(await resolveEndpoint(url));
    } catch (err) {
      output(json ? { error: (err as Error).message } : (err as Error).message, json);
      process.exitCode = 1;
      return;
    }

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    // Fetch remote manifest
    let manifest: Manifest | null = null;
    try {
      const manifestUrl = buildEndpointUrl(url, '/.well-known/asp.yaml');
      const res = await fetch(manifestUrl.toString());
      if (!res.ok) {
        const msg = `Could not fetch manifest: HTTP ${res.status}`;
        output(json ? { error: msg } : msg, json);
        process.exitCode = 1;
        return;
      }
      const text = await res.text();
      manifest = yaml.load(text) as Manifest;
    } catch (err) {
      const msg = `Could not reach ${url}: ${(err as Error).message}`;
      output(json ? { error: msg } : msg, json);
      process.exitCode = 1;
      return;
    }

    const entity = manifest?.entity;

    // Check local knowledge
    const reputation = await getReputationRecord(url);
    const relationships = await readRelationships();
    const followingList = await readFollowing();

    const isFollowing = followingList.some(s => normalizeEndpoint(s.url) === url);
    const mutualRelations = relationships.filter(r => normalizeEndpoint(r.target) === url);

    if (json) {
      output({
        entity: {
          id: entity?.id,
          type: entity?.type,
          name: entity?.name,
          handle: entity?.handle,
          bio: entity?.bio,
          tags: entity?.tags,
          languages: entity?.languages,
        },
        skills: manifest?.skills,
        capabilities: manifest?.capabilities,
        local_context: {
          following: isFollowing,
          relationships: mutualRelations.map(r => r.type),
          reputation: reputation ? {
            trust_score: reputation.computed_trust,
            direct_interactions: reputation.direct?.interactions_count,
          } : null,
        },
      }, true);
      return;
    }

    console.log(`\n${entity?.name || url}`);
    console.log(`──────────`);
    console.log(`  ID:       ${entity?.id}`);
    console.log(`  Type:     ${entity?.type}`);
    console.log(`  Handle:   ${entity?.handle}`);
    console.log(`  Bio:      ${entity?.bio}`);
    if (entity?.tags?.length) {
      console.log(`  Tags:     ${entity.tags.join(', ')}`);
    }
    console.log(`  Language: ${entity?.languages?.join(', ')}`);
    console.log('');
    console.log(`  You follow:    ${isFollowing ? 'yes' : 'no'}`);
    if (mutualRelations.length > 0) {
      console.log(`  Relationships: ${mutualRelations.map(r => r.type).join(', ')}`);
    }
    if (reputation) {
      console.log(`  Trust:         ${reputation.computed_trust}`);
      if (reputation.direct) {
        console.log(`  Interactions:  ${reputation.direct.interactions_count} direct`);
      }
    } else {
      console.log(`  Trust:         (no history)`);
    }
  });
