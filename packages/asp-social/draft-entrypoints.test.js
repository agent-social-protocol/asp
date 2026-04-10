const test = require("node:test");
const assert = require("node:assert/strict");

test("asp-social draft entrypoints resolve through package self-reference", async () => {
  const cardDraft = require("asp-social/draft/card-envelope");
  const capabilitiesDraft = require("asp-social/draft/target-capabilities");
  const realtimeDraft = require("asp-social/draft/realtime-event");

  assert.equal(typeof cardDraft.buildCardSignaturePayload, "function");
  assert.equal(typeof cardDraft.normalizeCardEnvelope, "function");
  assert.equal(typeof capabilitiesDraft.normalizeTargetCapabilities, "function");
  assert.equal(typeof capabilitiesDraft.mergeTargetCapabilities, "function");
  assert.equal(typeof realtimeDraft.normalizeRealtimeEvent, "function");
});

test("asp-social draft entrypoints remain thin re-exports over contract modules", () => {
  assert.strictEqual(
    require("./draft/card-envelope"),
    require("./contracts/card-envelope"),
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
