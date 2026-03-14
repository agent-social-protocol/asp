import { fetchManifest } from './verify-identity.js';
import { eciesEncrypt, eciesDecrypt } from './crypto.js';
import type { EncryptedPayload } from './crypto.js';
import type { Message } from '../models/message.js';

function isEncryptedPayload(v: unknown): v is EncryptedPayload {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return p.v === 1 &&
    typeof p.eph === 'string' &&
    typeof p.nonce === 'string' &&
    typeof p.ciphertext === 'string' &&
    typeof p.tag === 'string';
}

/**
 * Fetch a recipient's X25519 encryption key from their manifest.
 * Returns null if the recipient doesn't support encrypted DMs.
 */
export async function getRecipientEncryptionKey(targetUrl: string): Promise<string | null> {
  const manifest = await fetchManifest(targetUrl);
  return manifest?.verification?.encryption_key ?? null;
}

/**
 * Check if a message is encrypted (has the "[encrypted]" marker).
 */
export function isEncryptedMessage(message: Message): boolean {
  return message.content.text === '[encrypted]' && !!message.content.data?.encrypted;
}

/**
 * Encrypt a message's content for a recipient.
 * Returns a new Message with content replaced by encrypted payload.
 * The original message is NOT modified.
 */
export function encryptMessageContent(message: Message, recipientEncKey: string): Message {
  const plaintext = JSON.stringify(message.content);
  const payload = eciesEncrypt(plaintext, recipientEncKey);
  return {
    ...message,
    content: {
      text: '[encrypted]',
      data: { encrypted: payload },
    },
  };
}

/**
 * Decrypt an encrypted message's content.
 * Returns a new Message with the original content restored.
 * Throws if decryption fails (wrong key, tampered data).
 */
export function decryptMessageContent(message: Message, encPrivKeyPem: string): Message {
  const raw = message.content.data?.encrypted;
  if (!isEncryptedPayload(raw)) throw new Error('Not an encrypted message or malformed payload');
  const payload = raw;
  const plaintext = eciesDecrypt(payload, encPrivKeyPem);
  const content = JSON.parse(plaintext) as Message['content'];
  return {
    ...message,
    content,
  };
}
