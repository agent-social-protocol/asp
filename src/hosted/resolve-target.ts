// Compatibility shim: canonical target resolution now lives in src/identity/.
export {
  normalizeEndpoint,
  parsePostUrl,
  resolveEndpoint,
  toEndpoint,
} from '../identity/resolve-target.js';
