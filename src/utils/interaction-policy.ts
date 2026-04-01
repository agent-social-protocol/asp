function normalizeEndpointUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function isAspPostUrl(target: string): boolean {
  try {
    const url = new URL(target);
    if (!url.hash || url.hash === '#') {
      return false;
    }
    return url.pathname === '/asp/feed' || url.pathname === '/asp/feed/';
  } catch {
    return false;
  }
}

export function validateInteractionPolicy(entry: {
  action: string;
  from?: string;
  to?: string;
  target?: string;
}): string | null {
  if (entry.action === 'follow' && entry.from && entry.to) {
    if (normalizeEndpointUrl(entry.from) === normalizeEndpointUrl(entry.to)) {
      return 'Cannot follow yourself';
    }
  }

  if (entry.action === 'like') {
    if (!entry.target || !isAspPostUrl(entry.target)) {
      return 'Like interactions require an ASP post URL target';
    }
  }

  return null;
}
