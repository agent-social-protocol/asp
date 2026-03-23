import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { ToolOutputSchemas } from '../../mcp/tools.js';
import { createDefaultManifest, ManifestSchema } from '../manifest.js';
import { MessageSchema, isMessage } from '../message.js';
import { InboxEntrySchema } from '../inbox-entry.js';
import { FeedEntrySchema, isFeedEntry } from '../feed-entry.js';

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

  it('reuses the shared inbox entry schema in MCP inbox output', () => {
    const InboxOutputSchema = z.object(ToolOutputSchemas.asp_check_inbox);
    const result = InboxOutputSchema.safeParse({
      identity: 'alice',
      count: 1,
      entries: [{
        id: 'msg-1',
        from: 'https://bob.asp.social',
        to: 'https://alice.asp.social',
        kind: 'message',
        type: 'chat',
        timestamp: new Date().toISOString(),
        content: { text: 'Hello Alice' },
        initiated_by: 'agent',
      }],
    });

    expect(result.success).toBe(true);
    expect(InboxEntrySchema.safeParse((result.data as { entries: unknown[] }).entries[0]).success).toBe(true);

    const invalid = InboxOutputSchema.safeParse({
      identity: 'alice',
      count: 1,
      entries: [{
        id: 'msg-1',
        from: 'https://bob.asp.social',
        to: 'https://alice.asp.social',
        kind: 'message',
        type: 'chat',
        timestamp: new Date().toISOString(),
        content: { text: 'Hello Alice' },
      }],
    });

    expect(invalid.success).toBe(false);
  });

  it('validates FeedEntry with signal_type and metadata', () => {
    const base = {
      id: 'post-1',
      title: 'Looking for Rust developers',
      published: new Date().toISOString(),
      topics: ['rust', 'hiring'],
      summary: 'We need Rust devs for our project',
    };

    // Without signal_type/metadata (backward compatible)
    expect(isFeedEntry(base)).toBe(true);

    // With signal_type
    expect(isFeedEntry({ ...base, signal_type: 'intent' })).toBe(true);

    // With metadata
    expect(isFeedEntry({
      ...base,
      signal_type: 'intent',
      metadata: { action: 'find', categories: ['rust', 'backend'] },
    })).toBe(true);

    // signal_type must be string
    expect(isFeedEntry({ ...base, signal_type: 123 })).toBe(false);

    // metadata must be Record<string, unknown>
    expect(isFeedEntry({ ...base, metadata: 'not-an-object' })).toBe(false);
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
