// Pre-protocol draft. Keep capability discovery shapes stable until promotion
// into the public ASP protocol layer is explicit.
const { fail, isRecord, normalizeString, ok } = require("./common");

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizePresenceCapability(input) {
  if (input == null) {
    return {
      supported: false,
      contractId: null,
    };
  }
  if (!isRecord(input)) {
    throw new Error("invalid presence capability");
  }
  const supported = Boolean(input.supported);
  const contractId = normalizeString(input.contractId);
  if (supported && !contractId) {
    throw new Error("presence capability requires contractId");
  }
  return {
    supported,
    contractId: supported ? contractId : null,
  };
}

function normalizeTargetCapabilities(input) {
  if (input == null) {
    return ok({
      messages: true,
      supportedActions: [],
      supportedPacks: [],
      presence: {
        supported: false,
        contractId: null,
      },
    });
  }
  if (!isRecord(input)) {
    return fail("invalid target capabilities");
  }

  let presence;
  try {
    presence = normalizePresenceCapability(input.presence);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  return ok({
    messages: Object.prototype.hasOwnProperty.call(input, "messages") ? Boolean(input.messages) : true,
    supportedActions: uniqueStrings(input.supportedActions),
    supportedPacks: uniqueStrings(input.supportedPacks),
    presence,
  });
}

function mergeTargetCapabilities(...values) {
  const merged = {
    messages: true,
    supportedActions: [],
    supportedPacks: [],
    presence: {
      supported: false,
      contractId: null,
    },
  };

  for (const value of values) {
    const normalized = normalizeTargetCapabilities(value);
    if (!normalized.ok) {
      throw new Error(normalized.error);
    }
    merged.messages = merged.messages || normalized.value.messages;
    merged.supportedActions = uniqueStrings([...merged.supportedActions, ...normalized.value.supportedActions]);
    merged.supportedPacks = uniqueStrings([...merged.supportedPacks, ...normalized.value.supportedPacks]);
    if (normalized.value.presence.supported) {
      merged.presence = {
        supported: true,
        contractId: normalized.value.presence.contractId,
      };
    }
  }

  return merged;
}

module.exports = {
  mergeTargetCapabilities,
  normalizeTargetCapabilities,
};
