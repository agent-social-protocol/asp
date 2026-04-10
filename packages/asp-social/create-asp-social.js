const { normalizeString } = require("./contracts/common");
const { normalizeCardEnvelope } = require("./contracts/card-envelope");
const { normalizeInboxItem } = require("./contracts/inbox-item");
const { normalizeRealtimeEvent } = require("./contracts/realtime-event");
const { mergeTargetCapabilities, normalizeTargetCapabilities } = require("./contracts/target-capabilities");

function requiredTransport(transport, method) {
  if (!transport || typeof transport[method] !== "function") {
    throw new Error(`asp-social transport missing ${method}`);
  }
  return transport[method].bind(transport);
}

function normalizePacks(packs) {
  if (!Array.isArray(packs)) {
    return [];
  }
  return packs.filter((pack) => pack && typeof pack === "object");
}

function normalizeInboxItems(items) {
  if (!Array.isArray(items)) {
    throw new Error("asp-social transport returned invalid inbox list");
  }
  return items.map((item) => {
    const normalized = normalizeInboxItem(item);
    if (!normalized.ok) {
      throw new Error(normalized.error);
    }
    return normalized.value;
  });
}

function cloneCardCapability(card) {
  return card.schemaUrl
    ? { contractId: card.contractId, schemaVersion: card.schemaVersion, schemaUrl: card.schemaUrl }
    : { contractId: card.contractId, schemaVersion: card.schemaVersion };
}

function findDeclaredCard(cards, contractId) {
  return cards.find((card) => card.contractId === contractId) || null;
}

function wrapRealtimeStream(stream) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== "function") {
    throw new Error("asp-social transport returned invalid realtime stream");
  }

  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of stream) {
        const normalized = normalizeRealtimeEvent(event);
        if (!normalized.ok) {
          throw new Error(normalized.error);
        }
        yield normalized.value;
      }
    },
  };
}

function createAspSocial({ transport, capabilities = null, packs = [] } = {}) {
  if (!transport || typeof transport !== "object") {
    throw new Error("missing asp-social transport");
  }

  const normalizedPacks = normalizePacks(packs);
  const ownCapabilities = mergeTargetCapabilities(
    { messages: true, supportedActions: [], supportedPacks: [], cards: [] },
    ...normalizedPacks.map((pack) => pack.capabilities || null),
    capabilities
  );

  return {
    getOwnCapabilities() {
      return {
        messages: ownCapabilities.messages,
        supportedActions: [...ownCapabilities.supportedActions],
        supportedPacks: [...ownCapabilities.supportedPacks],
        cards: ownCapabilities.cards.map(cloneCardCapability),
      };
    },

    async getTargetCapabilities(target) {
      const normalizedTarget = normalizeString(target);
      if (!normalizedTarget) {
        throw new Error("missing target");
      }
      if (typeof transport.getTargetCapabilities !== "function") {
        throw new Error("target capability discovery unavailable");
      }
      const normalized = normalizeTargetCapabilities(await transport.getTargetCapabilities(normalizedTarget));
      if (!normalized.ok) {
        throw new Error(normalized.error);
      }
      return normalized.value;
    },

    async getShareUrl() {
      return requiredTransport(transport, "getShareUrl")();
    },

    async getConnectionState() {
      return requiredTransport(transport, "getConnectionState")();
    },

    async follow(target) {
      const normalizedTarget = normalizeString(target);
      if (!normalizedTarget) {
        throw new Error("missing target");
      }
      return requiredTransport(transport, "follow")(normalizedTarget);
    },

    async unfollow(target) {
      const normalizedTarget = normalizeString(target);
      if (!normalizedTarget) {
        throw new Error("missing target");
      }
      return requiredTransport(transport, "unfollow")(normalizedTarget);
    },

    async listFollowing() {
      const result = await requiredTransport(transport, "listFollowing")();
      if (!Array.isArray(result)) {
        throw new Error("asp-social transport returned invalid following list");
      }
      return result.map((value) => {
        const normalized = normalizeString(value);
        if (!normalized) {
          throw new Error("asp-social transport returned invalid follow target");
        }
        return normalized;
      });
    },

    async sendMessage({ target, text, metadata = null } = {}) {
      const normalizedTarget = normalizeString(target);
      const normalizedText = normalizeString(text);
      if (!normalizedTarget) {
        throw new Error("missing message target");
      }
      if (!normalizedText) {
        throw new Error("missing message text");
      }
      return requiredTransport(transport, "sendMessage")({
        target: normalizedTarget,
        text: normalizedText,
        metadata,
      });
    },

    async sendAction({ target, actionId, payload = null, metadata = null } = {}) {
      const normalizedTarget = normalizeString(target);
      const normalizedActionId = normalizeString(actionId);
      if (!normalizedTarget) {
        throw new Error("missing action target");
      }
      if (!normalizedActionId) {
        throw new Error("missing actionId");
      }
      return requiredTransport(transport, "sendAction")({
        target: normalizedTarget,
        actionId: normalizedActionId,
        payload,
        metadata,
      });
    },

    async listInboxItems() {
      const items = await requiredTransport(transport, "listInboxItems")();
      return normalizeInboxItems(items);
    },

    subscribe(ownerId) {
      const normalizedOwnerId = normalizeString(ownerId);
      if (!normalizedOwnerId) {
        throw new Error("missing ownerId");
      }
      return wrapRealtimeStream(requiredTransport(transport, "subscribe")(normalizedOwnerId));
    },

    async publishCard(envelope) {
      const normalized = normalizeCardEnvelope(envelope);
      if (!normalized.ok) {
        throw new Error(normalized.error);
      }
      const declaredCard = findDeclaredCard(ownCapabilities.cards, normalized.value.contractId);
      if (!declaredCard) {
        throw new Error("own capabilities must declare this card contractId before publishCard");
      }
      if (normalized.value.schemaVersion !== declaredCard.schemaVersion) {
        throw new Error("card schemaVersion does not match own capabilities");
      }
      return requiredTransport(transport, "publishCard")(normalized.value);
    },

    async clearCard(contractId) {
      const normalizedContractId = normalizeString(contractId);
      if (!normalizedContractId) {
        throw new Error("missing card contractId");
      }
      return requiredTransport(transport, "clearCard")(normalizedContractId);
    },

    async readCard(target, contractId) {
      const normalizedTarget = normalizeString(target);
      const normalizedContractId = normalizeString(contractId);
      if (!normalizedTarget) {
        throw new Error("missing target");
      }
      if (!normalizedContractId) {
        throw new Error("missing card contractId");
      }
      const envelope = await requiredTransport(transport, "readCard")(
        normalizedTarget,
        normalizedContractId,
      );
      if (envelope == null) {
        return null;
      }
      const normalized = normalizeCardEnvelope(envelope);
      if (!normalized.ok) {
        throw new Error(normalized.error);
      }
      return normalized.value;
    },
  };
}

module.exports = {
  createAspSocial,
};
