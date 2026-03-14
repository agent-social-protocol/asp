import { buildEndpointUrl, normalizeAbsoluteUrl } from './endpoint-url.js';

export const ASP_WEBFINGER_ENDPOINT_REL = 'urn:asp:rel:endpoint';

interface WebFingerLink {
  rel?: string;
  type?: string;
  href?: string;
}

interface WebFingerDocument {
  subject?: string;
  aliases?: unknown[];
  links?: unknown[];
}

export function buildAccountIdentifier(handle: string, domain: string): string {
  return `${handle.replace(/^@/, '')}@${domain.toLowerCase()}`;
}

export function normalizeAccountIdentifier(target: string): string | null {
  const trimmed = target.trim();
  if (!trimmed || trimmed.includes('://') || trimmed.includes('/')) {
    return null;
  }

  const qualifiedHandle = trimmed.match(/^@([^@\s]+)@([^@\s/]+)$/);
  if (qualifiedHandle) {
    return buildAccountIdentifier(qualifiedHandle[1], qualifiedHandle[2]);
  }

  const account = trimmed.match(/^([^@\s]+)@([^@\s/]+)$/);
  if (account) {
    return buildAccountIdentifier(account[1], account[2]);
  }

  return null;
}

export function splitAccountIdentifier(account: string): { username: string; domain: string } | null {
  const normalized = normalizeAccountIdentifier(account);
  if (!normalized) {
    return null;
  }

  const separator = normalized.indexOf('@');
  if (separator === -1) {
    return null;
  }

  return {
    username: normalized.slice(0, separator),
    domain: normalized.slice(separator + 1),
  };
}

export function accountDomainOrigin(domain: string): string {
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(domain)) {
    return `http://${domain}`;
  }
  return `https://${domain}`;
}

export function buildWebFingerUrl(account: string): string {
  const parts = splitAccountIdentifier(account);
  if (!parts) {
    throw new Error(`Invalid account identifier: ${account}`);
  }

  const url = new URL('/.well-known/webfinger', accountDomainOrigin(parts.domain));
  url.searchParams.set('resource', `acct:${parts.username}@${parts.domain}`);
  return url.toString();
}

export function parseWebFingerResource(resource: string | null): { account: string; username: string; domain: string } | null {
  if (!resource) {
    return null;
  }

  const normalized = normalizeAccountIdentifier(resource.replace(/^acct:/, ''));
  if (!normalized) {
    return null;
  }

  const parts = splitAccountIdentifier(normalized);
  if (!parts) {
    return null;
  }

  return { account: normalized, ...parts };
}

export function buildWebFingerResponse(opts: {
  account: string;
  endpoint: string;
  profileUrl?: string;
}): { subject: string; aliases: string[]; links: Array<{ rel: string; type?: string; href: string }> } {
  const endpoint = normalizeAbsoluteUrl(opts.endpoint);
  const manifestUrl = buildEndpointUrl(endpoint, '/.well-known/asp.yaml').toString();

  return {
    subject: `acct:${opts.account}`,
    aliases: [endpoint, manifestUrl],
    links: [
      {
        rel: ASP_WEBFINGER_ENDPOINT_REL,
        type: 'application/asp+json',
        href: endpoint,
      },
      {
        rel: 'self',
        type: 'application/asp+json',
        href: endpoint,
      },
      {
        rel: 'describedby',
        type: 'application/yaml',
        href: manifestUrl,
      },
      ...(opts.profileUrl
        ? [{
            rel: 'alternate',
            type: 'text/html',
            href: opts.profileUrl,
          }]
        : []),
    ],
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function manifestUrlToEndpoint(value: string): string | null {
  if (!isHttpUrl(value)) {
    return null;
  }

  const url = new URL(value);
  const suffix = '/.well-known/asp.yaml';
  if (!url.pathname.endsWith(suffix)) {
    return null;
  }

  const pathname = url.pathname.slice(0, -suffix.length);
  const endpoint = `${url.origin}${pathname || '/'}`;
  return normalizeAbsoluteUrl(endpoint);
}

function firstUrl(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    if (isHttpUrl(value)) {
      return normalizeAbsoluteUrl(value);
    }

    const endpoint = manifestUrlToEndpoint(value);
    if (endpoint) {
      return endpoint;
    }
  }

  return null;
}

export function extractEndpointFromWebFinger(document: unknown): string | null {
  if (!document || typeof document !== 'object') {
    return null;
  }

  const data = document as WebFingerDocument;
  const links = Array.isArray(data.links) ? data.links.filter((link): link is WebFingerLink => !!link && typeof link === 'object') : [];

  const endpointLink = firstUrl(
    links
      .filter((link) => link.rel === ASP_WEBFINGER_ENDPOINT_REL)
      .map((link) => link.href),
  );
  if (endpointLink) {
    return endpointLink;
  }

  const selfLink = firstUrl(
    links
      .filter((link) => link.rel === 'self')
      .map((link) => link.href),
  );
  if (selfLink) {
    return selfLink;
  }

  const alias = firstUrl(Array.isArray(data.aliases) ? data.aliases : []);
  if (alias) {
    return alias;
  }

  return firstUrl(
    links
      .filter((link) => link.rel === 'describedby')
      .map((link) => link.href),
  );
}

export async function discoverAccountEndpoint(account: string): Promise<string | null> {
  try {
    const res = await fetch(buildWebFingerUrl(account), {
      headers: {
        Accept: 'application/jrd+json, application/json',
      },
    });
    if (!res.ok) {
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      return null;
    }

    return extractEndpointFromWebFinger(await res.json());
  } catch {
    return null;
  }
}
