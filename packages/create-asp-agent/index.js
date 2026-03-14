#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { dirname, join } = require('node:path');

function normalizeArgs(rawArgs) {
  if (rawArgs[0] === 'follow') {
    if (!rawArgs[1]) {
      console.log('  Usage: create-asp-agent follow <@handle or url>\n');
      process.exit(1);
    }
    return rawArgs.slice(1);
  }
  return rawArgs;
}

function resolveInstalledAspCreate() {
  try {
    const packageJsonPath = require.resolve('asp-create/package.json');
    return join(dirname(packageJsonPath), 'dist', 'index.js');
  } catch {
    return null;
  }
}

const args = normalizeArgs(process.argv.slice(2));

let result = spawnSync('asp-create', args, { stdio: 'inherit', env: process.env });
if (result.error && result.error.code === 'ENOENT') {
  const installedAspCreate = resolveInstalledAspCreate();
  if (installedAspCreate) {
    result = spawnSync(process.execPath, [installedAspCreate, ...args], { stdio: 'inherit', env: process.env });
  }
}
if (result.error && result.error.code === 'ENOENT') {
  result = spawnSync('npx', ['-y', 'asp-create', ...args], { stdio: 'inherit', env: process.env });
}

process.exit(result.status ?? 1);
