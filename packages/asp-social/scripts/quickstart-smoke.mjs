import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageDir, "..", "..");
const aspPackageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const socialPackageJson = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));

function run(command, args, cwd, env = process.env) {
  execFileSync(command, args, { cwd, env, stdio: "pipe" });
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "asp-social-smoke-"));
const packDir = path.join(tempRoot, "packs");
const consumerDir = path.join(tempRoot, "consumer");
const storeDir = path.join(tempRoot, "store");

mkdirSync(packDir, { recursive: true });
mkdirSync(consumerDir, { recursive: true });
mkdirSync(storeDir, { recursive: true });

try {
  run("npm", ["run", "build"], repoRoot);
  run("npm", ["pack", "--pack-destination", packDir], repoRoot);
  run("npm", ["pack", "--pack-destination", packDir], packageDir);

  const aspTarball = path.join(packDir, `asp-protocol-${aspPackageJson.version}.tgz`);
  const socialTarball = path.join(packDir, `asp-social-${socialPackageJson.version}.tgz`);
  assert.ok(existsSync(aspTarball), "missing asp-protocol tarball");
  assert.ok(existsSync(socialTarball), "missing asp-social tarball");

  run("npm", ["init", "-y"], consumerDir);
  run("npm", ["install", aspTarball, socialTarball], consumerDir);

  const aspBin = path.join(consumerDir, "node_modules", ".bin", "asp");
  assert.ok(existsSync(aspBin), "asp CLI not installed");

  run(
    aspBin,
    [
      "init",
      "--name", "Smoke Agent",
      "--handle", "smoke",
      "--bio", "asp-social smoke test",
      "--id", "https://smoke.asp.social",
    ],
    consumerDir,
    {
      ...process.env,
      ASP_STORE_DIR: storeDir,
    },
  );

  const consumerRequire = `
const assert = require("node:assert/strict");
const {
  createAspSocial,
  createAspSocialNodeRuntime,
  companionPack,
} = require("asp-social");

async function main() {
  const { generateKeyPair, createDefaultManifest } = await import("asp-protocol");
  const calls = {
    register: [],
    bootstrap: [],
    inbox: [],
    cards: [],
    deletes: [],
    capabilities: 0,
  };
  const remoteKeys = generateKeyPair();
  const remoteManifest = createDefaultManifest({
    id: "https://alice.asp.social",
    type: "agent",
    name: "Alice",
    handle: "@alice",
    bio: "Remote smoke target",
    languages: ["en"],
    publicKey: remoteKeys.publicKey,
  });

  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(url);
    const method = (init.method || "GET").toUpperCase();

    if (target.pathname === "/.well-known/asp.yaml") {
      return new Response(JSON.stringify(remoteManifest), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (target.pathname === "/api/register" && method === "POST") {
      calls.register.push({
        url: target.toString(),
        headers: init.headers,
        body: JSON.parse(init.body),
      });
      return new Response(JSON.stringify({
        status: "registered",
        endpoint: "https://smoke.asp.social",
        handle: "smoke",
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (target.pathname === "/api/sdk/bootstrap" && method === "POST") {
      const body = JSON.parse(init.body);
      calls.bootstrap.push({
        url: target.toString(),
        headers: init.headers,
        body,
      });
      return new Response(JSON.stringify({
        status: "bootstrapped",
        handle: "smoke",
        installId: body.installId,
        appId: body.appId,
        runtime: body.runtime,
        sdkVersion: body.sdkVersion,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (target.pathname === "/asp/inbox" && method === "POST") {
      calls.inbox.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (target.pathname === "/asp/api/target-capabilities" && method === "GET") {
      calls.capabilities += 1;
      return new Response(JSON.stringify({
        messages: true,
        supportedActions: ["companion.pet"],
        supportedPacks: ["companion"],
        cards: [{ contractId: "status/v1", schemaVersion: "1" }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (target.pathname === "/asp/api/cards/status%2Fv1" && method === "PUT") {
      calls.cards.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ status: "published", contractId: "status/v1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (target.pathname === "/asp/api/cards/status%2Fv1" && method === "DELETE") {
      calls.deletes.push({ url: target.toString() });
      return new Response(JSON.stringify({ status: "deleted", contractId: "status/v1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error("unexpected fetch: " + method + " " + target.toString());
  };

  const social = createAspSocial({
    transport: createAspSocialNodeRuntime({
      identityDir: process.env.ASP_STORE_DIR,
      fetchImpl: globalThis.fetch,
    }),
    packs: [companionPack],
    capabilities: {
      cards: [{ contractId: "status/v1", schemaVersion: "1" }],
    },
  });

  assert.equal(typeof social.follow, "function");
  assert.equal(typeof social.publishCard, "function");
  assert.deepEqual(social.getOwnCapabilities().cards, [{ contractId: "status/v1", schemaVersion: "1" }]);

  await social.follow("@alice");
  await social.sendMessage({ target: "@alice", text: "hello" });
  await social.sendAction({ target: "@alice", actionId: "companion.pet" });
  await social.publishCard({
    contractId: "status/v1",
    schemaVersion: "1",
    snapshot: { availability: "focused" },
    updatedAt: new Date().toISOString(),
  });
  await social.clearCard("status/v1");

  const peer = await social.getTargetCapabilities("@alice");
  assert.equal(peer.cards[0].contractId, "status/v1");
  assert.equal(calls.capabilities, 1);
  assert.equal(calls.register.length, 1);
  assert.equal(calls.register[0].body.handle, "smoke");
  assert.equal(calls.register[0].body.public_key.startsWith("ed25519:"), true);
  assert.equal(calls.bootstrap.length, 1);
  assert.equal(typeof calls.bootstrap[0].body.installId, "string");
  assert.equal(calls.bootstrap[0].body.appId, "consumer");
  assert.equal(calls.bootstrap[0].body.runtime, "node");
  assert.equal(typeof calls.bootstrap[0].headers.Authorization, "string");
  assert.equal(calls.inbox.length, 3);
  assert.equal(calls.cards.length, 1);
  assert.equal(typeof calls.cards[0].signature, "string");
  assert.equal(calls.deletes.length, 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

  const consumerImport = `
import assert from "node:assert/strict";
import {
  COMPANION_ACTION_IDS,
  COMPANION_PACK_ID,
  companionPack,
  createAspSocial,
  createAspSocialNodeRuntime,
} from "asp-social";
import * as cardEnvelopeDraft from "asp-social/draft/card-envelope";
import * as targetCapabilitiesDraft from "asp-social/draft/target-capabilities";

assert.equal(typeof createAspSocial, "function");
assert.equal(typeof createAspSocialNodeRuntime, "function");
assert.equal(COMPANION_PACK_ID, "companion");
assert.deepEqual(COMPANION_ACTION_IDS, ["companion.pet", "companion.coffee"]);
assert.equal(companionPack.id, "companion");
assert.equal(typeof cardEnvelopeDraft.buildCardSignaturePayload, "function");
assert.equal(typeof targetCapabilitiesDraft.normalizeTargetCapabilities, "function");
`;

  const requireScriptPath = path.join(consumerDir, "smoke-require.cjs");
  const importScriptPath = path.join(consumerDir, "smoke-import.mjs");
  writeFileSync(requireScriptPath, consumerRequire);
  writeFileSync(importScriptPath, consumerImport);

  run(process.execPath, [requireScriptPath], consumerDir, {
    ...process.env,
    ASP_STORE_DIR: storeDir,
  });
  run(process.execPath, [importScriptPath], consumerDir, {
    ...process.env,
    ASP_STORE_DIR: storeDir,
  });

  const followingYaml = readFileSync(path.join(storeDir, "following.yaml"), "utf8");
  assert.match(followingYaml, /alice/);

  writeJson(path.join(tempRoot, "result.json"), {
    status: "ok",
    consumerDir,
  });
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
