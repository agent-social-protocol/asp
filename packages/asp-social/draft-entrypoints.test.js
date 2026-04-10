const test = require("node:test");
const assert = require("node:assert/strict");

test("asp-social draft entrypoints resolve through package self-reference", async () => {
  const presenceDraft = require("asp-social/draft/presence-envelope");
  const capabilitiesDraft = require("asp-social/draft/target-capabilities");
  const realtimeDraft = require("asp-social/draft/realtime-event");

  assert.equal(typeof presenceDraft.buildPresenceSignaturePayload, "function");
  assert.equal(typeof presenceDraft.normalizePresenceEnvelope, "function");
  assert.equal(typeof capabilitiesDraft.normalizeTargetCapabilities, "function");
  assert.equal(typeof capabilitiesDraft.mergeTargetCapabilities, "function");
  assert.equal(typeof realtimeDraft.normalizeRealtimeEvent, "function");
});

test("asp-social draft entrypoints remain thin re-exports over contract modules", () => {
  assert.strictEqual(
    require("./draft/presence-envelope"),
    require("./contracts/presence-envelope"),
  );
  assert.strictEqual(
    require("./draft/target-capabilities"),
    require("./contracts/target-capabilities"),
  );
  assert.strictEqual(
    require("./draft/realtime-event"),
    require("./contracts/realtime-event"),
  );
});
