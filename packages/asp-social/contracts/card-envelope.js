// Pre-protocol draft. Keep the JSON wire shape backward compatible until
// promotion into the public ASP protocol layer is explicit.
const { fail, isRecord, normalizeIsoTimestamp, normalizeString, ok } = require("./common");

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.keys(value)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

function buildCardSignaturePayload(input) {
  const normalized = normalizeCardEnvelope(input);
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }

  const envelope = normalized.value;
  return [
    envelope.contractId,
    envelope.schemaVersion,
    envelope.updatedAt,
    envelope.expiresAt || "",
    stableStringify(envelope.snapshot),
  ].join(":");
}

function normalizeCardEnvelope(input) {
  if (!isRecord(input)) {
    return fail("invalid card envelope");
  }

  const contractId = normalizeString(input.contractId);
  if (!contractId) {
    return fail("missing card contractId");
  }

  const schemaVersion = normalizeString(input.schemaVersion) || "1";
  const updatedAt = normalizeIsoTimestamp(input.updatedAt, null);
  if (!updatedAt) {
    return fail("invalid card updatedAt");
  }

  const hasExpiresAt = Object.prototype.hasOwnProperty.call(input, "expiresAt");
  const expiresAt = hasExpiresAt ? normalizeIsoTimestamp(input.expiresAt, null) : null;
  if (hasExpiresAt && input.expiresAt != null && !expiresAt) {
    return fail("invalid card expiresAt");
  }

  if (!Object.prototype.hasOwnProperty.call(input, "snapshot")) {
    return fail("missing card snapshot");
  }
  const snapshot = input.snapshot;
  if (snapshot == null || typeof snapshot !== "object") {
    return fail("invalid card snapshot");
  }

  const signature = normalizeString(input.signature);
  const signedBy = normalizeString(input.signedBy);

  return ok({
    contractId,
    schemaVersion,
    snapshot,
    updatedAt,
    expiresAt,
    ...(signature ? { signature } : {}),
    ...(signedBy ? { signedBy } : {}),
  });
}

module.exports = {
  buildCardSignaturePayload,
  normalizeCardEnvelope,
};
