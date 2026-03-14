import { describe, it, expect } from 'vitest';
import { renderProfilePage, escapeHtml } from '../render-html.js';
import type { Manifest } from '../../models/manifest.js';
import type { FeedEntry } from '../../models/feed-entry.js';

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    protocol: 'asp/1.0',
    entity: {
      id: 'asp:test-agent-001',
      type: 'agent',
      name: 'Test Agent',
      handle: '@test-agent',
      bio: 'A helpful test agent for unit testing.',
      tags: ['testing', 'automation'],
      languages: ['en'],
      created_at: '2025-01-01T00:00:00Z',
    },
    relationships: [],
    capabilities: ['feed', 'interactions', 'inbox'],
    skills: ['code-review', 'summarization'],
    endpoints: {
      feed: '/asp/feed',
      inbox: '/asp/inbox',
      interactions: '/asp/interactions',
    },
    verification: {
      public_key: 'test-key-123',
    },
    ...overrides,
  };
}

function makeEntry(overrides: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id: 'entry-001',
    title: 'Test Entry Title',
    published: '2025-06-15T12:00:00Z',
    topics: ['testing'],
    summary: 'This is a test entry summary.',
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });
});

describe('renderProfilePage', () => {
  it('returns a complete HTML document', () => {
    const html = renderProfilePage(makeManifest(), []);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('includes viewport meta tag for mobile responsiveness', () => {
    const html = renderProfilePage(makeManifest(), []);
    expect(html).toContain('viewport');
    expect(html).toContain('width=device-width');
  });

  it('renders entity name', () => {
    const html = renderProfilePage(makeManifest(), []);
    expect(html).toContain('Test Agent');
  });

  it('renders entity handle', () => {
    const html = renderProfilePage(makeManifest(), []);
    expect(html).toContain('@test-agent');
  });

  it('renders entity bio', () => {
    const html = renderProfilePage(makeManifest(), []);
    expect(html).toContain('A helpful test agent for unit testing.');
  });

  it('renders tags as green pills', () => {
    const html = renderProfilePage(makeManifest(), []);
    // Tags should appear in the output
    expect(html).toContain('testing');
    expect(html).toContain('automation');
    // Should have green-ish styling for tags
    expect(html).toMatch(/tag.*?testing|testing.*?tag/is);
  });

  it('renders skills as purple pills', () => {
    const html = renderProfilePage(makeManifest(), []);
    expect(html).toContain('code-review');
    expect(html).toContain('summarization');
    // Should have skill styling
    expect(html).toMatch(/skill.*?code-review|code-review.*?skill/is);
  });

  it('renders protocol badge', () => {
    const html = renderProfilePage(makeManifest(), []);
    expect(html).toContain('asp/1.0');
  });

  it('renders follow command box', () => {
    const html = renderProfilePage(makeManifest(), []);
    expect(html).toContain('asp follow');
    expect(html).toContain('<label>Follow</label>');
    expect(html).toContain('asp init');
  });

  it('renders dark theme background', () => {
    const html = renderProfilePage(makeManifest(), []);
    expect(html).toContain('#0a0a0a');
  });

  it('renders feed entries', () => {
    const entries = [
      makeEntry({ title: 'First Post', summary: 'Summary of the first post.' }),
      makeEntry({ id: 'entry-002', title: 'Second Post', summary: 'Summary of the second post.' }),
    ];
    const html = renderProfilePage(makeManifest(), entries);
    expect(html).toContain('First Post');
    expect(html).toContain('Summary of the first post.');
    expect(html).toContain('Second Post');
    expect(html).toContain('Summary of the second post.');
  });

  it('limits feed entries to 5', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ id: `entry-${i}`, title: `Post ${i}` }),
    );
    const html = renderProfilePage(makeManifest(), entries);
    // Should contain first 5
    expect(html).toContain('Post 0');
    expect(html).toContain('Post 4');
    // Should NOT contain entry 5+
    expect(html).not.toContain('Post 5');
    expect(html).not.toContain('Post 9');
  });

  it('renders footer with Built on ASP', () => {
    const html = renderProfilePage(makeManifest(), []);
    expect(html).toContain('Built on ASP');
  });

  it('renders footer with GitHub link', () => {
    const html = renderProfilePage(makeManifest(), []);
    expect(html).toContain('github.com');
  });

  it('escapes XSS in entity name', () => {
    const manifest = makeManifest();
    manifest.entity.name = '<script>alert("xss")</script>';
    const html = renderProfilePage(manifest, []);
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes XSS in entity bio', () => {
    const manifest = makeManifest();
    manifest.entity.bio = '<img onerror="alert(1)" src=x>';
    const html = renderProfilePage(manifest, []);
    expect(html).not.toContain('<img onerror="alert(1)" src=x>');
    expect(html).toContain('&lt;img onerror=');
  });

  it('escapes XSS in feed entry titles', () => {
    const entries = [makeEntry({ title: '<script>xss</script>' })];
    const html = renderProfilePage(makeManifest(), entries);
    expect(html).not.toContain('<script>xss</script>');
    expect(html).toContain('&lt;script&gt;xss&lt;/script&gt;');
  });

  it('escapes XSS in feed entry summaries', () => {
    const entries = [makeEntry({ summary: '"><img src=x onerror=alert(1)>' })];
    const html = renderProfilePage(makeManifest(), entries);
    expect(html).not.toContain('"><img src=x onerror=alert(1)>');
  });

  it('escapes XSS in tags', () => {
    const manifest = makeManifest();
    manifest.entity.tags = ['<b>bold</b>'];
    const html = renderProfilePage(manifest, []);
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('handles manifest with no tags', () => {
    const manifest = makeManifest();
    delete (manifest.entity as unknown as Record<string, unknown>).tags;
    const html = renderProfilePage(manifest, []);
    expect(html).toContain('Test Agent');
    // Should not crash and should still render
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('handles manifest with no skills', () => {
    const manifest = makeManifest();
    delete (manifest as unknown as Record<string, unknown>).skills;
    const html = renderProfilePage(manifest, []);
    expect(html).toContain('Test Agent');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('handles empty entries array', () => {
    const html = renderProfilePage(makeManifest(), []);
    expect(html).toContain('<!DOCTYPE html>');
    // Should still have the page structure
    expect(html).toContain('Test Agent');
  });

  it('renders entry published date', () => {
    const entries = [makeEntry({ published: '2025-06-15T12:00:00Z' })];
    const html = renderProfilePage(makeManifest(), entries);
    // Date should appear in some rendered form
    expect(html).toContain('2025');
  });

  it('renders capabilities', () => {
    const html = renderProfilePage(makeManifest(), []);
    expect(html).toContain('feed');
    expect(html).toContain('interactions');
    expect(html).toContain('inbox');
  });
});
