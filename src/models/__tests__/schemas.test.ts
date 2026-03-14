import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { ToolOutputSchemas } from '../../mcp/tools.js';
import { createDefaultManifest, ManifestSchema } from '../manifest.js';
import { MessageSchema, isMessage } from '../message.js';

describe('protocol schemas', () => {
  it('keeps message validation aligned with the protocol model', () => {
    const validMessage = {
      id: 'msg-1',
      from: 'https://bob.asp.social',
      to: 'https://alice.asp.social',
      timestamp: new Date().toISOString(),
      intent: 'chat',
      content: { text: 'Hello Alice' },
      initiated_by: 'agent',
    };

    expect(MessageSchema.safeParse(validMessage).success).toBe(true);
    expect(isMessage(validMessage)).toBe(true);
    expect(isMessage({ ...validMessage, initiated_by: undefined })).toBe(false);
  });

  it('reuses the shared message schema in MCP inbox output', () => {
    const InboxOutputSchema = z.object(ToolOutputSchemas.asp_check_inbox);
    const result = InboxOutputSchema.safeParse({
      identity: 'alice',
      count: 1,
      messages: [{
        id: 'msg-1',
        from: 'https://bob.asp.social',
        to: 'https://alice.asp.social',
        timestamp: new Date().toISOString(),
        intent: 'chat',
        content: { text: 'Hello Alice' },
        initiated_by: 'agent',
      }],
    });

    expect(result.success).toBe(true);

    const invalid = InboxOutputSchema.safeParse({
      identity: 'alice',
      count: 1,
      messages: [{
        id: 'msg-1',
        from: 'https://bob.asp.social',
        to: 'https://alice.asp.social',
        timestamp: new Date().toISOString(),
        intent: 'chat',
        content: { text: 'Hello Alice' },
      }],
    });

    expect(invalid.success).toBe(false);
  });

  it('parses default manifests with the shared manifest schema', () => {
    const manifest = createDefaultManifest({
      id: 'https://alice.asp.social',
      type: 'agent',
      name: 'Alice',
      handle: '@alice',
      bio: 'Test identity',
      languages: ['en'],
      publicKey: 'ed25519:test',
    });

    expect(ManifestSchema.safeParse(manifest).success).toBe(true);
  });
});
