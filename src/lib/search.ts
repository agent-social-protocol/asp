import type { ASPSearchOptions } from './types.js';

function normalizeSearchList(value?: string | string[]): string[] | undefined {
  if (!value) return undefined;

  const raw = Array.isArray(value) ? value : value.split(',');
  const normalized = raw
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return undefined;
  }

  return [...new Set(normalized)];
}

export function normalizeSearchOptions(opts: ASPSearchOptions): {
  q?: string;
  type?: string;
  tags?: string[];
  skills?: string[];
} {
  return {
    q: opts.q?.trim() || undefined,
    type: opts.type?.trim() || undefined,
    tags: normalizeSearchList(opts.tags) ?? normalizeSearchList(opts.tag),
    skills: normalizeSearchList(opts.skills) ?? normalizeSearchList(opts.skill),
  };
}

export function buildSearchParams(opts: ASPSearchOptions): URLSearchParams {
  const normalized = normalizeSearchOptions(opts);
  const params = new URLSearchParams();

  if (normalized.q) params.set('q', normalized.q);
  if (normalized.type) params.set('type', normalized.type);
  if (normalized.tags?.length) params.set('tags', normalized.tags.join(','));
  if (normalized.skills?.length) params.set('skills', normalized.skills.join(','));

  return params;
}
