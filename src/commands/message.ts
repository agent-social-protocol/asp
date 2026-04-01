import { Command, InvalidArgumentError } from 'commander';
import { getStorePaths, storeInitialized } from '../store/index.js';
import { readManifest } from '../store/manifest-store.js';
import { addMessage } from '../store/inbox-store.js';
import { sendMessage } from '../utils/send-message.js';
import { generateMessageId } from '../utils/id.js';
import { output } from '../utils/output.js';
import { getRecipientEncryptionKey, encryptMessageContent, isEncryptedMessage, decryptMessageContent } from '../utils/encrypt-message.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Message } from '../models/message.js';
import { signPayload } from '../utils/crypto.js';
import { resolveEndpoint } from '../identity/resolve-target.js';
import { buildEndpointUrl } from '../utils/endpoint-url.js';
import { buildInboxEntrySignaturePayload, inboxEntryToMessage, messageToInboxEntry } from '../utils/inbox-entry.js';
import { getInboxEntryCursor, type InboxEntryKind } from '../models/inbox-entry.js';
import { inboxEntryToInteraction } from '../utils/inbox-entry.js';
import { summarizeInboxEntry } from '../utils/inbox-display.js';
import { readOwnInboxPage } from '../utils/own-inbox.js';

function parseInboxKind(kind: string): InboxEntryKind {
  if (kind === 'message' || kind === 'interaction') {
    return kind;
  }
  throw new InvalidArgumentError('Inbox kind must be "message" or "interaction".');
}

function parseInboxDirection(direction: string): 'sent' | 'received' {
  if (direction === 'sent' || direction === 'received') {
    return direction;
  }
  throw new InvalidArgumentError('Inbox direction must be "sent" or "received".');
}

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
      const sigPayload = buildInboxEntrySignaturePayload(messageToInboxEntry(message));
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
  .description('View inbox activity')
  .option('--thread <id>', 'Filter by thread ID')
  .option('--type <type>', 'Filter by inbox entry type')
  .option('--kind <kind>', 'Filter by inbox kind (message or interaction)', parseInboxKind)
  .option('--direction <direction>', 'Filter by direction (received or sent)', parseInboxDirection, 'received')
  .action(async (opts, cmd) => {
    const json = cmd.optsWithGlobals().json;

    if (!storeInitialized()) {
      output(json ? { error: 'Not initialized' } : 'Not initialized. Run `asp init` first.', json);
      process.exitCode = 1;
      return;
    }

    let inboxPage;
    try {
      inboxPage = await readOwnInboxPage({
        direction: opts.direction,
        thread: opts.thread,
        kind: opts.kind,
        type: opts.type,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output(json ? { error: message } : `Could not fetch inbox (${message})`, json);
      process.exitCode = 1;
      return;
    }

    let entries = inboxPage.entries;

    // Decrypt encrypted messages if we have the key
    const { encryptionKeyPath } = getStorePaths();
    if (existsSync(encryptionKeyPath)) {
      const encPrivKey = await readFile(encryptionKeyPath, 'utf-8');
      entries = entries.map((entry) => {
        const message = inboxEntryToMessage(entry);
        if (!message || !isEncryptedMessage(message)) {
          return entry;
        }
        try {
          return messageToInboxEntry(decryptMessageContent(message, encPrivKey));
        } catch {
          return entry;
        }
      });
    }

    const messages = entries
      .map(inboxEntryToMessage)
      .filter((entry): entry is Message => entry !== null);
    const interactions = entries
      .map(inboxEntryToInteraction)
      .filter((entry): entry is NonNullable<ReturnType<typeof inboxEntryToInteraction>> => entry !== null);

    if (json) {
      output({
        entries,
        messages,
        interactions,
        next_cursor: inboxPage.nextCursor,
      }, true);
      return;
    }

    if (entries.length === 0) {
      console.log('No inbox entries.');
      return;
    }

    const orderedEntries = [...entries].sort((a, b) => getInboxEntryCursor(b).localeCompare(getInboxEntryCursor(a)));

    console.log(`${orderedEntries.length} inbox entr${orderedEntries.length === 1 ? 'y' : 'ies'}:\n`);
    for (const entry of orderedEntries) {
      console.log(`  [${entry.type}] ${summarizeInboxEntry(entry)}`);
      console.log(`    ID:   ${entry.id}`);
      console.log(`    From: ${entry.from}`);
      if (entry.kind === 'message') {
        if (entry.thread_id) {
          console.log(`    Thread: ${entry.thread_id}`);
        }
        if (entry.reply_to) {
          console.log(`    Reply to: ${entry.reply_to}`);
        }
      } else if (entry.target) {
        console.log(`    Target: ${entry.target}`);
      }
      console.log(`    Time: ${getInboxEntryCursor(entry)}`);
    }
  });
