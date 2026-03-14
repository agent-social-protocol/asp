import { Command } from 'commander';
import { output } from '../utils/output.js';
import {
  SUPPORTED_AGENT_FRAMEWORK_TARGETS,
  describeDetectedAgentFrameworks,
  installASPTools,
  type AgentFrameworkTarget,
} from '../hosted/onboarding.js';

const TARGET_LABELS: Record<AgentFrameworkTarget, string> = {
  claude: 'Claude Code',
  cursor: 'Cursor',
  vscode: 'VS Code',
  openclaw: 'OpenClaw',
};

function isAgentFrameworkTarget(value: string): value is AgentFrameworkTarget {
  return (SUPPORTED_AGENT_FRAMEWORK_TARGETS as readonly string[]).includes(value);
}

export const toolsCommand = new Command('tools')
  .description('Manage ASP tools for supported agent runtimes');

toolsCommand
  .command('install [target]')
  .description('Configure ASP tools for detected agent runtimes')
  .option('--all', 'Configure all detected runtimes')
  .action(async (target, opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (target && opts.all) {
      output(
        json
          ? { error: 'Choose either a target or --all' }
          : 'Choose either a specific target or `--all`.',
        json,
      );
      process.exitCode = 1;
      return;
    }

    if (target && !isAgentFrameworkTarget(target)) {
      const validTargets = SUPPORTED_AGENT_FRAMEWORK_TARGETS.join(', ');
      output(
        json
          ? { error: 'Unknown target', target, valid_targets: SUPPORTED_AGENT_FRAMEWORK_TARGETS }
          : `Unknown target \`${target}\`. Use one of: ${validTargets}.`,
        json,
      );
      process.exitCode = 1;
      return;
    }

    const requestedTarget = (opts.all ? 'all' : (target ?? 'all')) as AgentFrameworkTarget | 'all';
    const result = installASPTools(requestedTarget);

    if (result.detected.length === 0) {
      output(
        json
          ? { error: 'No supported agent runtimes detected', supported_targets: SUPPORTED_AGENT_FRAMEWORK_TARGETS }
          : 'No supported agent runtimes detected. ASP tools currently support Claude Code, Cursor, VS Code, and OpenClaw.',
        json,
      );
      process.exitCode = 1;
      return;
    }

    if (requestedTarget !== 'all' && result.results.length === 0) {
      const detectedNames = describeDetectedAgentFrameworks(result.detected);
      output(
        json
          ? { error: 'Requested runtime not detected', target: requestedTarget, detected: result.detected }
          : `${TARGET_LABELS[requestedTarget]} was not detected. Detected runtimes: ${detectedNames}.`,
        json,
      );
      process.exitCode = 1;
      return;
    }

    if (json) {
      output({ status: 'configured', target: requestedTarget, detected: result.detected, results: result.results }, true);
      return;
    }

    for (const framework of result.results) {
      if (framework.ok) {
        console.log(`Configured ASP tools for ${framework.name}.`);
      } else {
        console.log(`Failed to configure ASP tools for ${framework.name}.`);
      }
    }

    if (result.results.some((framework) => framework.ok)) {
      console.log('ASP tools are now available to your configured agent runtimes.');
    } else {
      process.exitCode = 1;
    }
  });
