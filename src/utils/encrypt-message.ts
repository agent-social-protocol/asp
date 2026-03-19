import yaml from 'js-yaml';
import { eciesEncrypt, eciesDecrypt } from './crypto.js';
import type { EncryptedPayload } from './crypto.js';
import type { Message } from '../models/message.js';
import { isManifest } from '../models/manifest.js';
import { buildEndpointUrl } from './endpoint-url.js';
import { fetchWithTimeout } from './fetch-with-timeout.js';

export type RecipientEncryptionKeyResult =
  | { status: 'supported'; key: string }
  | { status: 'unsupported' }
  | { status: 'error'; error: string };

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
 * Returns an explicit status so callers can distinguish unsupported encryption
 * from manifest lookup failures.
 */
export async function getRecipientEncryptionKey(targetUrl: string): Promise<RecipientEncryptionKeyResult> {
  const manifestUrl = buildEndpointUrl(targetUrl, '/.well-known/asp.yaml');

  let res: Response;
  try {
    res = await fetchWithTimeout(manifestUrl.toString(), {
      headers: { Accept: 'application/yaml, application/json' },
    });
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (res.status === 404) {
    return { status: 'unsupported' };
  }
  if (!res.ok) {
    return {
      status: 'error',
      error: `HTTP ${res.status}`,
    };
  }

  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  let parsed: unknown;
  try {
    parsed = contentType.includes('json')
      ? JSON.parse(text)
      : yaml.load(text);
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Invalid manifest response',
    };
  }

  if (!isManifest(parsed)) {
    return { status: 'error', error: 'Invalid manifest format' };
  }

  const key = parsed.verification?.encryption_key;
  if (!key) {
    return { status: 'unsupported' };
  }

  return { status: 'supported', key };
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
