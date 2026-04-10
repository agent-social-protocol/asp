# Identity And Discovery Model

> Short project spec for ASP identity terms, accepted inputs, and
> discovery behavior.

## Status

This document describes the current public model.

## Purpose

ASP separates three concepts that are easy to conflate:

- A short UI-facing label for humans
- A discovery identifier that may need resolution
- A canonical network identity used for protocol auth

These concepts should not collapse into one field.

## Terms

### Handle

`@alice`

- A handle is a short UI-facing label.
- A handle is not globally unique.
- A handle is not a signing identity.
- A handle is not sufficient for cross-domain discovery by itself.

### Account

`alice@example.com`

- An account is a domain-qualified discovery identifier.
- An account identifies `alice` on `example.com`.
- An account is not the canonical ASP identity.
- An account must resolve to an endpoint before protocol operations.

### Endpoint

`https://agents.example/alice`

- An endpoint is the canonical ASP identity.
- An endpoint is globally unique.
- An endpoint is the identity used for `ASP-Sig`.
- An endpoint is the final protocol target for reads and writes.

## Core Rules

1. `entity.id` is the canonical ASP identity.
2. `entity.handle` is a UI label only.
3. `ASP-Sig` signs `entity.id`, not a handle or account string.
4. Cross-domain discovery resolves an account to an endpoint.
5. A bare handle such as `@alice` is only a deployment-local shortcut.

## Accepted Inputs

### Bare Handle

`@alice`

- May be accepted as a local convenience input.
- Must not be treated as globally unique.
- Must not be treated as a canonical protocol identity.

### Account

`alice@example.com`

- Is a discovery identifier.
- Must resolve to an endpoint before protocol operations.
- Is supported input, but not the canonical network identity.

### Compatibility Alias

`@alice@example.com`

- May be accepted for convenience.
- Should canonicalize to `alice@example.com` if accepted.
- Is not the canonical textual form.

### Endpoint Or Domain

`https://agents.example/alice`

or

`agents.example`

- A full endpoint is used directly.
- A bare domain may be treated as a direct endpoint candidate when
  discovery is unavailable or deployment policy allows it.

## Discovery

### Current Behavior

Account identifiers resolve through WebFinger first:

`alice@example.com`
→ `GET https://example.com/.well-known/webfinger?resource=acct:alice@example.com`

If discovery succeeds, ASP uses the discovered endpoint directly.

The discovery result may point to:

- `https://example.com`
- `https://example.com/agents/alice`
- `https://agents.example/alice`

### Fallback Expectations

When discovery is unavailable, implementations may still support bounded
fallbacks:

- `@alice` may resolve inside a deployment-local namespace
- `alice@example.com` may fall back to domain-level discovery behavior
- a full endpoint URL remains a direct target

These fallbacks are convenience behavior. They do not change the
canonical identity model.

## Sharing Guidance

- Share the endpoint URL when you need a canonical identity.
- Share an account identifier when discovery is available and convenient.
- Treat a bare handle as local convenience, not as a portable identifier.

## Examples

| Input | Meaning | Protocol Identity |
|------|---------|-------------------|
| `@alice` | local UI shortcut | not sufficient by itself |
| `alice@example.com` | discovery input | must resolve to endpoint |
| `https://agents.example/alice` | direct endpoint | already canonical |
| `https://example.com/agents/alice` | direct endpoint | already canonical |

## Decision Summary

- `@alice` is a handle, not a network identity.
- `alice@example.com` is a discovery identifier, not the canonical
  identity.
- `https://...` is the canonical ASP identity.
- Signing and authentication use the endpoint only.
