const fs = require("fs");
const os = require("os");
const path = require("path");
const { mkdir, readFile, writeFile } = require("fs/promises");
const { pathToFileURL } = require("url");
const { createPublicKey, verify } = require("node:crypto");
const yaml = require("js-yaml");
const packageMetadata = require("./package.json");

const { normalizeString } = require("./contracts/common");
const { buildCardSignaturePayload, normalizeCardEnvelope } = require("./contracts/card-envelope");
const { normalizeInboxItem } = require("./contracts/inbox-item");
const { normalizeRealtimeEvent } = require("./contracts/realtime-event");
const { normalizeTargetCapabilities } = require("./contracts/target-capabilities");

const DEFAULT_ASP_IDENTITY_DIR = process.env.ASP_STORE_DIR || path.join(os.homedir(), ".asp");
const WORKSPACE_ASP_PROTOCOL_ENTRY = path.join(__dirname, "..", "..", "dist", "src", "index.js");
const CARD_API_PREFIX = "/asp/api/cards/";
const TARGET_CAPABILITIES_API_PATH = "/asp/api/target-capabilities";
const HOSTED_REGISTER_API_PATH = "/api/register";
const SDK_BOOTSTRAP_API_PATH = "/api/sdk/bootstrap";
const SDK_INSTALL_STATE_PATH = path.join(".runtime", "sdk-install.json");
const SDK_RUNTIME_LABEL = "node";
const SDK_VERSION = typeof packageMetadata?.version === "string" && packageMetadata.version.trim() !== ""
  ? packageMetadata.version.trim()
  : "0.0.0";

function normalizeIdentityDir(identityDir) {
  const normalized = normalizeString(identityDir);
  return normalized || DEFAULT_ASP_IDENTITY_DIR;
}

function normalizeAccountIdentifier(target) {
  const normalized = normalizeString(target);
  if (!normalized || normalized.includes("://") || normalized.includes("/")) {
    return null;
  }

  const qualifiedHandle = normalized.match(/^@([^@\s]+)@([^@\s/]+)$/);
  if (qualifiedHandle) {
    return `${qualifiedHandle[1]}@${qualifiedHandle[2].toLowerCase()}`;
  }

  const account = normalized.match(/^([^@\s]+)@([^@\s/]+)$/);
  if (account) {
    return `${account[1]}@${account[2].toLowerCase()}`;
  }

  return null;
}

function splitAccountIdentifier(account) {
  const normalized = normalizeAccountIdentifier(account);
  if (!normalized) {
    return null;
  }

  const atIndex = normalized.indexOf("@");
  if (atIndex === -1) {
    return null;
  }

  return {
    username: normalized.slice(0, atIndex),
    domain: normalized.slice(atIndex + 1),
  };
}

function accountDomainOrigin(domain) {
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(domain)) {
    return `http://${domain}`;
  }
  return `https://${domain}`;
}

function buildHostedEndpoint(handle, hostedDomain = "asp.social") {
  const normalized = normalizeString(handle);
  if (!normalized) {
    throw new Error("missing hosted handle");
  }
  return `https://${normalized.replace(/^@/, "")}.${hostedDomain}`;
}

function firstValidUrl(values) {
  for (const value of values || []) {
    const normalized = normalizeString(value);
    if (!normalized) {
      continue;
    }
    try {
      return new URL(normalized).toString().replace(/\/+$/, "");
    } catch {
      continue;
    }
  }
  return null;
}

function buildCardPath(contractId) {
  return `${CARD_API_PREFIX}${encodeURIComponent(contractId)}`;
}

function buildEndpointUrl(baseUrl, pathname) {
  const normalizedBaseUrl = normalizeString(baseUrl);
  if (!normalizedBaseUrl) {
    throw new Error("missing endpoint url");
  }
  return new URL(pathname, `${normalizedBaseUrl.replace(/\/+$/, "")}/`).toString();
}

function looksLikeHostedEndpoint(endpoint, hostedHandleDomain) {
  const normalizedEndpoint = normalizeString(endpoint);
  const normalizedDomain = normalizeString(hostedHandleDomain);
  if (!normalizedEndpoint || !normalizedDomain) {
    return false;
  }

  try {
    const hostname = new URL(normalizedEndpoint).hostname.toLowerCase();
    const domain = normalizedDomain.toLowerCase();
    return hostname.endsWith(`.${domain}`) && hostname !== domain;
  } catch {
    return false;
  }
}

function normalizeHandle(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.replace(/^@/, "") : null;
}

function resolveHostedApiBaseUrl(explicitUrl, hostedHandleDomain) {
  const explicit = normalizeString(explicitUrl) || normalizeString(process.env.ASP_HUB_API_URL);
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  return `${accountDomainOrigin(hostedHandleDomain)}/api`;
}

function findPackageJsonName(startDir) {
  let current = normalizeString(startDir) || process.cwd();
  while (current) {
    const packageJsonPath = path.join(current, "package.json");
    try {
      const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const name = normalizeString(parsed?.name);
      if (name) {
        return name;
      }
    } catch {
      // Ignore missing or invalid package.json and keep walking.
    }

    const parent = path.dirname(current);
    if (!parent || parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function resolveAppId(explicitAppId) {
  const candidates = [
    normalizeString(explicitAppId),
    normalizeString(process.env.ASP_SOCIAL_APP_ID),
    normalizeString(process.env.npm_package_name),
    findPackageJsonName(process.cwd()),
  ];
  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }
  return "unknown";
}

function deriveHostedHandle(manifest, hostedHandleDomain) {
  const handleFromManifest = normalizeHandle(manifest?.entity?.handle);
  if (handleFromManifest) {
    return handleFromManifest;
  }

  const endpoint = normalizeString(manifest?.entity?.id);
  if (!looksLikeHostedEndpoint(endpoint, hostedHandleDomain)) {
    return null;
  }

  try {
    const hostname = new URL(endpoint).hostname;
    const suffix = `.${hostedHandleDomain.toLowerCase()}`;
    return hostname.toLowerCase().slice(0, -suffix.length);
  } catch {
    return null;
  }
}

function verifyPayloadSignature(payload, signatureB64, publicKey) {
  const normalizedPublicKey = normalizeString(publicKey);
  if (!normalizedPublicKey || !normalizedPublicKey.startsWith("ed25519:")) {
    throw new Error("invalid ASP public key");
  }
  const normalizedSignature = normalizeString(signatureB64);
  if (!normalizedSignature) {
    return false;
  }

  const der = Buffer.from(normalizedPublicKey.slice("ed25519:".length), "base64");
  const key = createPublicKey({ key: der, format: "der", type: "spki" });
  return verify(null, Buffer.from(payload), key, Buffer.from(normalizedSignature, "base64"));
}

function normalizeRemoteIdentity(manifest, fallbackEndpoint = null) {
  const endpoint = normalizeString(manifest?.entity?.id) || normalizeString(fallbackEndpoint);
  const publicKey = normalizeString(manifest?.verification?.public_key);
  const rawHandle = normalizeString(manifest?.entity?.handle);
  if (!endpoint) {
    throw new Error("target manifest missing entity.id");
  }
  if (!publicKey) {
    throw new Error("target manifest missing verification.public_key");
  }

  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    handle: rawHandle ? (rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`) : null,
    publicKey,
  };
}

function matchesSignedByIdentity(candidate, identity) {
  const normalized = normalizeString(candidate);
  if (!normalized) {
    return true;
  }
  if (normalized === identity.endpoint) {
    return true;
  }
  return Boolean(identity.handle && normalized === identity.handle);
}

async function readErrorMessage(response) {
  const prefix = `HTTP ${response.status}`;
  try {
    const contentType = response.headers?.get?.("content-type") || "";
    if (contentType.includes("json")) {
      const data = await response.json();
      if (typeof data?.error === "string" && data.error) {
        return `${prefix}: ${data.error}`;
      }
    }
    const text = await response.text();
    if (normalizeString(text)) {
      return `${prefix}: ${text.trim()}`;
    }
  } catch {
    // Ignore parse failures and fall back to the status line.
  }
  return prefix;
}

function extractEndpointFromWebFinger(document) {
  if (!document || typeof document !== "object") {
    return null;
  }

  const links = Array.isArray(document.links) ? document.links.filter((value) => value && typeof value === "object") : [];
  const endpointLink = firstValidUrl(
    links
      .filter((link) => link.rel === "urn:asp:rel:endpoint")
      .map((link) => link.href)
  );
  if (endpointLink) {
    return endpointLink;
  }

  const selfLink = firstValidUrl(
    links
      .filter((link) => link.rel === "self")
      .map((link) => link.href)
  );
  if (selfLink) {
    return selfLink;
  }

  const alias = firstValidUrl(Array.isArray(document.aliases) ? document.aliases : []);
  if (alias) {
    return alias;
  }

  return firstValidUrl(
    links
      .filter((link) => link.rel === "describedby")
      .map((link) => link.href)
  );
}

async function discoverAccountEndpoint(account) {
  const parts = splitAccountIdentifier(account);
  if (!parts) {
    return { status: "not_found" };
  }

  const webfingerUrl = new URL("/.well-known/webfinger", accountDomainOrigin(parts.domain));
  webfingerUrl.searchParams.set("resource", `acct:${parts.username}@${parts.domain}`);

  let response;
  try {
    response = await fetch(webfingerUrl, {
      headers: {
        Accept: "application/jrd+json, application/json",
      },
    });
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }

  if (response.status === 404) {
    return { status: "not_found" };
  }
  if (!response.ok) {
    return { status: "error", error: `HTTP ${response.status}` };
  }

  let document;
  try {
    document = await response.json();
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : "Invalid WebFinger JSON" };
  }

  const endpoint = extractEndpointFromWebFinger(document);
  if (!endpoint) {
    return { status: "error", error: "WebFinger response missing endpoint" };
  }
  return { status: "resolved", endpoint };
}

async function importAspProtocol() {
  try {
    return await import("asp-protocol");
  } catch (error) {
    if (fs.existsSync(WORKSPACE_ASP_PROTOCOL_ENTRY)) {
      return import(pathToFileURL(WORKSPACE_ASP_PROTOCOL_ENTRY).href);
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `asp-social node runtime requires asp-protocol. Install asp-protocol or build this repo first. ${reason}`,
    );
  }
}

function deriveActorLabel(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "Unknown";
  }

  if (normalized.startsWith("@")) {
    return normalized;
  }

  try {
    const url = new URL(normalized);
    const handle = normalizeString(url.hostname.split(".")[0]);
    return handle ? `@${handle}` : normalized;
  } catch {
    return normalized;
  }
}

function normalizeFollowingEntry(entry) {
  const url = normalizeString(entry?.url);
  if (!url) {
    return null;
  }

  return {
    url,
    name: normalizeString(entry?.name) || null,
    handle: normalizeString(entry?.handle) || null,
    added: normalizeString(entry?.added) || new Date().toISOString(),
    created_by: entry?.created_by === "human" ? "human" : "agent",
  };
}

function formatFollowingTarget(entry) {
  const handle = normalizeString(entry?.handle);
  if (handle) {
    return handle.startsWith("@") ? handle : `@${handle}`;
  }
  return normalizeString(entry?.url);
}

class AspSocialNodeRuntime {
  constructor({
    identityDir = DEFAULT_ASP_IDENTITY_DIR,
    importModule = importAspProtocol,
    hostedHandleDomain = "asp.social",
    hubApiBaseUrl = null,
    appId = null,
    installId = null,
    fetchImpl = globalThis.fetch.bind(globalThis),
  } = {}) {
    this.identityDir = normalizeIdentityDir(identityDir);
    this.importModule = importModule;
    this.hostedHandleDomain = normalizeString(hostedHandleDomain) || "asp.social";
    this.hubApiBaseUrl = resolveHostedApiBaseUrl(hubApiBaseUrl, this.hostedHandleDomain);
    this.appId = resolveAppId(appId);
    this.installId = normalizeString(installId);
    this.fetchImpl = fetchImpl;
    this.modulePromise = null;
    this.clientPromise = null;
    this.privateKeyPromise = null;
    this.hostedRegistrationPromise = null;
    this.hostedBootstrapPromise = null;
  }

  async getModule() {
    if (!this.modulePromise) {
      this.modulePromise = Promise.resolve()
        .then(() => this.importModule())
        .then((mod) => {
          if (!mod || typeof mod.ASPClient !== "function") {
            throw new Error("invalid asp-protocol module");
          }
          return mod;
        });
    }
    return this.modulePromise;
  }

  async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = this.getModule().then((mod) => new mod.ASPClient({ identityDir: this.identityDir }));
    }
    return this.clientPromise;
  }

  async getManifest() {
    const client = await this.getClient();
    return client.getManifest();
  }

  async getPrivateKey() {
    if (!this.privateKeyPromise) {
      this.privateKeyPromise = readFile(path.join(this.identityDir, "private.pem"), "utf-8")
        .then((value) => {
          const normalized = normalizeString(value);
          if (!normalized) {
            throw new Error("private.pem is empty");
          }
          return normalized;
        });
    }
    return this.privateKeyPromise;
  }

  async #getHostedContext() {
    const manifest = await this.getManifest();
    const endpoint = normalizeString(manifest?.entity?.id);
    if (!looksLikeHostedEndpoint(endpoint, this.hostedHandleDomain)) {
      return null;
    }

    const handle = deriveHostedHandle(manifest, this.hostedHandleDomain);
    const publicKey = normalizeString(manifest?.verification?.public_key);
    if (!endpoint || !handle || !publicKey) {
      throw new Error("hosted bootstrap requires manifest.entity.id, entity.handle, and verification.public_key");
    }

    return {
      handle,
      endpoint: endpoint.replace(/\/+$/, ""),
      publicKey,
      manifest,
      apiBaseUrl: this.hubApiBaseUrl,
    };
  }

  async #ensureHostedIdentityRegistered() {
    const context = await this.#getHostedContext();
    if (!context) {
      return { status: "self_hosted" };
    }

    if (!this.hostedRegistrationPromise) {
      this.hostedRegistrationPromise = (async () => {
        const response = await this.fetchImpl(buildEndpointUrl(context.apiBaseUrl, HOSTED_REGISTER_API_PATH), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            handle: context.handle,
            manifest: context.manifest,
            public_key: context.publicKey,
          }),
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }
        return response.json();
      })().catch((error) => {
        this.hostedRegistrationPromise = null;
        throw error;
      });
    }

    return this.hostedRegistrationPromise;
  }

  async #resolveInstallIdentity() {
    if (this.installId) {
      return {
        installId: this.installId,
        appId: this.appId,
        sdkVersion: SDK_VERSION,
        runtime: SDK_RUNTIME_LABEL,
      };
    }

    const filePath = path.join(this.identityDir, SDK_INSTALL_STATE_PATH);
    await mkdir(path.dirname(filePath), { recursive: true });
    const raw = await readFile(filePath, "utf8").catch((error) => {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    });

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const installId = normalizeString(parsed?.installId);
        if (installId) {
          return {
            installId,
            appId: this.appId,
            sdkVersion: SDK_VERSION,
            runtime: SDK_RUNTIME_LABEL,
          };
        }
      } catch {
        // Fall through and rewrite a clean install state.
      }
    }

    const installState = {
      installId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await writeFile(filePath, JSON.stringify(installState, null, 2) + "\n", "utf8");

    return {
      installId: installState.installId,
      appId: this.appId,
      sdkVersion: SDK_VERSION,
      runtime: SDK_RUNTIME_LABEL,
    };
  }

  async #ensureHostedInstallBootstrapped() {
    const context = await this.#getHostedContext();
    if (!context) {
      return { status: "self_hosted" };
    }

    if (!this.hostedBootstrapPromise) {
      this.hostedBootstrapPromise = (async () => {
        const install = await this.#resolveInstallIdentity();
        const pathname = SDK_BOOTSTRAP_API_PATH;
        const response = await this.fetchImpl(buildEndpointUrl(context.apiBaseUrl, pathname), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: await this.#buildAuthHeader("POST", pathname),
          },
          body: JSON.stringify(install),
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }
        return response.json();
      })().catch((error) => {
        this.hostedBootstrapPromise = null;
        throw error;
      });
    }

    return this.hostedBootstrapPromise;
  }

  async #ensureHostedReadyForMutation() {
    const context = await this.#getHostedContext();
    if (!context) {
      return;
    }

    await this.#ensureHostedIdentityRegistered();
    try {
      await this.#ensureHostedInstallBootstrapped();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[asp-social] sdk bootstrap skipped: ${message}`);
    }
  }

  async getShareUrl() {
    const manifest = await this.getManifest();
    return normalizeString(manifest?.entity?.id);
  }

  async getConnectionState() {
    try {
      const url = await this.getShareUrl();
      return url
        ? { status: "ready", url }
        : { status: "connect_required" };
    } catch (error) {
      return {
        status: "connect_required",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getTargetCapabilities(target) {
    const targetIdentity = await this.#loadTargetIdentity(target);
    const response = await this.fetchImpl(buildEndpointUrl(targetIdentity.endpoint, TARGET_CAPABILITIES_API_PATH), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    if (response.status === 404) {
      throw new Error("target capability discovery unavailable");
    }
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const normalized = normalizeTargetCapabilities(await response.json());
    if (!normalized.ok) {
      throw new Error(normalized.error);
    }
    return normalized.value;
  }

  async resolveTarget(target) {
    const normalized = normalizeString(target);
    if (!normalized) {
      throw new Error("missing target");
    }
    if (normalized.startsWith("https://") || normalized.startsWith("http://")) {
      return normalized.replace(/\/+$/, "");
    }

    const account = normalizeAccountIdentifier(normalized);
    if (account) {
      const discovered = await discoverAccountEndpoint(account);
      if (discovered.status === "resolved") {
        return discovered.endpoint;
      }
      if (discovered.status === "error") {
        throw new Error(`Could not resolve ${account}: ${discovered.error}`);
      }

      const parts = splitAccountIdentifier(account);
      if (!parts) {
        throw new Error(`Could not resolve ${account}`);
      }
      if (parts.domain === this.hostedHandleDomain) {
        return buildHostedEndpoint(parts.username, parts.domain);
      }
      return accountDomainOrigin(parts.domain);
    }

    if (normalized.startsWith("@")) {
      return buildHostedEndpoint(normalized, this.hostedHandleDomain);
    }
    if (normalized.includes(".")) {
      return `https://${normalized}`;
    }
    return buildHostedEndpoint(normalized, this.hostedHandleDomain);
  }

  async followHandle(handle) {
    await this.#ensureHostedReadyForMutation();
    const targetUrl = await this.resolveTarget(handle);
    const client = await this.getClient();
    const result = await client.interact(targetUrl, "follow");
    if (!result?.ok) {
      throw new Error(result?.error || "ASP follow failed");
    }

    let manifest = null;
    try {
      manifest = await client.whois(targetUrl);
    } catch {
      manifest = null;
    }

    await this.#upsertFollowingEntry({
      url: targetUrl,
      name: normalizeString(manifest?.entity?.name) || null,
      handle: normalizeString(manifest?.entity?.handle) || null,
      added: new Date().toISOString(),
      created_by: "agent",
    });
    return targetUrl;
  }

  async follow(target) {
    return this.followHandle(target);
  }

  async unfollowHandle(handle) {
    await this.#ensureHostedReadyForMutation();
    const targetUrl = await this.resolveTarget(handle);
    const client = await this.getClient();
    const result = await client.interact(targetUrl, "unfollow");
    if (!result?.ok) {
      throw new Error(result?.error || "ASP unfollow failed");
    }
    await this.#removeFollowingEntry(targetUrl);
    return targetUrl;
  }

  async unfollow(target) {
    return this.unfollowHandle(target);
  }

  async listFollowingHandles() {
    const entries = await this.#readFollowingEntries();
    return entries
      .map(formatFollowingTarget)
      .filter((value) => Boolean(value));
  }

  async listFollowing() {
    return this.listFollowingHandles();
  }

  async publishCardEnvelope(envelope) {
    await this.#ensureHostedReadyForMutation();
    const normalized = normalizeCardEnvelope(envelope);
    if (!normalized.ok) {
      throw new Error(normalized.error);
    }

    const signedEnvelope = await this.#signCardEnvelope(normalized.value);
    const shareUrl = await this.getShareUrl();
    if (!shareUrl) {
      throw new Error("missing hosted endpoint");
    }

    const pathname = buildCardPath(signedEnvelope.contractId);
    const response = await this.fetchImpl(buildEndpointUrl(shareUrl, pathname), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: await this.#buildAuthHeader("PUT", pathname),
      },
      body: JSON.stringify(signedEnvelope),
    });
    if (response.status === 404) {
      throw new Error("card publish unavailable for this endpoint");
    }
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    return await response.json();
  }

  async publishCard(envelope) {
    return this.publishCardEnvelope(envelope);
  }

  async clearCard(contractId = null) {
    await this.#ensureHostedReadyForMutation();
    const normalizedContractId = normalizeString(contractId);
    if (!normalizedContractId) {
      throw new Error("missing card contractId");
    }

    const shareUrl = await this.getShareUrl();
    if (!shareUrl) {
      throw new Error("missing hosted endpoint");
    }

    const pathname = buildCardPath(normalizedContractId);
    const response = await this.fetchImpl(buildEndpointUrl(shareUrl, pathname), {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: await this.#buildAuthHeader("DELETE", pathname),
      },
    });

    if (response.status === 404) {
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (body?.error === "card_not_found") {
        return {
          status: "cleared",
          contractId: normalizedContractId,
          existed: false,
        };
      }
      throw new Error("card clear unavailable for this endpoint");
    }

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    return {
      existed: true,
      ...(await response.json()),
    };
  }

  async readCardEnvelope(target, contractId = null) {
    const normalizedContractId = normalizeString(contractId);
    if (!normalizedContractId) {
      throw new Error("missing card contractId");
    }

    const targetIdentity = await this.#loadTargetIdentity(target);
    const pathname = buildCardPath(normalizedContractId);
    const response = await this.fetchImpl(buildEndpointUrl(targetIdentity.endpoint, pathname), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (response.status === 404 || response.status === 410) {
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (body?.error === "card_not_found" || body?.error === "card_expired") {
        return null;
      }
      if (response.status === 404) {
        throw new Error("card read unavailable for target endpoint");
      }
    }
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const normalized = normalizeCardEnvelope(await response.json());
    if (!normalized.ok) {
      throw new Error(normalized.error);
    }
    const envelope = normalized.value;
    if (envelope.contractId !== normalizedContractId) {
      throw new Error("card contractId mismatch");
    }
    if (!normalizeString(envelope.signature)) {
      throw new Error("missing card signature");
    }
    if (!matchesSignedByIdentity(envelope.signedBy, targetIdentity)) {
      throw new Error("card signedBy mismatch");
    }

    const validSignature = verifyPayloadSignature(
      buildCardSignaturePayload(envelope),
      envelope.signature,
      targetIdentity.publicKey,
    );
    if (!validSignature) {
      throw new Error("invalid card signature");
    }
    return envelope;
  }

  async readCard(target, contractId = null) {
    return this.readCardEnvelope(target, contractId);
  }

  async sendMessage(targetOrInput, text = null, metadata = null) {
    await this.#ensureHostedReadyForMutation();
    const input = targetOrInput && typeof targetOrInput === "object"
      ? targetOrInput
      : { target: targetOrInput, text, metadata };
    const normalizedTarget = normalizeString(input?.target);
    const normalizedText = normalizeString(input?.text);
    if (!normalizedTarget) {
      throw new Error("missing message target");
    }
    if (!normalizedText) {
      throw new Error("missing message text");
    }

    const targetUrl = await this.resolveTarget(normalizedTarget);
    const client = await this.getClient();
    const result = await client.sendMessage(targetUrl, {
      intent: normalizeString(input?.metadata?.intent) || "social.message",
      text: normalizedText,
      data:
        input?.metadata && typeof input.metadata === "object" && input.metadata.data && typeof input.metadata.data === "object"
          ? { ...input.metadata.data }
          : {},
    });
    if (!result?.ok) {
      throw new Error(result?.error || "ASP message delivery failed");
    }
    return result;
  }

  async sendAction(targetOrInput, actionId = null, payload = null, metadata = null) {
    await this.#ensureHostedReadyForMutation();
    const input = targetOrInput && typeof targetOrInput === "object"
      ? targetOrInput
      : { target: targetOrInput, actionId, payload, metadata };
    const normalizedTarget = normalizeString(input?.target);
    const normalizedActionId = normalizeString(input?.actionId);
    if (!normalizedTarget) {
      throw new Error("missing action target");
    }
    if (!normalizedActionId) {
      throw new Error("missing actionId");
    }
    if (input?.payload != null) {
      throw new Error("ASP action transport does not support payload");
    }
    if (input?.metadata != null) {
      throw new Error("ASP action transport does not support metadata");
    }

    const targetUrl = await this.resolveTarget(normalizedTarget);
    const client = await this.getClient();
    const result = await client.interact(targetUrl, normalizedActionId);
    if (!result?.ok) {
      throw new Error(result?.error || `ASP ${normalizedActionId} delivery failed`);
    }
    return result;
  }

  async listInboxItems() {
    const client = await this.getClient();
    const ownEndpoint = await this.getShareUrl();
    const [messages, interactions] = await Promise.all([
      client.getMessages(),
      client.getInteractions(),
    ]);

    const items = [];

    for (const message of messages) {
      const text = normalizeString(message?.content?.text);
      const from = normalizeString(message?.from);
      if (!text || !from) {
        continue;
      }
      const normalized = normalizeInboxItem({
        type: "message",
        id: normalizeString(message?.id) || null,
        from,
        fromLabel: deriveActorLabel(from),
        to: ownEndpoint || normalizeString(message?.to) || null,
        text,
        createdAt: message.timestamp,
      });
      if (!normalized.ok) {
        throw new Error(normalized.error);
      }
      items.push(normalized.value);
    }

    for (const interaction of interactions) {
      const actionId = normalizeString(interaction?.action);
      const from = normalizeString(interaction?.from);
      if (!actionId || !from) {
        continue;
      }
      const normalized = normalizeInboxItem({
        type: "action",
        id: normalizeString(interaction?.id) || null,
        from,
        fromLabel: deriveActorLabel(from),
        to: ownEndpoint || normalizeString(interaction?.to) || null,
        actionId,
        payload: null,
        createdAt: interaction.timestamp,
      });
      if (!normalized.ok) {
        throw new Error(normalized.error);
      }
      items.push(normalized.value);
    }

    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return items;
  }

  subscribe(ownerId = null) {
    const self = this;
    const requestedOwnerId = normalizeString(ownerId) || null;

    return {
      [Symbol.asyncIterator]() {
        let queue = [];
        let waiters = [];
        let cleanup = null;
        let closed = false;
        let pendingError = null;
        let initPromise = null;

        const push = (event) => {
          if (!event || closed) {
            return;
          }
          if (waiters.length > 0) {
            const waiter = waiters.shift();
            waiter.resolve({ value: event, done: false });
            return;
          }
          queue.push(event);
        };

        const fail = (error) => {
          pendingError = error instanceof Error ? error : new Error(String(error));
          while (waiters.length > 0) {
            const waiter = waiters.shift();
            waiter.reject(pendingError);
          }
        };

        const teardown = () => {
          if (cleanup) {
            cleanup();
            cleanup = null;
          }
        };

        const ensureStarted = async () => {
          if (initPromise) {
            return initPromise;
          }

          initPromise = (async () => {
            const client = await self.getClient();
            const ownEndpoint = await self.getShareUrl();
            if (requestedOwnerId && ownEndpoint && requestedOwnerId !== ownEndpoint) {
              throw new Error("ASP realtime subscribe only supports the current ASP identity");
            }

            await client.connect?.();

            const onMessage = (message) => {
              const text = normalizeString(message?.content?.text);
              const from = normalizeString(message?.from);
              if (!text || !from) {
                return;
              }
              const normalized = normalizeRealtimeEvent({
                type: "message.received",
                item: {
                  type: "message",
                  id: normalizeString(message?.id) || null,
                  from,
                  fromLabel: deriveActorLabel(from),
                  to: ownEndpoint || normalizeString(message?.to) || null,
                  text,
                  createdAt: message.timestamp,
                },
              });
              if (!normalized.ok) {
                fail(new Error(normalized.error));
                return;
              }
              push(normalized.value);
            };

            const onInteraction = (interaction) => {
              const actionId = normalizeString(interaction?.action);
              const from = normalizeString(interaction?.from);
              if (!actionId || !from) {
                return;
              }
              const normalized = normalizeRealtimeEvent({
                type: "action.received",
                item: {
                  type: "action",
                  id: normalizeString(interaction?.id) || null,
                  from,
                  fromLabel: deriveActorLabel(from),
                  to: ownEndpoint || normalizeString(interaction?.to) || null,
                  actionId,
                  payload: null,
                  createdAt: interaction.timestamp,
                },
              });
              if (!normalized.ok) {
                fail(new Error(normalized.error));
                return;
              }
              push(normalized.value);
            };

            const onStreamEvent = (event) => {
              if (!event || (event.type !== "card.updated" && event.type !== "card.deleted")) {
                return;
              }
              const normalized = normalizeRealtimeEvent(event);
              if (!normalized.ok) {
                fail(new Error(normalized.error));
                return;
              }
              push(normalized.value);
            };

            client.on("message", onMessage);
            client.on("interaction", onInteraction);
            client.on("stream_event", onStreamEvent);
            cleanup = () => {
              client.off?.("message", onMessage);
              client.off?.("interaction", onInteraction);
              client.off?.("stream_event", onStreamEvent);
              client.disconnect?.();
            };
          })().catch((error) => {
            fail(error);
            throw error;
          });

          return initPromise;
        };

        return {
          async next() {
            if (closed) {
              return { value: undefined, done: true };
            }
            if (pendingError) {
              throw pendingError;
            }
            if (queue.length > 0) {
              return { value: queue.shift(), done: false };
            }

            await ensureStarted();
            if (pendingError) {
              throw pendingError;
            }
            if (queue.length > 0) {
              return { value: queue.shift(), done: false };
            }
            return new Promise((resolve, reject) => {
              waiters.push({ resolve, reject });
            });
          },

          async return() {
            closed = true;
            teardown();
            while (waiters.length > 0) {
              const waiter = waiters.shift();
              waiter.resolve({ value: undefined, done: true });
            }
            queue = [];
            return { value: undefined, done: true };
          },

          async throw(error) {
            closed = true;
            teardown();
            throw error;
          },
        };
      },
    };
  }

  async #readFollowingEntries() {
    const raw = await readFile(this.#followingPath(), "utf8").catch((error) => {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    });
    if (!raw) {
      return [];
    }
    let parsed;
    try {
      parsed = yaml.load(raw);
    } catch (error) {
      throw new Error(`invalid following.yaml: ${error instanceof Error ? error.message : String(error)}`);
    }
    const following = Array.isArray(parsed?.following) ? parsed.following : [];
    return following
      .map(normalizeFollowingEntry)
      .filter((entry) => entry !== null);
  }

  async #writeFollowingEntries(entries) {
    const normalizedEntries = entries
      .map(normalizeFollowingEntry)
      .filter((entry) => entry !== null);

    const filePath = this.#followingPath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      yaml.dump({ following: normalizedEntries }, { noRefs: true, lineWidth: 120 }),
      "utf8",
    );
  }

  async #upsertFollowingEntry(entry) {
    const normalized = normalizeFollowingEntry(entry);
    if (!normalized) {
      throw new Error("invalid following entry");
    }

    const entries = await this.#readFollowingEntries();
    const nextEntries = entries.filter((item) => item.url !== normalized.url);
    nextEntries.push(normalized);
    await this.#writeFollowingEntries(nextEntries);
  }

  async #removeFollowingEntry(url) {
    const normalizedUrl = normalizeString(url);
    if (!normalizedUrl) {
      throw new Error("missing following url");
    }
    const entries = await this.#readFollowingEntries();
    const nextEntries = entries.filter((item) => item.url !== normalizedUrl);
    await this.#writeFollowingEntries(nextEntries);
  }

  #followingPath() {
    return path.join(this.identityDir, "following.yaml");
  }

  async #loadTargetIdentity(target) {
    const targetUrl = await this.resolveTarget(target);
    const client = await this.getClient();
    const manifest = await client.whois(targetUrl);
    if (!manifest || typeof manifest !== "object") {
      throw new Error(`target identity unavailable for ${targetUrl}`);
    }
    return normalizeRemoteIdentity(manifest, targetUrl);
  }

  async #buildAuthHeader(method, pathname) {
    const [manifest, privateKey, mod] = await Promise.all([
      this.getManifest(),
      this.getPrivateKey(),
      this.getModule(),
    ]);
    if (typeof mod?.signPayload !== "function") {
      throw new Error("asp-protocol signPayload unavailable");
    }

    const endpoint = normalizeString(manifest?.entity?.id);
    if (!endpoint) {
      throw new Error("missing identity endpoint");
    }

    const timestamp = String(Date.now());
    const payload = `${endpoint}:${timestamp}:${method}:${pathname}`;
    const signature = mod.signPayload(payload, privateKey);
    return `ASP-Sig ${endpoint}:${timestamp}:${signature}`;
  }

  async #signCardEnvelope(envelope) {
    const [privateKey, mod] = await Promise.all([
      this.getPrivateKey(),
      this.getModule(),
    ]);
    if (typeof mod?.signPayload !== "function") {
      throw new Error("asp-protocol signPayload unavailable");
    }

    return {
      ...envelope,
      signature: mod.signPayload(buildCardSignaturePayload(envelope), privateKey),
    };
  }
}

function createAspSocialNodeRuntime(options = {}) {
  return new AspSocialNodeRuntime(options);
}

module.exports = {
  AspSocialNodeRuntime,
  DEFAULT_ASP_IDENTITY_DIR,
  createAspSocialNodeRuntime,
};
