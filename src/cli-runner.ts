import { CommanderError } from 'commander';
import { program } from './cli.js';
import { buildCommanderJsonError } from './utils/cli-error.js';

function isJsonMode(argv: string[]): boolean {
  return argv.includes('--json');
}

function configureProgramTree(json: boolean): void {
  const queue = [program];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    current.configureOutput({
      outputError: (str, write) => {
        if (!json) {
          write(str);
        }
      },
    });
    current.exitOverride();
    queue.push(...current.commands);
  }
}

export async function runCli(argv: string[] = process.argv): Promise<number> {
  const json = isJsonMode(argv);

  configureProgramTree(json);

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (!(error instanceof CommanderError)) {
      throw error;
    }

    if (error.code === 'commander.helpDisplayed') {
      return 0;
    }

    if (json) {
      process.stdout.write(`${JSON.stringify(buildCommanderJsonError(error, argv, program), null, 2)}\n`);
    }

    return error.exitCode || 1;
  }
}
