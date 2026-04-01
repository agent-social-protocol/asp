import { Command, InvalidArgumentError } from 'commander';
import { storeInitialized } from '../store/index.js';
import { output } from '../utils/output.js';
import { getInboxWatchStatus, readInboxWatchRecent, startInboxWatchDaemon, stopInboxWatchDaemon } from '../runtime/watch-control.js';
import { runInboxWatcher } from '../runtime/watch-runner.js';
import { summarizeInboxEntry } from '../utils/inbox-display.js';

function parseRecentLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('Recent limit must be a positive integer.');
  }
  return parsed;
}

function requireInitialized(json: boolean): boolean {
  if (storeInitialized()) {
    return true;
  }

  output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
  process.exitCode = 1;
  return false;
}

const watchStartCommand = new Command('start')
  .description('Start the background inbox watcher')
  .action(async (_opts, cmd) => {
    const json = cmd.optsWithGlobals().json;
    if (!requireInitialized(json)) {
      return;
    }

    try {
      const result = await startInboxWatchDaemon({
        cliScriptPath: process.argv[1],
        env: process.env,
      });

      if (json) {
        output(result, true);
        return;
      }

      if (result.status === 'already_running') {
        console.log(`Inbox watcher already running (pid ${result.state.pid}, mode ${result.state.mode}).`);
        return;
      }

      console.log(`Started inbox watcher (pid ${result.pid}, mode ${result.mode}).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output(json ? { error: message } : message, json);
      process.exitCode = 1;
    }
  });

const watchStatusCommand = new Command('status')
  .description('Show inbox watcher status')
  .action(async (_opts, cmd) => {
    const json = cmd.optsWithGlobals().json;
    if (!requireInitialized(json)) {
      return;
    }

    try {
      const status = await getInboxWatchStatus();
      if (json) {
        output(status, true);
        return;
      }

      console.log(`Inbox watcher: ${status.status}`);
      console.log(`  Running:    ${status.running ? 'yes' : 'no'}`);
      console.log(`  PID:        ${status.pid ?? 'none'}`);
      console.log(`  Mode:       ${status.mode}`);
      console.log(`  Started:    ${status.started_at ?? 'never'}`);
      console.log(`  Updated:    ${status.updated_at}`);
      console.log(`  Last event: ${status.last_event_at ?? 'none'}`);
      console.log(`  Events:     ${status.event_count}`);
      if (status.last_entry_summary) {
        console.log(`  Last item:  ${status.last_entry_summary}`);
      }
      if (status.last_error) {
        console.log(`  Last error: ${status.last_error}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output(json ? { error: message } : message, json);
      process.exitCode = 1;
    }
  });

const watchRecentCommand = new Command('recent')
  .description('Show recent watcher-delivered inbox entries')
  .option('--limit <count>', 'How many recent entries to show', parseRecentLimit, 10)
  .action(async (opts, cmd) => {
    const json = cmd.optsWithGlobals().json;
    if (!requireInitialized(json)) {
      return;
    }

    try {
      const recent = await readInboxWatchRecent(opts.limit);
      if (json) {
        output({ events: recent }, true);
        return;
      }

      if (recent.length === 0) {
        console.log('No recent watcher events.');
        return;
      }

      for (const record of recent) {
        console.log(`- ${record.received_at} ${summarizeInboxEntry(record.entry)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output(json ? { error: message } : message, json);
      process.exitCode = 1;
    }
  });

const watchStopCommand = new Command('stop')
  .description('Stop the background inbox watcher')
  .action(async (_opts, cmd) => {
    const json = cmd.optsWithGlobals().json;
    if (!requireInitialized(json)) {
      return;
    }

    try {
      const result = await stopInboxWatchDaemon();
      if (json) {
        output(result, true);
        return;
      }

      if (result.status === 'not_running') {
        console.log('Inbox watcher is not running.');
        return;
      }

      console.log('Stopped inbox watcher.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output(json ? { error: message } : message, json);
      process.exitCode = 1;
    }
  });

const watchRunCommand = new Command('run')
  .description('Run the inbox watcher in the current process')
  .option('--daemon-child', 'Internal flag for daemonized watcher', false)
  .action(async (opts: { daemonChild?: boolean }, cmd: Command) => {
    const json = cmd.optsWithGlobals().json;
    if (!requireInitialized(json)) {
      return;
    }

    try {
      await runInboxWatcher({
        daemonChild: !!opts.daemonChild,
        quiet: json,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output(json ? { error: message } : message, json);
      process.exitCode = 1;
    }
  });

export const watchCommand = new Command('watch')
  .description('Keep a background inbox watcher connected and inspect its state');

watchCommand.addCommand(watchStartCommand);
watchCommand.addCommand(watchStatusCommand);
watchCommand.addCommand(watchRecentCommand);
watchCommand.addCommand(watchStopCommand);
watchCommand.addCommand(watchRunCommand);
