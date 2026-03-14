function stripLeadingSlashes(path: string): string {
  return path.replace(/^\/+/, '');
}

export function buildEndpointUrl(endpoint: string, path: string): URL {
  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
  return new URL(stripLeadingSlashes(path), base);
}

export function buildEndpointPath(endpoint: string, path: string): string {
  return buildEndpointUrl(endpoint, path).pathname;
}

export function normalizeAbsoluteUrl(url: string): string {
  return url.replace(/\/+$/, '');
}
