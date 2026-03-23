import { describe, expect, it } from 'vitest';
import type { InboxEntry } from '../../models/inbox-entry.js';
import { hasSenderScopedEntryIdentity, inboxEntryToMessage } from '../inbox-entry.js';

describe('inbox entry adapters', () => {
  it('does not coerce message entries without initiated_by into legacy Message objects', () => {
    const entry = {
      id: 'm-1',
      from: 'https://alice.example',
      to: 'https://bob.example',
      kind: 'message',
      type: 'note',
      timestamp: '2026-03-23T00:00:00.000Z',
      content: { text: 'hello' },
    } as InboxEntry;

    expect(inboxEntryToMessage(entry)).toBeNull();
  });

  it('does not coerce message entries without text into legacy Message objects', () => {
    const entry = {
      id: 'm-2',
      from: 'https://alice.example',
      to: 'https://bob.example',
      kind: 'message',
      type: 'service-request',
      timestamp: '2026-03-23T00:00:00.000Z',
      initiated_by: 'human',
      content: { data: { service: 'calendar' } },
    } as InboxEntry;

    expect(inboxEntryToMessage(entry)).toBeNull();
  });

  it('checks sender-scoped duplicate identity', () => {
    const entries: InboxEntry[] = [
      {
        id: 'dup-1',
        from: 'https://alice.example',
        to: 'https://bob.example',
        kind: 'interaction',
        type: 'follow',
        timestamp: '2026-03-23T00:00:00.000Z',
      },
    ];

    expect(hasSenderScopedEntryIdentity(entries, { id: 'dup-1', from: 'https://alice.example' })).toBe(true);
    expect(hasSenderScopedEntryIdentity(entries, { id: 'dup-1', from: 'https://carol.example' })).toBe(false);
  });
});
