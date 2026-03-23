import { Command } from 'commander';
import { createServer } from 'node:http';
import { storeInitialized } from '../store/index.js';
import { FileStore } from '../lib/store.js';
import { createASPHandler } from '../lib/handler.js';

export const serveCommand = new Command('serve')
  .description('Start the ASP server to serve your endpoint')
  .option('--port <port>', 'Port to listen on', '3000')
  .action(async (opts) => {
    if (!storeInitialized()) {
      console.error('Not initialized. Run `asp init` first.');
      process.exitCode = 1;
      return;
    }

    const port = parseInt(opts.port, 10);
    const handler = createASPHandler(new FileStore());

    const server = createServer((req, res) => handler(req, res));

    server.listen(port, () => {
      console.log(`ASP server running on http://localhost:${port}`);
      console.log(`  Manifest:     http://localhost:${port}/.well-known/asp.yaml`);
      console.log(`  WebFinger:    http://localhost:${port}/.well-known/webfinger?resource=acct:<handle>@localhost:${port}`);
      console.log(`  Feed:         http://localhost:${port}/asp/feed`);
      console.log(`  Inbox:        http://localhost:${port}/asp/inbox`);
      console.log(`  Reputation:   http://localhost:${port}/asp/reputation`);
    });
  });
