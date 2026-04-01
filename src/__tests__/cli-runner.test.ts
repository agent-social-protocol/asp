import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('cli runner', () => {
  it('returns structured json argument errors with usage hints', async () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const { runCli } = await import('../cli-runner.js');
    const exitCode = await runCli(['node', 'asp', '--json', 'message', '@bob', 'hello']);

    expect(exitCode).toBe(1);
    expect(stderrWrite).not.toHaveBeenCalled();

    const rendered = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join('');
    const payload = JSON.parse(rendered);
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: 'invalid_args',
        command: 'asp message',
        usage: 'asp message <target> --text <text>',
        hint: 'Pass the message body with --text.',
      },
    });
  });
});
