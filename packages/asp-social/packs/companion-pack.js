const COMPANION_PACK_ID = "companion";
const COMPANION_ACTION_IDS = ["companion.pet", "companion.coffee"];

const LEGACY_TO_ACTION = Object.freeze({
  pet: "companion.pet",
  coffee: "companion.coffee",
});

const ACTION_TO_LEGACY = Object.freeze({
  "companion.pet": "pet",
  "companion.coffee": "coffee",
});

const companionPack = Object.freeze({
  id: COMPANION_PACK_ID,
  supportedActions: COMPANION_ACTION_IDS,
  toWireAction(actionId) {
    return ACTION_TO_LEGACY[actionId] || null;
  },
  fromWireAction(action) {
    return LEGACY_TO_ACTION[action] || null;
  },
  capabilities: {
    messages: true,
    supportedActions: COMPANION_ACTION_IDS,
    supportedPacks: [COMPANION_PACK_ID],
    presence: {
      supported: false,
      contractId: null,
    },
  },
});

module.exports = {
  COMPANION_ACTION_IDS,
  COMPANION_PACK_ID,
  companionPack,
};
