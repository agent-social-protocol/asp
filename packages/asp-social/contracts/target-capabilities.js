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

function normalizeCardCapability(input) {
  if (!isRecord(input)) {
    throw new Error("invalid card capability");
  }

  const contractId = normalizeString(input.contractId);
  if (!contractId) {
    throw new Error("card capability requires contractId");
  }

  const schemaVersion = normalizeString(input.schemaVersion) || "1";
  const schemaUrl = normalizeString(input.schemaUrl) || null;

  return schemaUrl
    ? { contractId, schemaVersion, schemaUrl }
    : { contractId, schemaVersion };
}

function normalizeCards(input) {
  if (input == null) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error("invalid cards capability list");
  }

  const cardsByContractId = new Map();
  for (const card of input) {
    const normalized = normalizeCardCapability(card);
    cardsByContractId.set(normalized.contractId, normalized);
  }
  return [...cardsByContractId.values()];
}

function normalizeTargetCapabilities(input) {
  if (input == null) {
    return ok({
      messages: true,
      supportedActions: [],
      supportedPacks: [],
      cards: [],
    });
  }
  if (!isRecord(input)) {
    return fail("invalid target capabilities");
  }

  let cards;
  try {
    cards = normalizeCards(input.cards);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  return ok({
    messages: Object.prototype.hasOwnProperty.call(input, "messages") ? Boolean(input.messages) : true,
    supportedActions: uniqueStrings(input.supportedActions),
    supportedPacks: uniqueStrings(input.supportedPacks),
    cards,
  });
}

function mergeTargetCapabilities(...values) {
  const merged = {
    messages: true,
    supportedActions: [],
    supportedPacks: [],
    cards: [],
  };

  for (const value of values) {
    const normalized = normalizeTargetCapabilities(value);
    if (!normalized.ok) {
      throw new Error(normalized.error);
    }
    merged.messages = merged.messages || normalized.value.messages;
    merged.supportedActions = uniqueStrings([...merged.supportedActions, ...normalized.value.supportedActions]);
    merged.supportedPacks = uniqueStrings([...merged.supportedPacks, ...normalized.value.supportedPacks]);

    const cardsByContractId = new Map(merged.cards.map((card) => [card.contractId, card]));
    for (const card of normalized.value.cards) {
      cardsByContractId.set(card.contractId, card);
    }
    merged.cards = [...cardsByContractId.values()];
  }

  return merged;
}

module.exports = {
  mergeTargetCapabilities,
  normalizeTargetCapabilities,
};
