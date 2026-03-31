import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeManifest } from '../store/manifest-store.js';
import { buildHostedEndpoint, isHostedEndpoint } from '../config/hosted.js';
import { pushManifestToHub } from '../utils/hub-push.js';
import { registerWithHubRetry } from '../utils/hub-registration.js';
import { pushManifestToIndexes } from '../utils/index-push.js';
import type { Manifest } from '../models/manifest.js';

export const SUPPORTED_AGENT_FRAMEWORK_TARGETS = ['claude', 'cursor', 'vscode', 'openclaw'] as const;
export type AgentFrameworkTarget = (typeof SUPPORTED_AGENT_FRAMEWORK_TARGETS)[number];

interface DetectedFramework {
  key: AgentFrameworkTarget;
  name: string;
  configure: () => boolean;
}

export function detectAgentFrameworks(): DetectedFramework[] {
  const home = homedir();
  const frameworks: DetectedFramework[] = [];
  const mcpArgs = ['-y', '-p', 'asp-protocol', 'asp-mcp'];

  if (existsSync(join(home, '.claude'))) {
    frameworks.push({
      key: 'claude',
      name: 'Claude Code',
      configure: () => {
        const result = spawnSync('claude', ['mcp', 'add', 'asp', '--', 'npx', ...mcpArgs], { stdio: 'pipe' });
        if (result.status === 0) return true;
        // Fallback: write settings.json directly
        try {
          const settingsPath = join(home, '.claude', 'settings.json');
          const existing = existsSync(settingsPath)
            ? JSON.parse(readFileSync(settingsPath, 'utf-8'))
            : {};
          existing.mcpServers = existing.mcpServers || {};
          if (existing.mcpServers.asp) return true; // already configured
          existing.mcpServers.asp = { command: 'npx', args: mcpArgs };
          writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n');
          return true;
        } catch {
          return false;
        }
      },
    });
  }

  if (existsSync(join(home, '.cursor'))) {
    frameworks.push({
      key: 'cursor',
      name: 'Cursor',
      configure: () => {
        const configPath = join(home, '.cursor', 'mcp.json');
        const existing = existsSync(configPath)
          ? JSON.parse(readFileSync(configPath, 'utf-8'))
          : { mcpServers: {} };
        existing.mcpServers = existing.mcpServers || {};
        existing.mcpServers.asp = { command: 'npx', args: mcpArgs };
        writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n');
        return true;
      },
    });
  }

  const vscodeDir = join(home, '.vscode');
  if (existsSync(vscodeDir)) {
    frameworks.push({
      key: 'vscode',
      name: 'VS Code',
      configure: () => {
        const configPath = join(vscodeDir, 'mcp.json');
        const existing = existsSync(configPath)
          ? JSON.parse(readFileSync(configPath, 'utf-8'))
          : { mcpServers: {} };
        existing.mcpServers = existing.mcpServers || {};
        existing.mcpServers.asp = { command: 'npx', args: mcpArgs };
        writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n');
        return true;
      },
    });
  }

  const openclawDir = join(home, '.openclaw');
  if (existsSync(openclawDir)) {
    frameworks.push({
      key: 'openclaw',
      name: 'OpenClaw',
      configure: () => {
        const configPath = join(openclawDir, 'openclaw.json');
        const existing = existsSync(configPath)
          ? JSON.parse(readFileSync(configPath, 'utf-8'))
          : { mcpServers: {} };
        existing.mcpServers = existing.mcpServers || {};
        existing.mcpServers.asp = { command: 'npx', args: mcpArgs };
        writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n');
        return true;
      },
    });
  }

  return frameworks;
}

export function describeDetectedAgentFrameworks(
  frameworks: Array<{ name: string }> = detectAgentFrameworks(),
): string {
  return frameworks.map((framework) => framework.name).join(', ');
}

export function installASPTools(target: AgentFrameworkTarget | 'all' = 'all'): {
  detected: Array<{ key: AgentFrameworkTarget; name: string }>;
  results: Array<{ key: AgentFrameworkTarget; name: string; ok: boolean }>;
} {
  const frameworks = detectAgentFrameworks();
  const selected = target === 'all'
    ? frameworks
    : frameworks.filter((framework) => framework.key === target);

  return {
    detected: frameworks.map((framework) => ({ key: framework.key, name: framework.name })),
    results: selected.map((framework) => ({
      key: framework.key,
      name: framework.name,
      ok: framework.configure(),
    })),
  };
}

export async function registerHostedIdentity(
  manifest: Manifest,
  handle: string,
  publicKey: string,
): Promise<Manifest> {
  if (!isHostedEndpoint(manifest.entity.id)) {
    return manifest;
  }

  const regResult = await registerWithHubRetry(handle, manifest, publicKey);
  if (regResult.handle !== handle) {
    manifest.entity.handle = regResult.handle;
    manifest.entity.id = buildHostedEndpoint(regResult.handle);
    await writeManifest(manifest);
  }

  return manifest;
}

export async function syncHostedManifestTargets(manifest: Manifest): Promise<{
  hubResult: { ok: boolean; error?: string } | null;
  indexResults: Array<{ url: string; ok: boolean; error?: string }>;
}> {
  const hubResult = isHostedEndpoint(manifest.entity.id)
    ? await pushManifestToHub(manifest)
    : null;
  const indexResults = await pushManifestToIndexes(manifest.entity.id);
  return { hubResult, indexResults };
}
