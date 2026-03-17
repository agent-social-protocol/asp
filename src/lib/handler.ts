import type { IncomingMessage, ServerResponse } from 'node:http';
import yaml from 'js-yaml';
import type { ASPStore } from './store.js';
import type { Interaction } from '../models/interaction.js';
import type { Message } from '../models/message.js';
import { isInteraction } from '../models/interaction.js';
import { isMessage } from '../models/message.js';
import { renderProfilePage } from '../utils/render-html.js';
import { buildAccountIdentifier, buildWebFingerResponse, parseWebFingerResource } from '../utils/webfinger.js';

const DEFAULT_MAX_BODY_SIZE = 65536; // 64 KB
const DEFAULT_FEED_LIMIT = 50;

export interface ASPHandlerOptions {
  feedLimit?: number;
  maxBodySize?: number;
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error('Payload too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function parseBody(body: string, contentType: string): unknown {
  return contentType.includes('json') ? JSON.parse(body) : yaml.load(body);
}

function respond(res: ServerResponse, status: number, data: unknown, wantsJson: boolean): void {
  if (wantsJson) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  } else {
    res.writeHead(status, { 'Content-Type': 'application/yaml' });
    res.end(yaml.dump(data));
  }
}

function jsonError(res: ServerResponse, status: number, error: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error }));
}

function jrdResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/jrd+json' });
  res.end(JSON.stringify(data, null, 2));
}

export interface ASPHandlerCallbacks {
  onMessage?: (msg: Message) => void;
  onInteraction?: (interaction: Interaction) => void;
}

/**
 * Creates the minimal public ASP reference handler.
 * It intentionally covers only local-store protocol routes, not hosted Hub behavior.
 */
export function createASPHandler(
  store: ASPStore,
  callbacks?: ASPHandlerCallbacks,
  options?: ASPHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const maxFeedLimit = options?.feedLimit ?? DEFAULT_FEED_LIMIT;
  const maxBodySize = options?.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
  return async (req: IncomingMessage, res: ServerResponse) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const accept = req.headers.accept || '';
    const wantsHtml = accept.includes('text/html');
    const wantsJson = accept.includes('application/json');

    try {
      // GET / — Profile page for browsers, redirect for agents
      if (req.method === 'GET' && url.pathname === '/') {
        if (wantsHtml) {
          const manifest = await store.get('manifest');
          if (!manifest) {
            jsonError(res, 500, 'Manifest not found');
            return;
          }
          const entries = await store.get('feed');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderProfilePage(manifest, entries));
        } else {
          res.writeHead(302, { Location: '/.well-known/asp.yaml' });
          res.end();
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/.well-known/webfinger') {
        const manifest = await store.get('manifest');
        if (!manifest) {
          jsonError(res, 500, 'Manifest not found');
          return;
        }

        const resource = parseWebFingerResource(url.searchParams.get('resource'));
        if (!resource) {
          jsonError(res, 400, 'Invalid or missing resource');
          return;
        }

        const account = buildAccountIdentifier(manifest.entity.handle, url.host);
        if (resource.account !== account) {
          jsonError(res, 404, 'Account not found');
          return;
        }

        jrdResponse(res, 200, buildWebFingerResponse({
          account,
          endpoint: manifest.entity.id,
          profileUrl: manifest.entity.id,
        }));
        return;
      }

      // GET /.well-known/asp.yaml — Serve manifest
      if (req.method === 'GET' && url.pathname === '/.well-known/asp.yaml') {
        const manifest = await store.get('manifest');
        if (!manifest) {
          jsonError(res, 500, 'Manifest not found');
          return;
        }
        if (wantsHtml) {
          const entries = await store.get('feed');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderProfilePage(manifest, entries));
        } else {
          respond(res, 200, manifest, wantsJson);
        }
        return;
      }

      // GET /asp/feed — Serve feed
      if (req.method === 'GET' && url.pathname === '/asp/feed') {
        let entries = await store.get('feed');

        const since = url.searchParams.get('since');
        if (since) {
          const sinceDate = new Date(since).getTime();
          entries = entries.filter((e) => new Date(e.published).getTime() >= sinceDate);
        }

        const topic = url.searchParams.get('topic');
        if (topic) {
          entries = entries.filter((e) => e.topics?.includes(topic));
        }

        const signalType = url.searchParams.get('signal_type');
        if (signalType) {
          entries = entries.filter((e) => e.signal_type === signalType);
        }

        const limitParam = url.searchParams.get('limit');
        const limit = limitParam ? Math.max(1, Math.min(parseInt(limitParam, 10) || maxFeedLimit, maxFeedLimit)) : maxFeedLimit;
        entries = entries.slice(0, limit);

        if (wantsHtml) {
          const manifest = await store.get('manifest');
          if (!manifest) {
            jsonError(res, 500, 'Manifest not found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderProfilePage(manifest, entries));
        } else {
          respond(res, 200, { entries }, wantsJson);
        }
        return;
      }

      // POST /asp/interactions — Accept incoming interactions
      if (req.method === 'POST' && url.pathname === '/asp/interactions') {
        const body = await readBody(req, maxBodySize);
        const contentType = req.headers['content-type'] || '';

        let parsed: unknown;
        try {
          parsed = parseBody(body, contentType);
        } catch {
          jsonError(res, 400, 'Could not parse request body');
          return;
        }

        if (!isInteraction(parsed)) {
          jsonError(res, 400, 'Invalid interaction format');
          return;
        }

        const interactions = await store.get('interactions');
        interactions.received.push(parsed);
        await store.set('interactions', interactions);

        callbacks?.onInteraction?.(parsed);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'received' }));
        return;
      }

      // POST /asp/inbox — Receive messages
      if (req.method === 'POST' && url.pathname === '/asp/inbox') {
        const body = await readBody(req, maxBodySize);
        const contentType = req.headers['content-type'] || '';

        let parsed: unknown;
        try {
          parsed = parseBody(body, contentType);
        } catch {
          jsonError(res, 400, 'Could not parse request body');
          return;
        }

        if (!isMessage(parsed)) {
          jsonError(res, 400, 'Invalid message format');
          return;
        }

        const inbox = await store.get('inbox');
        inbox.push(parsed);
        await store.set('inbox', inbox);

        callbacks?.onMessage?.(parsed);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'received' }));
        return;
      }

      // GET /asp/reputation — Serve reputation records
      if (req.method === 'GET' && url.pathname === '/asp/reputation') {
        const manifest = await store.get('manifest');
        if (!manifest) {
          jsonError(res, 500, 'Manifest not found');
          return;
        }
        const records = await store.get('reputation');

        const data = {
          entity_id: manifest.entity.id,
          active_since: manifest.entity.created_at,
          capabilities: manifest.capabilities,
          records,
        };

        respond(res, 200, data, wantsJson);
        return;
      }

      // 404
      jsonError(res, 404, 'Not found');
    } catch (err) {
      const message = (err as Error).message;
      const status = message === 'Payload too large' ? 413 : 500;
      jsonError(res, status, message);
    }
  };
}
