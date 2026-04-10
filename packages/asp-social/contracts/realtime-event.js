// Pre-protocol draft. Keep realtime event shapes backward compatible until
// promotion into the public ASP protocol layer is explicit.
const { fail, isRecord, normalizeIsoTimestamp, normalizeString, ok } = require("./common");
const { normalizeInboxItem } = require("./inbox-item");
const { normalizeCardEnvelope } = require("./card-envelope");

function normalizeRealtimeEvent(input) {
  if (!isRecord(input)) {
    return fail("invalid realtime event");
  }

  const type = normalizeString(input.type);
  if (!type) {
    return fail("missing realtime event type");
  }

  if (type === "message.received" || type === "action.received") {
    const normalized = normalizeInboxItem(input.item);
    if (!normalized.ok) {
      return normalized;
    }
    if (type === "message.received" && normalized.value.type !== "message") {
      return fail("message.received requires message item");
    }
    if (type === "action.received" && normalized.value.type !== "action") {
      return fail("action.received requires action item");
    }
    return ok({
      type,
      item: normalized.value,
    });
  }

  if (type === "card.updated") {
    const ownerId = normalizeString(input.ownerId);
    if (!ownerId) {
      return fail("card.updated requires ownerId");
    }
    const normalized = normalizeCardEnvelope(input.envelope);
    if (!normalized.ok) {
      return normalized;
    }
    return ok({
      type,
      ownerId,
      envelope: normalized.value,
    });
  }

  if (type === "card.deleted") {
    const ownerId = normalizeString(input.ownerId);
    if (!ownerId) {
      return fail("card.deleted requires ownerId");
    }
    const contractId = normalizeString(input.contractId);
    if (!contractId) {
      return fail("card.deleted requires contractId");
    }
    const deletedAt = normalizeIsoTimestamp(input.deletedAt, null);
    if (!deletedAt) {
      return fail("card.deleted requires deletedAt");
    }
    return ok({
      type,
      ownerId,
      contractId,
      deletedAt,
    });
  }

  return fail("invalid realtime event type");
}

module.exports = {
  normalizeRealtimeEvent,
};
