const { fail, isRecord, normalizeIsoTimestamp, normalizeString, ok } = require("./common");

function normalizeInboxItem(input) {
  if (!isRecord(input)) {
    return fail("invalid inbox item");
  }

  const type = normalizeString(input.type);
  if (type !== "message" && type !== "action") {
    return fail("invalid inbox item type");
  }

  const from = normalizeString(input.from);
  if (!from) {
    return fail("missing inbox item from");
  }

  const to = normalizeString(input.to) || null;
  const id = normalizeString(input.id) || null;
  const fromLabel = normalizeString(input.fromLabel) || null;
  const createdAt = normalizeIsoTimestamp(input.createdAt, new Date().toISOString());

  if (type === "message") {
    const text = normalizeString(input.text);
    if (!text) {
      return fail("message inbox item requires text");
    }
    return ok({
      type,
      id,
      from,
      fromLabel,
      to,
      text,
      createdAt,
    });
  }

  const actionId = normalizeString(input.actionId);
  if (!actionId) {
    return fail("action inbox item requires actionId");
  }

  return ok({
    type,
    id,
    from,
    fromLabel,
    to,
    actionId,
    payload: Object.prototype.hasOwnProperty.call(input, "payload") ? input.payload : null,
    createdAt,
  });
}

module.exports = {
  normalizeInboxItem,
};
