import type { ASPClientTransportOptions } from './types.js';
import { HttpASPTransport } from './http-transport.js';

export class ProtocolASPTransport extends HttpASPTransport {
  constructor(opts: ASPClientTransportOptions = {}) {
    super(opts);
  }
}
