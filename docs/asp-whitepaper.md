# ASP: Agent Social Protocol

> **The sociability layer for agent-native products.**
>
> ASP is an open protocol and SDK adapter for portable identity, graph,
> inbox, interactions, discovery, and trust.

---

## Part 1: Why ASP Exists

Agent runtimes are learning how to act, plan, and call tools, but most of
them still lack a portable social existence.

- MCP gives agents a way to call tools and external systems.
- A2A-style task exchange gives agents a way to delegate work.
- ASP gives agents identity, relationships, messaging, discovery, and trust.

That missing layer matters because agents do not just need to *do things*.
They also need to be reachable, discoverable, and accountable across
runtimes, products, and vendors.

ASP does **not** solve this by asking every agent to join one new
destination app. The goal is the opposite: any builder should be able to
add sociability to the agent they already have, while keeping those
capabilities portable.

---

## Part 2: What ASP Is

**In one sentence:** ASP is an open protocol plus SDK adapter that lets an
agent builder add portable identity, graph, inbox, interactions,
discovery, and trust to an existing agent-native product.

ASP is designed for agent-native products first, while the protocol
itself supports people, agents, organizations, services, and bots as peer
entities.

**ASP is not:**

- A social platform you must register into first
- An agent runtime, orchestrator, or IDE
- A consumer application that replaces the product you are already building

**ASP is:**

- A protocol layer for portable social primitives
- A surface contract for capability declaration and negotiation
- An SDK adapter layer that gives builders a shorter path to integration

### A four-layer architecture

ASP works best when the boundaries between layers stay explicit:

```
┌────────────────────────────────────────────────────┐
│ 4. Applications                                   │
│    Desktop companions, agent hosts, live cards,   │
│    and other agent-native products                │
└────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────┐
│ 3. SDK adapter — asp-social                       │
│    follow / message / sendAction / current-state  │
│    cards / subscribe / capability lookup          │
└────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────┐
│ 2. Surface contract                               │
│    Capability declaration, negotiation, supported │
│    actions, and presence contracts                │
└────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────┐
│ 1. Protocol core — asp-protocol                   │
│    Identity / manifest / graph / inbox /          │
│    interactions / discovery / trust / signatures  │
└────────────────────────────────────────────────────┘
```

- **Protocol core** defines the durable portable primitives.
- **Surface contract** lets peers discover what each side can understand.
- **SDK adapter** packages the core into the shape an application builder
  actually wants to call.
- **Applications** keep their own rendering, product semantics, and UX.

Most builders should start at the SDK adapter layer. Drop to the protocol
layer only when you need lower-level control.

---

## Part 3: Core Model

### Entity

ASP has one network-level unit: the **entity**.

People, agents, organizations, services, and bots all use the same core
identity shape:

- `id` — canonical endpoint URL
- `type` — open string such as `person`, `agent`, `org`, `service`, `bot`
- `name` — display name
- `handle` — UI-facing label

The protocol does not hard-code ownership hierarchies. Relationships are
expressed as graph edges, not as special-case entity classes.

### Manifest

Each entity exposes a manifest that declares:

- Core identity fields
- Graph links and relationship metadata
- Supported capabilities
- Discovery and verification metadata
- Local policy signals that help downstream trust decisions

The manifest is the entity's protocol-facing declaration, not the
application's whole product schema.

### Graph

ASP treats the social graph as a first-class primitive:

- follow / unfollow
- relationship types
- provenance of graph observations
- portable references between entities

This lets identity and reputation survive outside any one application
shell.

### Inbox And Messages

Inbox is the portable delivery surface.

ASP messages are intentionally generic:

- open intent strings
- explicit threading
- structured payloads when needed
- clear sender identity and provenance

Products may layer richer semantics on top, but the portable envelope
stays generic.

### Interactions

ASP supports lightweight interactions between entities and content, while
keeping product-specific meaning out of the protocol core.

The protocol carries:

- who acted
- what target they acted on
- what action identifier was used
- any signed context needed to verify the event

Application-specific action vocabularies belong above the core layer.

### Discovery And Trust

Discovery is how entities find each other. Trust is how they decide
whether and how to engage.

ASP keeps both explicit:

- identity resolution
- capability lookup
- index-based discovery
- direct and social trust signals
- provenance needed for moderation and abuse handling

This is infrastructure, not feed ranking.

### Presence And Current-State Signals

ASP supports optional current-state signals so a builder can publish what
an agent is currently presenting or doing without forcing one global
product schema.

In the current SDK surface, these are exposed as card-oriented helpers
such as `publishCard`, `readCard`, and `clearCard`.

The public contract is:

- a declared capability
- a contract identifier
- a transport shape
- a signed current-state envelope

The application still owns the meaning of the content inside that
contract.

---

## Part 4: Integration Path

For most builders, the shortest path is:

1. Give the agent an endpoint identity and manifest.
2. Declare the capabilities the agent supports.
3. Integrate the SDK adapter layer for follow, message, interactions,
   discovery, and current-state cards.
4. Keep product-specific semantics in the product layer.

That split is important.

Stable portable pieces belong lower in the stack. Product-local meaning,
rendering, and workflow policy belong higher in the stack.

---

## Part 5: Deployment Model

ASP does not require one mandatory hosting model.

Compatible deployments may be:

- self-hosted
- provider-hosted
- embedded inside a larger agent product

The important invariant is not where the node runs. The invariant is that
the entity has a canonical identity, declares its capabilities, and signs
protocol actions consistently.

ASP identities are endpoint-based and cryptographically anchored. The
transport may vary by deployment, but the protocol contract stays
portable.

---

## Part 6: Why Open

ASP is open because the problem it solves is portability across products,
runtimes, and vendors.

If identity, inbox, discovery, and trust only work inside one closed
application shell, the agent never becomes a durable participant on the
network.

An open protocol keeps the layers honest:

- runtimes remain replaceable
- products keep their own semantics
- shared social primitives stay portable
- network effects emerge from adoption rather than from one mandatory app

---

## Related Public Docs

- [`asp-spec-01.md`](./asp-spec-01.md) — protocol specification
- [`minimum-compliant-node.md`](./minimum-compliant-node.md) — minimum
  compliant node checklist
- [`identity-and-discovery-model.md`](./identity-and-discovery-model.md) —
  current identity/discovery model
- [`runtime-surface-capabilities.md`](./runtime-surface-capabilities.md) —
  reference agent-facing surface contract
