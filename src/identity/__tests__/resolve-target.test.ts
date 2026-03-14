import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeEndpoint, parsePostUrl, resolveEndpoint, toEndpoint } from '../resolve-target.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('resolve-target', () => {
  it('resolves @handle to letus.social', () => {
    expect(toEndpoint('@alice')).toBe('https://alice.letus.social');
  });

  it('resolves qualified hosted handles to the hosted endpoint', () => {
    expect(toEndpoint('@alice@letus.social')).toBe('https://alice.letus.social');
  });

  it('resolves qualified self-hosted handles to the shared domain', () => {
    expect(toEndpoint('@alice@example.com')).toBe('https://example.com');
  });

  it('resolves canonical account identifiers to the shared domain', () => {
    expect(toEndpoint('alice@example.com')).toBe('https://example.com');
  });

  it('passes through absolute https URLs', () => {
    expect(toEndpoint('https://alice.example')).toBe('https://alice.example');
  });

  it('passes through absolute http URLs', () => {
    expect(toEndpoint('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('treats dotted names as domains', () => {
    expect(toEndpoint('alice.dev')).toBe('https://alice.dev');
  });

  it('resolves bare name as letus.social handle', () => {
    expect(toEndpoint('alice')).toBe('https://alice.letus.social');
  });

  it('discovers account identifiers via WebFinger before falling back to the domain root', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/jrd+json' },
      json: () => Promise.resolve({
        subject: 'acct:alice@example.com',
        links: [
          {
            rel: 'urn:asp:rel:endpoint',
            href: 'https://social.example.com/alice',
          },
        ],
      }),
    }));

    await expect(resolveEndpoint('alice@example.com')).resolves.toBe('https://social.example.com/alice');
  });

  it('falls back to the account domain when WebFinger is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => 'application/jrd+json' },
    }));

    await expect(resolveEndpoint('alice@example.com')).resolves.toBe('https://example.com');
  });

  it('normalizes trailing slash', () => {
    expect(normalizeEndpoint('https://bob.letus.social/')).toBe('https://bob.letus.social');
  });

  it('normalizes multiple trailing slashes', () => {
    expect(normalizeEndpoint('https://bob.letus.social///')).toBe('https://bob.letus.social');
  });

  it('leaves endpoint without trailing slash unchanged', () => {
    expect(normalizeEndpoint('https://bob.letus.social')).toBe('https://bob.letus.social');
  });

  it('parses post URL without hash', () => {
    const result = parsePostUrl('https://alice.letus.social');
    expect(result).toEqual({ baseUrl: 'https://alice.letus.social', postId: '' });
  });

  it('parses post URL with standard feed path', () => {
    const result = parsePostUrl('https://alice.letus.social/asp/feed#post-1');
    expect(result).toEqual({ baseUrl: 'https://alice.letus.social', postId: 'post-1' });
  });

  it('parses post URL with trailing slash before hash', () => {
    const result = parsePostUrl('https://alice.letus.social/asp/feed/#post-2');
    expect(result).toEqual({ baseUrl: 'https://alice.letus.social', postId: 'post-2' });
  });
});
