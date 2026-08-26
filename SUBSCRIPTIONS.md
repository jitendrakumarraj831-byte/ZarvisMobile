# SUBSCRIPTIONS

Companion to [MASTER_SPEC.md §19–§21 (Subscription, Trial, Usage/Credits)](./MASTER_SPEC.md#19-subscription-model).

## Plans

`FREE, TRIAL, PLUS, PRO, BUSINESS, ENTERPRISE` — modeled as an extensible enum from day
one so later tiers need no schema migration. This repository activates `FREE`, `TRIAL`,
and `PRO`; `PLUS`/`BUSINESS`/`ENTERPRISE` exist in the type system, unpriced and unsold,
ready to configure later.

## Entity relationships

```
User 1───1 Account 1───1 Subscription ───* PlanId
Account 1───1 Trial (optional, one lifetime trial per account)
Account 1───* Usage (append-only ledger entries)
Account 1───1 CreditBalance (derived/cached projection of Usage)
Account 1───* Transaction (billing events)
Plan 1───* Entitlement (skill or category → limit)
```

## Entitlement resolution — the one place plan logic lives

`billing/entitlements.ts` (backend) and its Kotlin mirror
(`domain/entitlement/EntitlementResolver.kt`) answer exactly one question:

> "Can `accountId` use `skillId` right now?"

```ts
function resolve(accountId: string, skill: SkillDefinition): EntitlementDecision
// => { allowed: true } | { allowed: false, reason: "TRIAL_EXPIRED" | "PLAN_TOO_LOW" | "OUT_OF_CREDITS", upgradeTo?: Plan }
```

No screen, skill, or agent duplicates plan/price logic — they all call this resolver. The
mobile app calls it for fast UX ("this needs PRO," shown before the user even tries), and
the backend Tool pipeline calls it authoritatively before executing anything billable,
regardless of what the client believed (see [SECURITY.md](./SECURITY.md) — never trust the
client for entitlement grants).

## Trial

- One trial per account: `startsAt`, `expiresAt`, `includedCredits`,
  `includedSkillCategories` — deliberately spans multiple categories so a new user
  experiences the *universal agent* breadth in the trial window, not one narrow feature.
- Expires on **time OR credits, whichever comes first**, resolved server-side — the
  device clock is never trusted for expiry.
- On expiry, the account falls back to `FREE` (LOW-risk, low-cost skills only) and is
  offered `PRO`.

## Usage / credits

- Every skill declares a `UsageCost` (credit units). The `usage/` ledger is append-only:
  one row per billable tool execution (`accountId, skillId, cost, timestamp, taskId`).
- Enforcement happens inside the Tool pipeline's entitlement stage, **before** execution —
  a blocked action never partially charges. See
  [MASTER_SPEC.md §7](./MASTER_SPEC.md#7-tool-architecture) and
  [§21](./MASTER_SPEC.md#21-usage--credits).
- Client-shown balances ("X credits left") are read-only projections for UX; they never
  authorize execution themselves.

## Billing integration point

Google Play Billing on Android, verified server-side via the Play Developer API (webhook +
purchase-token verification). This repository does not have a live Play Console listing,
so `billing/playBillingVerifier.ts` is implemented against the same interface a real
verifier would use, with a mock verifier wired in for local dev/tests — swapping in the
real Play Developer API call is a config/adapter change, not a redesign. See
[MASTER_SPEC.md §32](./MASTER_SPEC.md#32-risks-and-limitations).
