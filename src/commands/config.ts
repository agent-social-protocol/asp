import { Command } from 'commander';
import { storeInitialized } from '../store/index.js';
import { readBehavior, writeBehavior } from '../store/behavior-store.js';
import { createDefaultBehavior } from '../config/behavior.js';
import { output } from '../utils/output.js';
import type { BehaviorConfig } from '../config/behavior.js';

export const configCommand = new Command('config')
  .description('View or update agent behavior configuration')
  .option('--set <key=value>', 'Set a config value (e.g. --set autonomy_level=high)')
  .option('--show', 'Show current config')
  .action(async (opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    let config = await readBehavior();
    if (!config) {
      config = createDefaultBehavior('medium');
    }

    // If --set, parse and update
    if (opts.set) {
      const eqIdx = opts.set.indexOf('=');
      if (eqIdx === -1) {
        output(json ? { error: 'Invalid format. Use --set key=value' } : 'Invalid format. Use --set key=value.', json);
        process.exitCode = 1;
        return;
      }

      const key = opts.set.slice(0, eqIdx).trim();
      const value = opts.set.slice(eqIdx + 1).trim();

      // Handle top-level keys
      if (key === 'autonomy_level') {
        const validLevels = ['low', 'medium', 'high'];
        if (!validLevels.includes(value)) {
          const msg = `Invalid autonomy_level "${value}". Must be one of: ${validLevels.join(', ')}`;
          output(json ? { error: msg } : msg, json);
          process.exitCode = 1;
          return;
        }
        config.autonomy_level = value as BehaviorConfig['autonomy_level'];
      } else if (key.startsWith('permissions.')) {
        const permKey = key.slice('permissions.'.length) as keyof BehaviorConfig['permissions'];
        if (!(permKey in config.permissions)) {
          output(json ? { error: `Unknown permission: ${permKey}` } : `Unknown permission: ${permKey}`, json);
          process.exitCode = 1;
          return;
        }
        const validPerms = ['auto', 'auto_notify', 'ask'];
        if (!validPerms.includes(value)) {
          const msg = `Invalid permission value "${value}". Must be one of: ${validPerms.join(', ')}`;
          output(json ? { error: msg } : msg, json);
          process.exitCode = 1;
          return;
        }
        (config.permissions as Record<string, string>)[permKey] = value;
      } else if (key.startsWith('preferences.')) {
        const prefKey = key.slice('preferences.'.length);
        if (prefKey === 'social_style') {
          const validStyles = ['open', 'selective', 'conservative'];
          if (!validStyles.includes(value)) {
            const msg = `Invalid social_style "${value}". Must be one of: ${validStyles.join(', ')}`;
            output(json ? { error: msg } : msg, json);
            process.exitCode = 1;
            return;
          }
          config.preferences.social_style = value as BehaviorConfig['preferences']['social_style'];
        } else if (prefKey === 'notification_frequency') {
          const validFreqs = ['realtime', 'hourly', 'daily_digest'];
          if (!validFreqs.includes(value)) {
            const msg = `Invalid notification_frequency "${value}". Must be one of: ${validFreqs.join(', ')}`;
            output(json ? { error: msg } : msg, json);
            process.exitCode = 1;
            return;
          }
          config.preferences.notification_frequency = value as BehaviorConfig['preferences']['notification_frequency'];
        } else if (prefKey === 'content_interests') {
          config.preferences.content_interests = value.split(',').map((s: string) => s.trim()).filter(Boolean);
        } else {
          output(json ? { error: `Unknown preference: ${prefKey}` } : `Unknown preference: ${prefKey}`, json);
          process.exitCode = 1;
          return;
        }
      } else {
        output(json ? { error: `Unknown config key: ${key}` } : `Unknown config key: ${key}`, json);
        process.exitCode = 1;
        return;
      }

      await writeBehavior(config);

      if (json) {
        output({ status: 'updated', key, value, config }, true);
      } else {
        console.log(`Updated ${key} = ${value}`);
      }
      return;
    }

    // Default: show current config
    if (json) {
      output(config, true);
      return;
    }

    console.log('Behavior Configuration:\n');
    console.log(`  Autonomy Level: ${config.autonomy_level}\n`);
    console.log('  Permissions:');
    for (const [k, v] of Object.entries(config.permissions)) {
      console.log(`    ${k}: ${v}`);
    }
    console.log('\n  Preferences:');
    console.log(`    Social Style:    ${config.preferences.social_style}`);
    console.log(`    Notifications:   ${config.preferences.notification_frequency}`);
    console.log(`    Interests:       ${config.preferences.content_interests.length > 0 ? config.preferences.content_interests.join(', ') : '(none)'}`);
  });
