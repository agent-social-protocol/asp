const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildPresenceSignaturePayload } = require("./contracts/presence-envelope");
const { createAspSocial } = require("./create-asp-social");
const { createAspSocialNodeRuntime } = require("./create-asp-social-node-runtime");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "asp-social-node-runtime-"));
}

function generateAspKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubDer = publicKey.export({ type: "spki", format: "der" });
  return {
    publicKey: `ed25519:${pubDer.toString("base64")}`,
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

function signPayload(payload, privateKeyPem) {
  return sign(null, Buffer.from(payload), privateKeyPem).toString("base64");
}

function createMockAspModule(state) {
  class MockASPClient extends EventEmitter {
    constructor({ identityDir }) {
      super();
      state.identityDir = identityDir;
      state.client = this;
      this.manifest = {
        entity: {
          id: "https://brindle.asp.social",
          handle: "@brindle",
          name: "Brindle",
        },
      };
    }

    async getManifest() {
      return this.manifest;
    }

    async interact(targetUrl, action, opts = undefined) {
      state.interactions.push({ targetUrl, action, opts });
      return { ok: true };
    }

    async whois(targetUrl) {
      return {
        entity: {
          id: targetUrl,
          handle: state.remoteIdentity.handle,
          name: "Alice",
        },
        verification: {
          public_key: state.remoteIdentity.publicKey,
        },
      };
    }

    async sendMessage(targetUrl, payload) {
      state.messagesSent.push({ targetUrl, payload });
      return { ok: true, message: payload };
    }

    async getMessages() {
      return state.inboxMessages;
    }

    async getInteractions() {
      return state.inboxInteractions;
    }

    async connect() {
      state.connectCalls += 1;
    }

    disconnect() {
      state.disconnectCalls += 1;
    }
  }

  return {
    ASPClient: MockASPClient,
    signPayload(payload, privateKeyPem) {
      state.signedPayloads.push({ payload, privateKeyPem });
      return `sig:${payload}`;
    },
  };
}

function makeRuntime(overrides = {}) {
  const identityDir = makeTempDir();
  fs.writeFileSync(path.join(identityDir, "private.pem"), "test-private-key");

  const state = {
    interactions: [],
    messagesSent: [],
    cardWrites: [],
    cardDeletes: [],
    cardReads: [],
    remoteCard: null,
    targetCapabilities: null,
    inboxMessages: [],
    inboxInteractions: [],
    connectCalls: 0,
    disconnectCalls: 0,
    signedPayloads: [],
    remoteIdentity: {
      endpoint: "https://alice.asp.social",
      handle: "@alice",
      ...generateAspKeyPair(),
    },
  };

  const fetchImpl = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const parsedUrl = new URL(url);
    if (method === "PUT") {
      const body = JSON.parse(init.body);
      state.cardWrites.push({
        url: parsedUrl.toString(),
        headers: init.headers,
        body,
      });
      return new Response(JSON.stringify({ status: "published", contractId: body.contractId }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (method === "DELETE") {
      state.cardDeletes.push({
        url: parsedUrl.toString(),
        headers: init.headers,
      });
      return new Response(JSON.stringify({ status: "deleted", contractId: decodeURIComponent(parsedUrl.pathname.split("/").pop() || "") }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (parsedUrl.pathname === "/asp/api/target-capabilities") {
      if (state.targetCapabilities == null) {
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(state.targetCapabilities), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    state.cardReads.push({
      url: parsedUrl.toString(),
      headers: init.headers,
    });
    if (state.remoteCard == null) {
      return new Response(JSON.stringify({ error: "card_not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(state.remoteCard), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const runtime = createAspSocialNodeRuntime({
    identityDir,
    importModule: async () => createMockAspModule(state),
    fetchImpl,
    ...overrides,
  });

  return { runtime, state };
}

test("createAspSocialNodeRuntime exposes share url and ready connection state", async () => {
  const { runtime } = makeRuntime();
  assert.equal(await runtime.getShareUrl(), "https://brindle.asp.social");
  const connection = await runtime.getConnectionState();
  assert.equal(connection.status, "ready");
  assert.equal(connection.url, "https://brindle.asp.social");
});

test("createAspSocialNodeRuntime follows and unfollows with local following persistence", async () => {
  const { runtime, state } = makeRuntime();
  await runtime.followHandle("@alice");
  assert.deepEqual(state.interactions[0], {
    targetUrl: "https://alice.asp.social",
    action: "follow",
    opts: undefined,
  });
  assert.deepEqual(await runtime.listFollowingHandles(), ["@alice"]);

  await runtime.unfollowHandle("@alice");
  assert.deepEqual(state.interactions[1], {
    targetUrl: "https://alice.asp.social",
    action: "unfollow",
    opts: undefined,
  });
  assert.deepEqual(await runtime.listFollowingHandles(), []);
});

test("createAspSocialNodeRuntime implements the transport surface expected by createAspSocial", async () => {
  const { runtime, state } = makeRuntime();
  const social = createAspSocial({
    transport: runtime,
    capabilities: {
      presence: {
        supported: true,
        contractId: "buddy.shared-presence/v1",
      },
    },
  });

  state.targetCapabilities = {
    messages: true,
    supportedActions: [],
    supportedPacks: [],
    presence: {
      supported: true,
      contractId: "buddy.shared-presence/v1",
    },
  };

  await social.follow("@alice");
  await social.sendMessage({ target: "@alice", text: "hello" });
  await social.publishPresence({
    contractId: "buddy.shared-presence/v1",
    snapshot: { mood: "focused" },
    updatedAt: "2026-04-06T00:00:04.000Z",
  });
  await social.clearPresence();
  const peer = await social.getTargetCapabilities("@alice");

  assert.equal(peer.presence.contractId, "buddy.shared-presence/v1");
  assert.equal(state.interactions[0].action, "follow");
  assert.equal(state.messagesSent.length, 1);
  assert.equal(state.cardWrites.length, 1);
  assert.equal(state.cardDeletes.length, 1);
});

test("createAspSocialNodeRuntime publishes and reads presence through card transport", async () => {
  const { runtime, state } = makeRuntime();
  const remoteEnvelope = {
    contractId: "buddy.shared-presence/v1",
    schemaVersion: "1",
    updatedAt: "2026-04-06T00:00:05.000Z",
    snapshot: { status: "focused" },
  };
  state.remoteCard = {
    ...remoteEnvelope,
    signature: signPayload(
      buildPresenceSignaturePayload(remoteEnvelope),
      state.remoteIdentity.privateKey,
    ),
    signedBy: state.remoteIdentity.endpoint,
  };
  state.targetCapabilities = {
    messages: true,
    supportedActions: [],
    supportedPacks: [],
    presence: {
      supported: true,
      contractId: "buddy.shared-presence/v1",
    },
  };

  await runtime.publishPresenceEnvelope({
    contractId: "buddy.shared-presence/v1",
    updatedAt: "2026-04-06T00:00:04.000Z",
    snapshot: {
      publishedStatus: {
        label: "focused",
      },
    },
  });

  assert.equal(state.cardWrites[0].url, "https://brindle.asp.social/asp/api/cards/buddy.shared-presence%2Fv1");
  assert.match(state.cardWrites[0].headers.Authorization, /^ASP-Sig /);
  assert.equal(state.cardWrites[0].body.contractId, "buddy.shared-presence/v1");
  assert.equal(typeof state.cardWrites[0].body.signature, "string");

  const cleared = await runtime.clearPresence("buddy.shared-presence/v1");
  assert.equal(state.cardDeletes[0].url, "https://brindle.asp.social/asp/api/cards/buddy.shared-presence%2Fv1");
  assert.match(state.cardDeletes[0].headers.Authorization, /^ASP-Sig /);
  assert.equal(cleared.status, "deleted");
  assert.equal(cleared.existed, true);

  const envelope = await runtime.readPresenceEnvelope("@alice", "buddy.shared-presence/v1");
  assert.equal(state.cardReads[0].url, "https://alice.asp.social/asp/api/cards/buddy.shared-presence%2Fv1");
  assert.equal(envelope.contractId, "buddy.shared-presence/v1");
  assert.equal(envelope.snapshot.status, "focused");

  const capabilities = await runtime.getTargetCapabilities("@alice");
  assert.equal(capabilities.presence.contractId, "buddy.shared-presence/v1");
});

test("createAspSocialNodeRuntime rejects invalid remote card signatures and missing capability discovery", async () => {
  const { runtime, state } = makeRuntime();
  state.remoteCard = {
    contractId: "buddy.shared-presence/v1",
    schemaVersion: "1",
    updatedAt: "2026-04-06T00:00:05.000Z",
    signature: "invalid",
    signedBy: state.remoteIdentity.endpoint,
    snapshot: { status: "focused" },
  };

  await assert.rejects(
    runtime.readPresenceEnvelope("@alice", "buddy.shared-presence/v1"),
    /invalid presence signature/,
  );

  await assert.rejects(
    runtime.getTargetCapabilities("@alice"),
    /target capability discovery unavailable/,
  );
});

test("createAspSocialNodeRuntime clears missing presence cards idempotently", async () => {
  const { runtime } = makeRuntime({
    fetchImpl: async (url, init = {}) => {
      if ((init.method || "GET").toUpperCase() === "DELETE") {
        return new Response(JSON.stringify({ error: "card_not_found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  });

  const result = await runtime.clearPresence("buddy.shared-presence/v1");
  assert.deepEqual(result, {
    status: "cleared",
    contractId: "buddy.shared-presence/v1",
    existed: false,
  });
});

test("createAspSocialNodeRuntime supports generic message, action, inbox, and realtime transport", async () => {
  const { runtime, state } = makeRuntime();
  state.inboxMessages = [
    {
      id: "msg-1",
      from: "https://alice.asp.social",
      to: "https://brindle.asp.social",
      timestamp: "2026-04-06T00:00:01.000Z",
      content: { text: "hi" },
    },
  ];
  state.inboxInteractions = [
    {
      id: "act-1",
      action: "companion.pet",
      from: "https://alice.asp.social",
      to: "https://brindle.asp.social",
      timestamp: "2026-04-06T00:00:02.000Z",
    },
  ];

  await runtime.sendMessage("@alice", "hello", {
    intent: "buddy.message",
    data: { app: "terminal-buddy" },
  });
  await runtime.sendAction("@alice", "companion.pet");

  assert.equal(state.messagesSent[0].targetUrl, "https://alice.asp.social");
  assert.equal(state.messagesSent[0].payload.text, "hello");
  assert.equal(state.interactions[0].targetUrl, "https://alice.asp.social");
  assert.equal(state.interactions[0].action, "companion.pet");

  const inbox = await runtime.listInboxItems();
  assert.equal(inbox.length, 2);
  assert.equal(inbox[0].type, "action");
  assert.equal(inbox[1].type, "message");

  const stream = runtime.subscribe("https://brindle.asp.social");
  const iterator = stream[Symbol.asyncIterator]();
  const nextPromise = iterator.next();
  await new Promise((resolve) => setImmediate(resolve));
  state.client.emit("interaction", {
    id: "act-2",
    action: "companion.coffee",
    from: "https://bob.asp.social",
    to: "https://brindle.asp.social",
    timestamp: "2026-04-06T00:00:03.000Z",
  });
  const next = await nextPromise;
  assert.equal(next.done, false);
  assert.equal(next.value.type, "action.received");
  assert.equal(next.value.item.actionId, "companion.coffee");

  const presencePromise = iterator.next();
  await new Promise((resolve) => setImmediate(resolve));
  state.client.emit("stream_event", {
    type: "presence.updated",
    ownerId: "https://brindle.asp.social",
    envelope: {
      contractId: "buddy.shared-presence/v1",
      schemaVersion: "1",
      updatedAt: "2026-04-06T00:00:04.000Z",
      snapshot: { mood: "focused" },
    },
  });
  const presenceNext = await presencePromise;
  assert.equal(presenceNext.done, false);
  assert.equal(presenceNext.value.type, "presence.updated");
  assert.equal(presenceNext.value.envelope.contractId, "buddy.shared-presence/v1");

  const deletedPromise = iterator.next();
  await new Promise((resolve) => setImmediate(resolve));
  state.client.emit("stream_event", {
    type: "presence.deleted",
    ownerId: "https://brindle.asp.social",
    contractId: "buddy.shared-presence/v1",
    deletedAt: "2026-04-06T00:00:05.000Z",
  });
  const deletedNext = await deletedPromise;
  assert.equal(deletedNext.done, false);
  assert.equal(deletedNext.value.type, "presence.deleted");
  assert.equal(deletedNext.value.contractId, "buddy.shared-presence/v1");

  await iterator.return();
  assert.equal(state.connectCalls, 1);
  assert.equal(state.disconnectCalls, 1);
});
