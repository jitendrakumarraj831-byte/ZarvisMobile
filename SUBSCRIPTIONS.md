# ZARVIS Subscriptions

Subscription and credit behavior must remain truthful and server-authoritative.

## Principles

- Never trust client-side credit state.
- Sensitive billing operations require server-side validation.
- Purchases should be safely idempotent/single-use where applicable.
- Account ownership must be enforced.
- Entitlements must match the server's actual state.
- UI must not advertise unavailable capabilities as active.

## Product tiers

Specific pricing, limits and entitlements should be defined from the current production billing configuration rather than duplicated as stale constants in documentation.

See [ZARVIS_MASTER_PRODUCT_BLUEPRINT.md](./ZARVIS_MASTER_PRODUCT_BLUEPRINT.md) for product rules.
