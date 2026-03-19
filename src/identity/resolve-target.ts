import { resolveHostedTargetEndpoint } from '../config/hosted.js';
import { discoverAccountEndpoint, normalizeAccountIdentifier, splitAccountIdentifier } from '../utils/webfinger.js';

export function toEndpoint(arg: string): string {
  return resolveHostedTargetEndpoint(arg);
}

export async function resolveEndpoint(arg: string): Promise<string> {
  const account = normalizeAccountIdentifier(arg);
  if (!account) {
    return toEndpoint(arg);
  }

  const discovered = await discoverAccountEndpoint(account);
  if (discovered.status === 'resolved') {
    return discovered.endpoint;
  }
  if (discovered.status === 'error') {
    throw new Error(`Could not resolve ${account}: ${discovered.error}`);
  }

  const parts = splitAccountIdentifier(account);
  if (!parts) {
    return toEndpoint(arg);
  }

  return toEndpoint(`@${parts.username}@${parts.domain}`);
}

export function normalizeEndpoint(url: string): string {
  return url.replace(/\/+$/, '');
}

export function parsePostUrl(postUrl: string): { baseUrl: string; postId: string } {
  const hashIdx = postUrl.indexOf('#');
  if (hashIdx === -1) {
    return { baseUrl: postUrl, postId: '' };
  }
  const feedPath = postUrl.slice(0, hashIdx);
  const baseUrl = feedPath.replace(/\/asp\/feed\/?$/, '');
  const postId = postUrl.slice(hashIdx + 1);
  return { baseUrl, postId };
}
