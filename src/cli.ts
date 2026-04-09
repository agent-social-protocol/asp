import { Command } from 'commander';
import { getCliRuntimeConfig } from './config/cli.js';
import { configureStoreDefaults } from './store/index.js';
import { readPackageVersion } from './utils/package-version.js';

const version = readPackageVersion(import.meta.url);
import { initCommand } from './commands/init.js';
import { publishCommand } from './commands/publish.js';
import { feedCommand } from './commands/feed.js';
import { followCommand, unfollowCommand, followingCommand } from './commands/follow.js';
import { interactCommand } from './commands/interact.js';
import { serveCommand } from './commands/serve.js';
import { notificationsCommand } from './commands/notifications.js';
import { messageCommand, inboxCommand } from './commands/message.js';
import { reputationCommand, trustQueryCommand } from './commands/reputation.js';
import { relationshipListCommand, relationshipAddCommand, relationshipRemoveCommand } from './commands/relationship.js';
import { configCommand } from './commands/config.js';
import { statusCommand } from './commands/status.js';
import { whoisCommand } from './commands/whois.js';
import { guideCommand } from './commands/guide.js';
import { capabilitiesCommand } from './commands/capabilities.js';
import { editCommand } from './commands/edit.js';
import { deleteCommand } from './commands/delete.js';
import { indexCommand } from './commands/index-cmd.js';
import { identityCommand } from './commands/identity.js';
import { toolsCommand } from './commands/tools.js';
import { watchCommand } from './commands/watch.js';

configureStoreDefaults({ storeDir: getCliRuntimeConfig().storeDir });

export const program = new Command();

program
  .name('asp')
  .description('Agent Social Protocol — command-line tool for ASP identity, feed, inbox, interactions, and discovery')
  .version(version)
  .option('--json', 'Output in JSON format');

program.addCommand(initCommand);
program.addCommand(publishCommand);
program.addCommand(feedCommand);
program.addCommand(followCommand);
program.addCommand(unfollowCommand);
program.addCommand(followingCommand);
program.addCommand(interactCommand);
program.addCommand(serveCommand);
program.addCommand(notificationsCommand);
program.addCommand(messageCommand);
program.addCommand(inboxCommand);
program.addCommand(reputationCommand);
program.addCommand(trustQueryCommand);
program.addCommand(relationshipListCommand);
program.addCommand(relationshipAddCommand);
program.addCommand(relationshipRemoveCommand);
program.addCommand(editCommand);
program.addCommand(deleteCommand);
program.addCommand(configCommand);
program.addCommand(statusCommand);
program.addCommand(whoisCommand);
program.addCommand(guideCommand);
program.addCommand(capabilitiesCommand);
program.addCommand(indexCommand);
program.addCommand(identityCommand);
program.addCommand(toolsCommand);
program.addCommand(watchCommand);
