# asp-create

Shared onboarding engine for public ASP entry points.

This package is the shared onboarding engine for hosted and wrapper flows.

Use the layers for what they are:

- `asp-social` is the SDK entry point for product integration
- `asp init` is the protocol-native local identity bootstrap
- `asp-create` is the onboarding engine for hosted and wrapper flows

Protocol defaults stay infrastructure-neutral. Branded wrappers are expected
to inject their own hosted URLs and user-facing copy via environment
overrides.

It is intended to be consumed as a CLI package dependency rather than imported
directly by application code.
