import { randomUUID } from 'node:crypto';
import type { FeedEntry } from '../models/feed-entry.js';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export function generateId(title: string, existingEntries: FeedEntry[]): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(title);
  const base = `${date}-${slug}`;

  const existing = new Set(existingEntries.map((e) => e.id));
  if (!existing.has(base)) return base;

  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function generateMessageId(): string {
  return `msg-${randomUUID()}`;
}
