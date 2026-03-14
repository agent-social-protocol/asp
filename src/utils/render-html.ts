import type { Manifest } from '../models/manifest.js';
import type { FeedEntry } from '../models/feed-entry.js';
import { handleFromHostedEndpoint } from '../config/hosted.js';

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return escapeHtml(iso);
  }
}

function renderTags(tags: string[]): string {
  if (!tags.length) return '';
  const pills = tags
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join('');
  return `<div class="pills">${pills}</div>`;
}

function renderSkills(skills: (string | { id: string; name: string })[]): string {
  if (!skills.length) return '';
  const pills = skills
    .map((s) => {
      const label = typeof s === 'string' ? s : s.name;
      return `<span class="skill">${escapeHtml(label)}</span>`;
    })
    .join('');
  return `<div class="pills">${pills}</div>`;
}

function renderCapabilities(capabilities: string[]): string {
  if (!capabilities.length) return '';
  const items = capabilities
    .map((c) => `<span class="capability">${escapeHtml(c)}</span>`)
    .join('');
  return `<div class="capabilities">${items}</div>`;
}

function renderEntries(entries: FeedEntry[]): string {
  const display = entries.slice(0, 5);
  if (!display.length) return '';

  const items = display
    .map(
      (e) => `
      <article class="entry">
        <h3 class="entry-title">${escapeHtml(e.title)}</h3>
        <time class="entry-date">${formatDate(e.published)}${e.updated ? ` (edited ${formatDate(e.updated)})` : ''}</time>
        <p class="entry-summary">${escapeHtml(e.summary)}</p>
      </article>`,
    )
    .join('');

  return `
    <section class="feed">
      <h2>Recent Activity</h2>
      ${items}
    </section>`;
}

/**
 * Render a full profile page for a given manifest and feed entries.
 * Returns a complete HTML document string with dark theme styling.
 */
export function renderProfilePage(manifest: Manifest, entries: FeedEntry[]): string {
  const { entity, protocol, capabilities, skills } = manifest;
  const entityName = escapeHtml(entity.name);
  const entityHandle = escapeHtml(entity.handle);
  const entityBio = escapeHtml(entity.bio);
  const entityId = escapeHtml(entity.id);
  const entityType = escapeHtml(entity.type);
  const followTarget = (() => {
    const handle = handleFromHostedEndpoint(entity.id);
    if (handle) return `@${handle}`;
    return entity.id.replace(/^https?:\/\//, '');
  })();
  const tags = entity.tags ?? [];
  const skillsList = skills ?? [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${entityName} — ASP Profile</title>
  <meta name="description" content="${entityBio}">
  <meta property="og:title" content="${entityName}">
  <meta property="og:description" content="${entityBio}">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #0a0a0a;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .container {
      width: 100%;
      max-width: 640px;
      padding: 2rem 1.5rem;
    }

    .header {
      margin-bottom: 2rem;
    }

    .protocol-badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #888;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 0.15rem 0.5rem;
      margin-bottom: 1rem;
    }

    .entity-type {
      font-size: 0.8rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 0.25rem;
    }

    .entity-name {
      font-size: clamp(1.5rem, 5vw, 2.25rem);
      font-weight: 700;
      color: #fff;
      margin-bottom: 0.25rem;
    }

    .entity-handle {
      font-size: 1rem;
      color: #6b7280;
      margin-bottom: 0.75rem;
    }

    .entity-bio {
      font-size: 1rem;
      color: #a0a0a0;
      margin-bottom: 1.25rem;
    }

    .pills {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-bottom: 0.75rem;
    }

    .tag {
      display: inline-block;
      font-size: 0.8rem;
      font-weight: 500;
      color: #4ade80;
      background: rgba(74, 222, 128, 0.1);
      border: 1px solid rgba(74, 222, 128, 0.25);
      border-radius: 9999px;
      padding: 0.2rem 0.65rem;
    }

    .skill {
      display: inline-block;
      font-size: 0.8rem;
      font-weight: 500;
      color: #a78bfa;
      background: rgba(167, 139, 250, 0.1);
      border: 1px solid rgba(167, 139, 250, 0.25);
      border-radius: 9999px;
      padding: 0.2rem 0.65rem;
    }

    .capabilities {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-bottom: 1.25rem;
    }

    .capability {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 500;
      color: #60a5fa;
      background: rgba(96, 165, 250, 0.08);
      border: 1px solid rgba(96, 165, 250, 0.2);
      border-radius: 4px;
      padding: 0.15rem 0.5rem;
    }

    .follow-box {
      background: #141414;
      border: 1px solid #262626;
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 2rem;
    }

    .follow-box label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    .follow-cmd {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.9rem;
      color: #4ade80;
      background: #0a0a0a;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 0.6rem 0.75rem;
      width: 100%;
      word-break: break-all;
      user-select: all;
    }

    .cta-hint {
      margin-top: 0.75rem;
      font-size: 0.85rem;
      color: #7a7a7a;
    }

    .cta-hint code {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      color: #4ade80;
      background: rgba(74, 222, 128, 0.08);
      border: 1px solid rgba(74, 222, 128, 0.2);
      border-radius: 6px;
      padding: 0.15rem 0.4rem;
    }

    .feed {
      margin-bottom: 2rem;
    }

    .feed h2 {
      font-size: 1.1rem;
      font-weight: 600;
      color: #fff;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #1f1f1f;
    }

    .entry {
      padding: 1rem 0;
      border-bottom: 1px solid #1a1a1a;
    }

    .entry:last-child {
      border-bottom: none;
    }

    .entry-title {
      font-size: 1rem;
      font-weight: 600;
      color: #e0e0e0;
      margin-bottom: 0.25rem;
    }

    .entry-date {
      display: block;
      font-size: 0.8rem;
      color: #666;
      margin-bottom: 0.4rem;
    }

    .entry-summary {
      font-size: 0.9rem;
      color: #999;
    }

    footer {
      margin-top: auto;
      width: 100%;
      max-width: 640px;
      padding: 1.5rem;
      text-align: center;
      font-size: 0.8rem;
      color: #555;
      border-top: 1px solid #1a1a1a;
    }

    footer a {
      color: #6b7280;
      text-decoration: none;
    }

    footer a:hover {
      color: #a0a0a0;
      text-decoration: underline;
    }

    .footer-sep {
      margin: 0 0.5rem;
      color: #333;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="protocol-badge">${escapeHtml(protocol)}</span>
      <p class="entity-type">${entityType}</p>
      <h1 class="entity-name">${entityName}</h1>
      <p class="entity-handle">${entityHandle}</p>
      <p class="entity-bio">${entityBio}</p>
      ${renderTags(tags)}
      ${renderSkills(skillsList)}
      ${renderCapabilities(capabilities)}
    </div>

    <div class="follow-box">
      <label>Follow</label>
      <div class="follow-cmd">asp follow ${escapeHtml(followTarget)}</div>
      <p class="cta-hint">Need an identity first? Run <code>asp init</code>.</p>
    </div>

    ${renderEntries(entries)}
  </div>

  <footer>
    <span>${entityId}</span>
    <span class="footer-sep">|</span>
    <span>Built on ASP</span>
    <span class="footer-sep">|</span>
    <a href="https://github.com/agent-social-protocol/asp" target="_blank" rel="noopener">github.com/agent-social-protocol/asp</a>
  </footer>
</body>
</html>`;
}
