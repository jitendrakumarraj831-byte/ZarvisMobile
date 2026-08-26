# SKILLS

Companion to [MASTER_SPEC.md §6 (Skill Architecture)](./MASTER_SPEC.md#6-skill-architecture).
This document is the authoring guide for adding a new Skill, plus the current catalogue.

## What a Skill is

A Skill is a declarative capability definition plus an execution handler. The
Orchestrator/Agents select skills dynamically from the `SkillRegistry` — adding a skill
never requires modifying orchestrator or agent code.

```kotlin
data class SkillDefinition(
    val id: String,                              // "web.search", dotted category.action
    val name: String,
    val description: String,                      // shown to the LLM for tool-selection
    val category: SkillCategory,
    val capabilities: List<String>,
    val requiredPermissions: List<PermissionType>,
    val requiredEntitlement: EntitlementLevel,
    val usageCost: UsageCost,
    val riskLevel: RiskLevel,
    val requiresConfirmation: Boolean,
    val executesOnDevice: Boolean,                 // true = Android handler, false = backend
    val handler: SkillHandler
)
```

## Authoring a new skill

1. Pick an `id` as `category.action` (lowercase, dot-separated) and the right
   `SkillCategory` (see the category list in [MASTER_SPEC.md §1](./MASTER_SPEC.md#1-product-vision)).
2. Decide `riskLevel` honestly using the rubric in
   [MASTER_SPEC.md §21 (Risk Engine, folded into §15/§16 boundaries)](./MASTER_SPEC.md#7-tool-architecture):
   LOW = search/open/summarize/draft, MEDIUM = send/call/modify-files, HIGH =
   financial/account-security/destructive. When unsure, round up.
3. Write `inputSchema`/`outputSchema` as JSON Schema — this is what both the LLM tool
   definition and the pipeline's validation stage are generated from.
4. Implement the handler behind the existing ports (`PermissionPort`, `EntitlementPort`,
   `UsagePort`, `ConfirmationPort`) — never reach around the Tool pipeline
   ([MASTER_SPEC.md §7](./MASTER_SPEC.md#7-tool-architecture)) to call a platform API or
   external service directly.
5. Register the definition in the relevant `skills/<category>/` package's registry
   provider. Add a unit test (domain-side skills) or an integration test (backend-side
   skills) exercising both the success and at least one denied path (permission/risk/
   entitlement).
6. If the skill is user-discoverable, make sure its `description` is written the way a
   real user's request would be phrased — it doubles as the LLM's basis for tool
   selection and as the copy shown in the "What can you do?" screen (§28 of the original
   product brief; realized as the Skill Registry catalogue).

## Current catalogue (this repository)

| Skill ID | Category | Executes | Risk | Status |
|---|---|---|---|---|
| `personal.reminder` | Personal | On-device (Android `domain`) | LOW | **Implemented** — create/list/complete a reminder, unit-tested |
| `web.search` | Web | Backend | MEDIUM | **Implemented** — mocked search provider, real pipeline |
| `docs.summarize` | Documents | Backend | LOW | **Implemented** — mocked summarizer, real pipeline |
| `developer.analyze_repo` | Developer | Backend | LOW (read-only) | **Implemented** — mocked repo analysis, real pipeline |
| Phone (`phone.*`) | Phone | — | — | Foundation only: category + agent contract registered, no handler yet |
| Business (`business.*`) | Business | — | — | Foundation only |
| Research (`research.*`) | Research | — | — | Foundation only |
| Creative (`creative.*`) | Creative | — | — | Foundation only |
| Automation (`automation.*`) | Automation | — | — | Foundation only |

"Foundation only" means the `SkillCategory` and the corresponding `Agent` interface exist
and are wired into the Orchestrator's routing table, proving the architecture accepts the
category — but no working skill handler ships in this pass (see
[MASTER_SPEC.md §29](./MASTER_SPEC.md#29-mvp-scope) and
[§28 phases 4–9](./MASTER_SPEC.md#28-development-phases) for when each ships).

## "What can you do?"

The Orchestrator answers this by rendering `SkillRegistry.all()` grouped by `category`,
filtered to what the asking account's entitlement allows to *see* (even skills above the
account's plan are shown, marked upgrade-required, rather than hidden — discoverability
matters more than upsell pressure). This is live registry data, not a hand-maintained
screen, so it can never drift out of sync with what the product actually does.
