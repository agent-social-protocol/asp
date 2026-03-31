import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

function findNearestPackageJson(importMetaUrl: string): string {
  let currentDir = dirname(fileURLToPath(importMetaUrl));
  const { root } = parse(currentDir);

  while (true) {
    const candidate = join(currentDir, 'package.json');
    if (existsSync(candidate)) {
      return candidate;
    }

    if (currentDir === root) {
      throw new Error(`Could not locate package.json from ${importMetaUrl}`);
    }

    currentDir = dirname(currentDir);
  }
}

export function readPackageVersion(importMetaUrl: string): string {
  const packageJsonPath = findNearestPackageJson(importMetaUrl);
  const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version?: unknown };

  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Invalid version field in ${packageJsonPath}`);
  }

  return version;
}
