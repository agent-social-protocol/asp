import type { Command, CommanderError } from 'commander';
import { output } from './output.js';

export interface CliJsonErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    command?: string;
    usage?: string;
    hint?: string;
    details?: Record<string, unknown>;
  };
}

interface CliErrorOptions {
  code: string;
  message: string;
  command?: string;
  usage?: string;
  hint?: string;
  human?: string;
  details?: Record<string, unknown>;
}

function commandPath(command: Command): string {
  const segments: string[] = [];
  let cursor: Command | null = command;
  while (cursor && cursor.parent) {
    segments.unshift(cursor.name());
    cursor = cursor.parent;
  }
  return segments.join(' ');
}

function fullUsage(command: Command | null): string | undefined {
  if (!command || !command.parent) {
    return undefined;
  }
  const path = commandPath(command);
  const usage = command.usage();
  return usage ? `asp ${path} ${usage}` : `asp ${path}`;
}

function consumesValue(command: Command, token: string): boolean {
  const option = command.options.find((candidate) => candidate.short === token || candidate.long === token);
  return !!option && !option.isBoolean();
}

function findCommandForArgv(root: Command, argv: string[]): Command | null {
  let current: Command = root;
  const args = argv.slice(2);

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--json') {
      continue;
    }

    if (token.startsWith('-')) {
      if (consumesValue(current, token) && i + 1 < args.length) {
        i += 1;
      }
      continue;
    }

    const nextCommand = current.commands.find((candidate) => candidate.name() === token || candidate.aliases().includes(token));
    if (!nextCommand) {
      break;
    }
    current = nextCommand;
  }

  return current === root ? null : current;
}

function commandSpecificHint(command: Command | null, error: CommanderError): { usage?: string; hint?: string } {
  if (!command) {
    return {};
  }

  const path = commandPath(command);
  if (path === 'message') {
    if (error.code === 'commander.excessArguments') {
      return {
        usage: 'asp message <target> --text <text>',
        hint: 'Pass the message body with --text.',
      };
    }
    return {
      usage: 'asp message <target> --text <text>',
    };
  }

  if (path === 'notifications') {
    return { usage: 'asp notifications [--peek]' };
  }

  if (path === 'inbox') {
    return { usage: 'asp inbox [--follow] [--kind <message|interaction>] [--direction <received|sent>]' };
  }

  if (path === 'feed') {
    return { usage: 'asp feed [--from <url>] [--since <date>] [--type <signal_type>]' };
  }

  return {
    usage: fullUsage(command),
  };
}

function structuredCommanderMessage(error: CommanderError, command: Command | null): { code: string; message: string } {
  switch (error.code) {
    case 'commander.unknownCommand':
      return {
        code: 'unknown_command',
        message: error.message.replace(/^error: /i, ''),
      };
    case 'commander.unknownOption':
      return {
        code: 'unknown_option',
        message: error.message.replace(/^error: /i, ''),
      };
    case 'commander.excessArguments':
      return {
        code: 'invalid_args',
        message: command ? `Too many positional arguments for asp ${commandPath(command)}.` : 'Too many positional arguments.',
      };
    case 'commander.optionMissingArgument':
    case 'commander.missingArgument':
    case 'commander.invalidArgument':
      return {
        code: 'invalid_args',
        message: error.message.replace(/^error: /i, ''),
      };
    default:
      return {
        code: 'command_error',
        message: error.message.replace(/^error: /i, ''),
      };
  }
}

export function outputCliError(opts: CliErrorOptions, json: boolean): void {
  if (json) {
    const envelope: CliJsonErrorEnvelope = {
      ok: false,
      error: {
        code: opts.code,
        message: opts.message,
        ...(opts.command ? { command: opts.command } : {}),
        ...(opts.usage ? { usage: opts.usage } : {}),
        ...(opts.hint ? { hint: opts.hint } : {}),
        ...(opts.details ? { details: opts.details } : {}),
      },
    };
    output(envelope, true);
    return;
  }

  output(opts.human ?? opts.message, false);
}

export function buildCommanderJsonError(error: CommanderError, argv: string[], root: Command): CliJsonErrorEnvelope {
  const command = findCommandForArgv(root, argv);
  const base = structuredCommanderMessage(error, command);
  const guidance = commandSpecificHint(command, error);

  return {
    ok: false,
    error: {
      code: base.code,
      message: base.message,
      ...(command ? { command: `asp ${commandPath(command)}` } : {}),
      ...(guidance.usage ? { usage: guidance.usage } : {}),
      ...(guidance.hint ? { hint: guidance.hint } : {}),
      details: {
        raw: error.message,
      },
    },
  };
}
