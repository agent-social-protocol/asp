import { Command } from 'commander';
import { createServer } from 'node:http';
import yaml from 'js-yaml';
import { storeInitialized } from '../store/index.js';
import { readManifest } from '../store/manifest-store.js';
import { readFeed } from '../store/feed-store.js';
import { addReceivedInteraction } from '../store/interaction-store.js';
import { isInteraction } from '../models/interaction.js';
import { isMessage } from '../models/message.js';
import { addMessage } from '../store/inbox-store.js';
import { readReputationRecords } from '../store/reputation-store.js';
import { renderProfilePage } from '../utils/render-html.js';
import { buildAccountIdentifier, buildWebFingerResponse, parseWebFingerResource } from '../utils/webfinger.js';

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

    const server = createServer(async (req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const host = req.headers.host || `localhost:${port}`;
      const url = new URL(req.url || '/', `http://${host}`);
      const accept = req.headers.accept || '';
      const wantsHtml = accept.includes('text/html');
      const wantsJson = accept.includes('application/json');

      try {
        // GET / — Profile page for browsers, redirect for agents
        if (req.method === 'GET' && url.pathname === '/') {
          if (wantsHtml) {
            const manifest = await readManifest();
            if (!manifest) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Manifest not found');
              return;
            }
            const entries = await readFeed();
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(renderProfilePage(manifest, entries));
          } else {
            res.writeHead(302, { Location: '/.well-known/asp.yaml' });
            res.end();
          }
          return;
        }

        if (req.method === 'GET' && url.pathname === '/.well-known/webfinger') {
          const manifest = await readManifest();
          if (!manifest) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Manifest not found' }));
            return;
          }

          const resource = parseWebFingerResource(url.searchParams.get('resource'));
          if (!resource) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid or missing resource' }));
            return;
          }

          const account = buildAccountIdentifier(manifest.entity.handle, url.host);
          if (resource.account !== account) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Account not found' }));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/jrd+json' });
          res.end(JSON.stringify(buildWebFingerResponse({
            account,
            endpoint: manifest.entity.id,
            profileUrl: manifest.entity.id,
          }), null, 2));
          return;
        }

        // GET /.well-known/asp.yaml — Serve manifest
        if (req.method === 'GET' && url.pathname === '/.well-known/asp.yaml') {
          const manifest = await readManifest();
          if (wantsHtml) {
            if (!manifest) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Manifest not found');
              return;
            }
            const entries = await readFeed();
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(renderProfilePage(manifest, entries));
          } else if (!manifest) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Manifest not found' }));
          } else if (wantsJson) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(manifest, null, 2));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/yaml' });
            res.end(yaml.dump(manifest));
          }
          return;
        }

        // GET /asp/feed — Serve feed
        if (req.method === 'GET' && url.pathname === '/asp/feed') {
          let entries = await readFeed();

          const since = url.searchParams.get('since');
          if (since) {
            const sinceDate = new Date(since).getTime();
            entries = entries.filter((e) => new Date(e.published).getTime() >= sinceDate);
          }

          const topic = url.searchParams.get('topic');
          if (topic) {
            entries = entries.filter((e) => e.topics?.includes(topic));
          }

          if (wantsHtml) {
            const manifest = await readManifest();
            if (!manifest) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Manifest not found');
              return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(renderProfilePage(manifest, entries));
          } else if (wantsJson) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ entries }, null, 2));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/yaml' });
            res.end(yaml.dump({ entries }));
          }
          return;
        }

        // POST /asp/interactions — Accept incoming interactions
        if (req.method === 'POST' && url.pathname === '/asp/interactions') {
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of req) {
            total += (chunk as Buffer).length;
            if (total > 65536) {
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Payload too large' }));
              return;
            }
            chunks.push(chunk as Buffer);
          }
          const body = Buffer.concat(chunks).toString('utf-8');
          const contentType = req.headers['content-type'] || '';

          let interaction: unknown;
          try {
            interaction = contentType.includes('json') ? JSON.parse(body) : yaml.load(body);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Could not parse request body' }));
            return;
          }

          if (!isInteraction(interaction)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid interaction format' }));
            return;
          }

          await addReceivedInteraction(interaction);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'received' }));
          return;
        }

        // POST /asp/inbox — Receive messages
        if (req.method === 'POST' && url.pathname === '/asp/inbox') {
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of req) {
            total += (chunk as Buffer).length;
            if (total > 65536) {
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Payload too large' }));
              return;
            }
            chunks.push(chunk as Buffer);
          }
          const body = Buffer.concat(chunks).toString('utf-8');
          const contentType = req.headers['content-type'] || '';

          let parsed: unknown;
          try {
            parsed = contentType.includes('json') ? JSON.parse(body) : yaml.load(body);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Could not parse request body' }));
            return;
          }

          if (!isMessage(parsed)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid message format' }));
            return;
          }

          await addMessage(parsed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'received' }));
          return;
        }

        // GET /asp/reputation — Serve public reputation info
        if (req.method === 'GET' && url.pathname === '/asp/reputation') {
          const manifest = await readManifest();
          if (!manifest) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Manifest not found' }));
            return;
          }
          const records = await readReputationRecords();

          const data = {
            entity_id: manifest.entity.id,
            active_since: manifest.entity.created_at,
            capabilities: manifest.capabilities,
            records,
          };

          if (wantsJson) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data, null, 2));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/yaml' });
            res.end(yaml.dump(data));
          }
          return;
        }

        // 404
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });

    server.listen(port, () => {
      console.log(`ASP server running on http://localhost:${port}`);
      console.log(`  Manifest:     http://localhost:${port}/.well-known/asp.yaml`);
      console.log(`  WebFinger:    http://localhost:${port}/.well-known/webfinger?resource=acct:<handle>@localhost:${port}`);
      console.log(`  Feed:         http://localhost:${port}/asp/feed`);
      console.log(`  Interactions: POST http://localhost:${port}/asp/interactions`);
      console.log(`  Inbox:        POST http://localhost:${port}/asp/inbox`);
      console.log(`  Reputation:   http://localhost:${port}/asp/reputation`);
    });
  });
