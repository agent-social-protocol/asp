import { Command } from 'commander';
import { getStorePaths, storeInitialized } from '../store/index.js';
import { readManifest } from '../store/manifest-store.js';
import { readInbox, addMessage } from '../store/inbox-store.js';
import { sendMessage } from '../utils/send-message.js';
import { generateMessageId } from '../utils/id.js';
import { output } from '../utils/output.js';
import { isHosted, buildAuthHeader } from '../utils/remote-auth.js';
import { getRecipientEncryptionKey, encryptMessageContent, isEncryptedMessage, decryptMessageContent } from '../utils/encrypt-message.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Message } from '../models/message.js';
import { signPayload } from '../utils/crypto.js';
import { resolveEndpoint } from '../identity/resolve-target.js';
import { buildEndpointPath, buildEndpointUrl } from '../utils/endpoint-url.js';

export const messageCommand = new Command('message')
  .description('Send a message to another agent')
  .argument('<target>', 'Target (@handle, domain, or URL)')
  .option('--intent <intent>', 'Message intent (open string: inform, invite, negotiate, accept, counter, reject, ...)', 'inform')
  .option('--text <text>', 'Message text')
  .option('--data <json>', 'Structured payload as JSON string')
  .option('--attachment <url>', 'Attachment URL (repeatable)', (val: string, list: string[]) => [...list, val], [] as string[])
  .option('--reply-to <id>', 'Reply to a message ID (enables threading)')
  .option('--thread <id>', 'Thread ID (auto-set from reply-to if omitted)')
  .action(async (targetUrl, opts, cmd) => {
    const json = cmd.optsWithGlobals().json;
    try {
      targetUrl = await resolveEndpoint(targetUrl);
    } catch (err) {
      output(json ? { error: (err as Error).message } : (err as Error).message, json);
      process.exitCode = 1;
      return;
    }

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    if (!opts.text) {
      output(json ? { error: 'No text provided' } : 'Provide message text with --text.', json);
      process.exitCode = 1;
      return;
    }

    const manifest = await readManifest();
    const fromId = manifest?.entity?.id || 'local';

    let data: Record<string, unknown> | undefined;
    if (opts.data) {
      try {
        data = JSON.parse(opts.data);
      } catch {
        output(json ? { error: 'Invalid JSON in --data' } : 'Invalid JSON in --data.', json);
        process.exitCode = 1;
        return;
      }
    }

    const attachments = (opts.attachment as string[]).length > 0
      ? (opts.attachment as string[]).map((url: string) => ({ type: 'url', url }))
      : undefined;

    const message: Message = {
      id: generateMessageId(),
      from: fromId,
      to: targetUrl,
      timestamp: new Date().toISOString(),
      intent: opts.intent,
      content: {
        text: opts.text,
        ...(data && { data }),
        ...(attachments && { attachments }),
      },
      initiated_by: 'human',
      ...(opts.replyTo && { reply_to: opts.replyTo }),
      ...(opts.thread && { thread_id: opts.thread }),
    };

    // Sign message metadata if private key available
    const { privateKeyPath } = getStorePaths();
    if (existsSync(privateKeyPath)) {
      const privateKey = await readFile(privateKeyPath, 'utf-8');
      const sigPayload = `${message.id}:${fromId}:${targetUrl}:${message.intent}:${message.timestamp}`;
      message.signature = signPayload(sigPayload, privateKey);
    }

    // Save plaintext copy locally
    await addMessage(message);

    // Encrypt if recipient supports it
    let toSend = message;
    const encryption = await getRecipientEncryptionKey(targetUrl);
    if (encryption.status === 'supported') {
      toSend = encryptMessageContent(message, encryption.key);
    } else if (encryption.status === 'error') {
      const warning = `Could not determine recipient encryption support: ${encryption.error}`;
      if (json) {
        output({ status: 'saved_locally', warning, message }, true);
      } else {
        console.log(`Message saved locally (${warning})`);
      }
      return;
    }

    // Send to target
    const result = await sendMessage(targetUrl, toSend);
    if (!result.ok) {
      if (json) {
        output({ status: 'saved_locally', warning: `Could not deliver: ${result.error}`, message }, true);
      } else {
        console.log(`Message saved locally (could not deliver: ${result.error})`);
      }
      return;
    }

    if (json) {
      output({ status: 'sent', message }, true);
    } else {
      console.log(`Message sent to ${targetUrl}`);
      console.log(`  ID:     ${message.id}`);
      console.log(`  Intent: ${message.intent}`);
    }
  });

export const inboxCommand = new Command('inbox')
  .description('View received messages')
  .option('--thread <id>', 'Filter by thread ID')
  .option('--intent <intent>', 'Filter by intent')
  .action(async (opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    let messages: Message[];

    if (await isHosted()) {
      const manifest = await readManifest();
      if (!manifest) {
        output(json ? { error: 'Manifest not found' } : 'Manifest not found.', json);
        process.exitCode = 1;
        return;
      }
      const endpoint = manifest.entity.id;
      const inboxUrl = buildEndpointUrl(endpoint, '/asp/inbox');
      const auth = await buildAuthHeader('GET', buildEndpointPath(endpoint, '/asp/inbox'));
      const params = new URLSearchParams();
      if (opts.thread) params.set('thread', opts.thread);
      const qs = params.toString();
      if (qs) {
        inboxUrl.search = qs;
      }
      const res = await fetch(inboxUrl.toString(), {
        headers: { Authorization: auth },
      });
      if (!res.ok) {
        output(json ? { error: `Hub returned ${res.status}` } : `Could not fetch inbox (HTTP ${res.status})`, json);
        process.exitCode = 1;
        return;
      }
      const data = await res.json() as { messages: Message[] };
      messages = data.messages;
      if (opts.intent) {
        messages = messages.filter(m => m.intent === opts.intent);
      }
    } else {
      const inbox = await readInbox();
      messages = inbox.messages;
      if (opts.thread) {
        messages = messages.filter(m => m.thread_id === opts.thread);
      }
      if (opts.intent) {
        messages = messages.filter(m => m.intent === opts.intent);
      }
    }

    // Decrypt encrypted messages if we have the key
    const { encryptionKeyPath } = getStorePaths();
    if (existsSync(encryptionKeyPath)) {
      const encPrivKey = await readFile(encryptionKeyPath, 'utf-8');
      messages = messages.map(m => {
        if (isEncryptedMessage(m)) {
          try { return decryptMessageContent(m, encPrivKey); } catch { return m; }
        }
        return m;
      });
    }

    if (json) {
      output({ messages }, true);
      return;
    }

    if (messages.length === 0) {
      console.log('No messages.');
      return;
    }

    console.log(`${messages.length} message(s):\n`);
    for (const m of messages) {
      console.log(`  [${m.intent}] ${m.from}`);
      console.log(`    ID:   ${m.id}`);
      console.log(`    Text: ${m.content.text}`);
      if (m.reply_to) {
        console.log(`    Reply to: ${m.reply_to}`);
      }
      console.log(`    Time: ${m.timestamp}`);
    }
  });
