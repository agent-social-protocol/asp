function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() || null : null;
}

function normalizeIsoTimestamp(value, fallback = null) {
  if (value == null) {
    return fallback;
  }
  const normalized = normalizeString(value);
  if (!normalized) {
    return fallback;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed.toISOString();
}

function ok(value) {
  return { ok: true, value };
}

function fail(error) {
  return { ok: false, error };
}

module.exports = {
  fail,
  isRecord,
  normalizeIsoTimestamp,
  normalizeString,
  ok,
};
