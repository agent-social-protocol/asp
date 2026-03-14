import { getHostedRuntimeConfig } from '../config/hosted.js';
import { HttpASPTransport } from '../lib/http-transport.js';
import type { ASPClientTransportOptions } from '../lib/types.js';

export class HostedASPTransport extends HttpASPTransport {
  constructor(opts: ASPClientTransportOptions = {}) {
    super({
      ...opts,
      coreIndexUrl: opts.coreIndexUrl ?? getHostedRuntimeConfig().coreIndexUrl,
    });
  }
}
