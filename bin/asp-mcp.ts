#!/usr/bin/env node
// bin/asp-mcp.ts — ASP MCP Server entry point
//
// Usage:
//   asp-mcp                                   # single identity (default CLI store dir)
//   asp-mcp --identity ~/.asp/primary --identity ~/.asp/secondary  # multi

import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ASPClient } from '../src/lib/asp-client.js';
import { getCliRuntimeConfig } from '../src/config/cli.js';
import { createASPMCPServer } from '../src/mcp/server.js';
import { readPackageVersion } from '../src/utils/package-version.js';

const USAGE = `Usage: asp-mcp [options]

Start the ASP MCP server over stdio

Options:
  --identity <path>    Load an ASP identity directory (can be passed multiple times)
  --version            Print version
  -h, --help           Show help`;

function parseCliArgs() {
  try {
    return parseArgs({
      options: {
        identity: { type: 'string', multiple: true },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean' },
      },
      strict: true,
    });
  } catch (error) {
    process.stderr.write(`Error: ${(error as Error).message}\n`);
    process.stderr.write(`${USAGE}\n`);
    process.exit(1);
  }
}

const { values } = parseCliArgs();

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

if (values.version) {
  const version = readPackageVersion(import.meta.url);
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

const cliConfig = getCliRuntimeConfig();

// 1. Determine identity directories
const defaultIdentityDir = cliConfig.storeDir;
const dirs = values.identity?.length
  ? values.identity
  : [defaultIdentityDir];

// 2. Load each identity → ASPClient instance
const clients = new Map<string, ASPClient>();
for (const dir of dirs) {
  if (!existsSync(dir)) {
    process.stderr.write(`Error: Identity directory not found: ${dir}\n`);
    process.stderr.write('Run `asp init` to create an identity.\n');
    process.exit(1);
  }
  const client = new ASPClient({
    identityDir: dir,
    coreIndexUrl: cliConfig.coreIndexUrl,
  });
  const manifest = await client.getManifest();
  const handle = manifest.entity.handle.replace(/^@/, '');
  if (clients.has(handle)) {
    process.stderr.write(`Error: Duplicate handle "${handle}" from ${dir}\n`);
    process.exit(1);
  }
  clients.set(handle, client);
}

if (clients.size === 0) {
  process.stderr.write('Error: No identities loaded. Run `asp init` first.\n');
  process.exit(1);
}

// 3. Start MCP Server
const version = readPackageVersion(import.meta.url);
const server = createASPMCPServer(clients, { version });
const transport = new StdioServerTransport();
await server.connect(transport);
