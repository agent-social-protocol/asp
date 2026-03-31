import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readPackageVersion } from '../utils/package-version.js';

interface RootPackageJson {
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readRootPackageJson(): RootPackageJson {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf-8'),
  ) as RootPackageJson;
}

describe('package boundary', () => {
  it('does not publish the core-index dev adapter from asp-protocol', () => {
    const pkg = readRootPackageJson();

    expect(pkg.bin).toEqual({
      asp: './dist/bin/asp.js',
      'asp-mcp': './dist/bin/asp-mcp.js',
    });
  });

  it('keeps better-sqlite3 out of asp-protocol runtime dependencies', () => {
    const pkg = readRootPackageJson();

    expect(pkg.dependencies?.['better-sqlite3']).toBeUndefined();
    expect(pkg.devDependencies?.['better-sqlite3']).toBeTruthy();
  });

  it('resolves package version from both source and dist-style entrypoints', () => {
    const expectedVersion = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf-8'),
    ) as { version: string };

    const sourceCliUrl = pathToFileURL(join(process.cwd(), 'src', 'cli.ts')).href;
    const distCliUrl = pathToFileURL(join(process.cwd(), 'dist', 'src', 'cli.js')).href;
    const sourceMcpUrl = pathToFileURL(join(process.cwd(), 'bin', 'asp-mcp.ts')).href;
    const distMcpUrl = pathToFileURL(join(process.cwd(), 'dist', 'bin', 'asp-mcp.js')).href;

    expect(readPackageVersion(sourceCliUrl)).toBe(expectedVersion.version);
    expect(readPackageVersion(distCliUrl)).toBe(expectedVersion.version);
    expect(readPackageVersion(sourceMcpUrl)).toBe(expectedVersion.version);
    expect(readPackageVersion(distMcpUrl)).toBe(expectedVersion.version);
  });
});
