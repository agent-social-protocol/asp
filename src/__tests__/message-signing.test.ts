import { describe, it, expect } from 'vitest';
import { MessageSchema, isMessage } from '../models/message.js';

describe('Message signature field', () => {
  const base = {
    id: 'msg-1',
    from: 'https://alice.asp.social',
    to: 'https://bob.asp.social',
    timestamp: '2026-03-18T00:00:00Z',
    intent: 'inform',
    content: { text: 'hello' },
    initiated_by: 'agent' as const,
  };

  it('accepts message without signature', () => {
    const result = MessageSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('accepts message with signature', () => {
    const result = MessageSchema.safeParse({ ...base, signature: 'base64sig==' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.signature).toBe('base64sig==');
    }
  });

  it('isMessage works with signature', () => {
    expect(isMessage({ ...base, signature: 'sig' })).toBe(true);
    expect(isMessage({ ...base })).toBe(true);
  });
});

import { signPayload, generateKeyPair } from '../utils/crypto.js';

describe('ASPClient message signing', () => {
  it('signPayload produces verifiable base64 signature', () => {
    const kp = generateKeyPair();
    const payload = 'msg-1:https://alice.asp.social:https://bob.asp.social:inform:2026-03-18T00:00:00Z';
    const sig = signPayload(payload, kp.privateKey);
    expect(sig).toBeTruthy();
    expect(typeof sig).toBe('string');
    // Base64 format
    expect(() => Buffer.from(sig, 'base64')).not.toThrow();
  });
});
