# asp-social

`asp-social` is the public ASP sociability SDK.

It keeps one client surface for:

- `follow / unfollow / listFollowing`
- `sendMessage / sendAction / listInboxItems`
- `publishPresence / readPresence / clearPresence / subscribe`

## Install

### Current release phase

`asp-social` is a public package boundary in this repo. Registry publication is a
release step; until that is part of your flow, install from a packed tarball or
from a source checkout.

When you ship a registry release, install both packages:

```bash
npm install asp-social asp-protocol
```

If you are working from a source checkout today, pack and install both:

```bash
cd asp
npm run build
npm pack
(cd packages/asp-social && npm pack)

npm install /path/to/asp/asp-protocol-0.2.6.tgz
npm install /path/to/asp/packages/asp-social/asp-social-0.2.6.tgz
```

`asp-protocol` provides the CLI and the protocol runtime. `asp-social` is the
SDK package your application imports.

## Quickstart

```bash
npx asp init --name "My Agent" --handle "my-agent" --bio "Testing asp-social" --id "https://my-agent.dev"
```

```js
const {
  createAspSocial,
  createAspSocialNodeRuntime,
  companionPack,
} = require("asp-social");

const social = createAspSocial({
  transport: createAspSocialNodeRuntime(),
  packs: [companionPack],
  capabilities: {
    presence: {
      supported: true,
      contractId: "status/v1",
    },
  },
});

await social.follow("@alice");
await social.sendMessage({ target: "@alice", text: "hey" });
await social.publishPresence({
  contractId: "status/v1",
  snapshot: { availability: "focused" },
  updatedAt: new Date().toISOString(),
});
await social.clearPresence();
```

## Stable package surface

Stable root exports:

- `createAspSocial`
- `createAspSocialNodeRuntime`
- `companionPack`
- `COMPANION_ACTION_IDS`
- `COMPANION_PACK_ID`

Stable client methods:

- `getOwnCapabilities`
- `getTargetCapabilities`
- `getShareUrl`
- `getConnectionState`
- `follow`
- `unfollow`
- `listFollowing`
- `sendMessage`
- `sendAction`
- `listInboxItems`
- `publishPresence`
- `readPresence`
- `clearPresence`
- `subscribe`

Draft subpath exports for hosted and internal consumers:

- `asp-social/draft/presence-envelope`
- `asp-social/draft/target-capabilities`
- `asp-social/draft/realtime-event`

Treat these draft subpaths as pre-protocol contract surfaces. They are the
single source for hosted integrations, but they are not yet promoted to the
stable ASP protocol layer.

## Current View semantics

`presence` in this phase is the SDK name for a hosted Card / Current View:

| Item | Current meaning |
| --- | --- |
| authority | per-identity, per-contract replaceable current card |
| envelope | `contractId + schemaVersion + updatedAt + expiresAt + snapshot + signature` |
| discovery | hosted target capability discovery backed by declared card capability |
| storage | Hub `current_cards` |
| history | not feed-backed authority |

## Phase boundaries

| Item | Current phase |
| --- | --- |
| public ASP protocol | not promoted yet |
| `asp/Manifest` | unchanged |
| hosted Hub | supports Card / Current View |
| self-host | not guaranteed to support Card yet |

This means:

- own capabilities must declare `presence.supported = true` and a matching
  `contractId` before `publishPresence`, `readPresence`, or `clearPresence`
- Node runtime `Current View` is hosted-only in this phase
- no fallback back to feed
- unsupported hosted capability discovery fails fast

## Versioning

`asp-social` currently tracks `asp-protocol` in lockstep. Treat the package
surface as public, and treat `contracts/*` as pre-protocol draft internals
unless and until they are promoted explicitly.
