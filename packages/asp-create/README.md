# asp-create

Shared onboarding engine for public ASP entry points.

This package powers:

- `asp init` flows that need protocol-level onboarding
- `create-asp-agent`
- hosted wrappers such as `create-identity` and `letussocial`

It is intended to be consumed as a CLI package dependency rather than imported
directly by application code.
