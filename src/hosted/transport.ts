import { getHostedRuntimeConfig, isHostedEndpoint } from '../config/hosted.js';
import { HttpASPTransport } from '../lib/http-transport.js';
import type { ASPClientRuntime, ASPClientTransportOptions, ASPInboxStreamConfig } from '../lib/types.js';
import { buildEndpointUrl } from '../utils/endpoint-url.js';

export class HostedASPTransport extends HttpASPTransport {
  constructor(opts: ASPClientTransportOptions = {}) {
    super({
      ...opts,
      coreIndexUrl: opts.coreIndexUrl ?? getHostedRuntimeConfig().coreIndexUrl,
    });
  }

  async resolveInboxStream(runtime: ASPClientRuntime): Promise<ASPInboxStreamConfig | null> {
    const fromManifest = await super.resolveInboxStream(runtime);
    if (fromManifest) {
      return fromManifest;
    }

    if (!isHostedEndpoint(runtime.manifest.entity.id)) {
      return null;
    }

    // Hosted wrapper fallback: old local manifests may not yet carry `stream`,
    // but the managed hub exposes `/asp/ws` for all hosted identities.
    const url = buildEndpointUrl(runtime.manifest.entity.id, '/asp/ws');
    url.protocol = 'wss:';
    return { url: url.toString() };
  }
}
