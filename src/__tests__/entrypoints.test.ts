import { describe, expect, it } from 'vitest';

describe('package entrypoints', () => {
  it('keeps the root entrypoint library-only', async () => {
    const mod = await import('../index.js');

    expect(mod.ASPClient).toBeTypeOf('function');
    expect(mod.ASPNode).toBeTypeOf('function');
    expect('program' in mod).toBe(false);
  });

  it('exports the commander program from the CLI entrypoint', async () => {
    const mod = await import('../cli.js');

    expect(mod.program.name()).toBe('asp');
    expect(mod.program.commands.map((command) => command.name())).toContain('tools');
  }, 10000);
});
