import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
});
