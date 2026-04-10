# asp-create

Shared onboarding engine for public ASP entry points.

This package powers:

- `asp init` flows that need protocol-level onboarding
- `create-asp-agent`
- hosted wrappers built on the same onboarding engine

Protocol defaults stay infrastructure-neutral. Branded wrappers are expected to
inject their own hosted URLs and user-facing copy via environment overrides.

It is intended to be consumed as a CLI package dependency rather than imported
directly by application code.
