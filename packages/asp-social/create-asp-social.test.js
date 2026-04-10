const test = require("node:test");
const assert = require("node:assert/strict");

const { companionPack, createAspSocial } = require("./index");

test("createAspSocial merges pack capabilities and delegates sends", async () => {
  const calls = [];
  const social = createAspSocial({
    packs: [companionPack],
    capabilities: {
      cards: [{ contractId: "buddy.shared-presence/v1", schemaVersion: "1" }],
    },
    transport: {
      async getShareUrl() {
        return "https://brindle.asp.social";
      },
      async getConnectionState() {
        return { status: "ready", url: "https://brindle.asp.social" };
      },
      async getTargetCapabilities(target) {
        calls.push(["getTargetCapabilities", target]);
        return {
          messages: true,
          supportedActions: [],
          supportedPacks: [],
          cards: [{ contractId: "buddy.shared-presence/v1", schemaVersion: "1" }],
        };
      },
      async follow(target) {
        calls.push(["follow", target]);
      },
      async unfollow(target) {
        calls.push(["unfollow", target]);
      },
      async listFollowing() {
        return ["@alice"];
      },
      async sendMessage(input) {
        calls.push(["message", input]);
      },
      async sendAction(input) {
        calls.push(["action", input]);
      },
      async listInboxItems() {
        return [
          {
            type: "message",
            from: "@alice",
            to: "@brindle",
            text: "hi",
            createdAt: "2026-04-06T00:00:00.000Z",
          },
        ];
      },
      subscribe() {
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "action.received",
              item: {
                type: "action",
                from: "@alice",
                to: "@brindle",
                actionId: "companion.pet",
                createdAt: "2026-04-06T00:00:01.000Z",
              },
            };
          },
        };
      },
      async publishCard(envelope) {
        calls.push(["publishCard", envelope]);
      },
      async clearCard(contractId) {
        calls.push(["clearCard", contractId]);
        return { status: "cleared", contractId, existed: true };
      },
      async readCard(target, contractId) {
        calls.push(["readCard", { target, contractId }]);
        return {
          contractId: "buddy.shared-presence/v1",
          schemaVersion: "1",
          snapshot: { foo: "bar" },
          updatedAt: "2026-04-06T00:00:02.000Z",
        };
      },
    },
  });

  assert.deepEqual(social.getOwnCapabilities(), {
    messages: true,
    supportedActions: ["companion.pet", "companion.coffee"],
    supportedPacks: ["companion"],
    cards: [{ contractId: "buddy.shared-presence/v1", schemaVersion: "1" }],
  });

  await social.follow("@alice");
  await social.sendMessage({ target: "@alice", text: "hello" });
  await social.sendAction({ target: "@alice", actionId: "companion.pet" });
  await social.publishCard({
    contractId: "buddy.shared-presence/v1",
    schemaVersion: "1",
    snapshot: { foo: "bar" },
    updatedAt: "2026-04-06T00:00:03.000Z",
  });
  const cleared = await social.clearCard("buddy.shared-presence/v1");
  assert.equal(cleared.status, "cleared");
  assert.equal(cleared.contractId, "buddy.shared-presence/v1");

  const inbox = await social.listInboxItems();
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].type, "message");

  const iter = social.subscribe("@brindle")[Symbol.asyncIterator]();
  const next = await iter.next();
  assert.equal(next.value.type, "action.received");
  await iter.return?.();

  const envelope = await social.readCard("@alice", "buddy.shared-presence/v1");
  assert.equal(envelope.contractId, "buddy.shared-presence/v1");
  const targetCapabilities = await social.getTargetCapabilities("@alice");
  assert.equal(targetCapabilities.cards[0].contractId, "buddy.shared-presence/v1");
  const connection = await social.getConnectionState();
  assert.equal(connection.status, "ready");

  assert.deepEqual(calls.map((entry) => entry[0]), ["follow", "message", "action", "publishCard", "clearCard", "readCard", "getTargetCapabilities"]);
  assert.equal(calls[4][1], "buddy.shared-presence/v1");
  assert.deepEqual(calls[5][1], {
    target: "@alice",
    contractId: "buddy.shared-presence/v1",
  });
  assert.equal(calls[6][1], "@alice");
});

test("createAspSocial fails fast when card publish is undeclared or transport discovery is unavailable", async () => {
  const social = createAspSocial({
    transport: {
      async getShareUrl() {
        return "https://brindle.asp.social";
      },
      async getConnectionState() {
        return { status: "ready", url: "https://brindle.asp.social" };
      },
      async follow() {},
      async unfollow() {},
      async listFollowing() {
        return [];
      },
      async sendMessage() {},
      async sendAction() {},
      async listInboxItems() {
        return [];
      },
      subscribe() {
        return {
          async *[Symbol.asyncIterator]() {},
        };
      },
      async publishCard() {},
      async clearCard() {},
      async readCard() {
        return null;
      },
    },
  });

  await assert.rejects(
    social.getTargetCapabilities("@alice"),
    /target capability discovery unavailable/,
  );

  await assert.rejects(
    social.publishCard({
      contractId: "buddy.shared-presence/v1",
      schemaVersion: "1",
      snapshot: { foo: "bar" },
      updatedAt: "2026-04-06T00:00:03.000Z",
    }),
    /own capabilities must declare this card contractId before publishCard/,
  );

  await assert.rejects(social.clearCard(), /missing card contractId/);

  assert.equal(await social.readCard("@alice", "buddy.shared-presence/v1"), null);
});
