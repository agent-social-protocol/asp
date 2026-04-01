import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { isManifest } from '../models/manifest.js';
import type { ASPClientIdentity, ASPIdentityProvider } from './types.js';
import { autoMigrateLegacyHostedManifestFile } from '../hosted/manifest-migration.js';

export class FileIdentityProvider implements ASPIdentityProvider {
  constructor(private readonly identityDir: string) {}

  loadIdentity(): ASPClientIdentity {
    if (!existsSync(this.identityDir)) {
      throw new Error('Identity directory not found');
    }

    const manifestPath = join(this.identityDir, 'manifest.yaml');
    if (!existsSync(manifestPath)) {
      throw new Error('manifest.yaml not found');
    }

    const raw = readFileSync(manifestPath, 'utf-8');
    const parsed = yaml.load(raw);
    if (!isManifest(parsed)) {
      throw new Error('Invalid manifest format');
    }
    autoMigrateLegacyHostedManifestFile(manifestPath, parsed);

    const keyPath = join(this.identityDir, 'private.pem');
    const encKeyPath = join(this.identityDir, 'encryption.pem');

    return {
      manifest: parsed,
      privateKey: existsSync(keyPath) ? readFileSync(keyPath, 'utf-8').trim() : null,
      encryptionKey: existsSync(encKeyPath) ? readFileSync(encKeyPath, 'utf-8').trim() : null,
      identityDir: this.identityDir,
    };
  }
}
