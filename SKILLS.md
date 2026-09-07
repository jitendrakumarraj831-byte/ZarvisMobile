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

| Skill ID | Category | Executes | Risk | Usage cost | Status |
|---|---|---|---|---|---|
| `personal.reminder` | Personal | On-device (Android `domain`) | LOW | Free | **Implemented** — create/list/complete a reminder, unit-tested |
| `web.search` | Web | Backend | LOW (search, per the rubric above) | 2 credits (real infra cost) | **Implemented** — mocked search provider, real pipeline |
| `docs.summarize` | Documents | Backend | LOW | 1 credit | **Implemented** — mocked summarizer, real pipeline |
| `developer.analyze_repo` | Developer | Backend | LOW (read-only) | 3 credits | **Implemented** — mocked repo analysis, real pipeline |
| `phone.open_app` | Phone | On-device (Android `domain`) | LOW | Free | **Implemented** — resolves an installed app by name and launches it, unit-tested |
| `phone.find_contact` | Phone | On-device (Android `domain`) | MEDIUM (rounded up — personal data about a third party) | Free | **Implemented** — `ContactsContract` lookup by name, unit-tested against a fake port |
| `phone.call` | Phone | On-device (Android `domain`) | MEDIUM | Free | **Implemented** — resolves a contact name or accepts a raw number, places a real call via `Intent.ACTION_CALL`, unit-tested against a fake port |
| `business.social_post` | Business | Backend | LOW | 1 credit | **Implemented** — real Gemini generation once `GEMINI_API_KEY` is set, honestly-labeled mock otherwise |
| `business.customer_reply` | Business | Backend | LOW | 1 credit | **Implemented** — same generator as `business.social_post` |
| `business.draft_invoice` | Business | Backend | LOW | 1 credit | **Implemented** — deterministic line-item parser (no AI needed for arithmetic), real pipeline |
| `creative.write_message` | Creative | Backend | LOW | 1 credit | **Implemented** — the exact MASTER_SPEC.md §1 birthday-message example, real pipeline |
| `creative.write_poem` | Creative | Backend | LOW | 1 credit | **Implemented** — same generator, distinct system prompt |
| `creative.brainstorm` | Creative | Backend | LOW | 1 credit | **Implemented** — same generator, distinct system prompt |
| `automation.create_workflow` | Automation | Backend | LOW | 1 credit | **Implemented** — creates a real, trackable multi-step `Task` via the Task Engine (§18); does not execute the steps (see below) |
| `automation.list_workflows` | Automation | Backend | LOW | Free | **Implemented** — natural-language path to the account's own tasks |
| `automation.cancel_workflow` | Automation | Backend | LOW | Free | **Implemented** — fuzzy goal-text match scoped to the calling account only, real pipeline |
| `research.compare` | Research | Backend | LOW | 1 credit | **Implemented** — distinct from `web.search`: reasons over general knowledge, not a live fetch; honestly caveats it isn't sourced/current |
| `research.report` | Research | Backend | LOW | 1 credit | **Implemented** — distinct from `docs.summarize`: writes a structured overview on a topic rather than condensing text the user already has |
| `research.outline` | Research | Backend | LOW | 1 credit | **Implemented** — a planning artifact (sub-questions worth investigating), not an attempt to answer them |

**Phone Agent, stated honestly:** the three skills above are the first real Phone Agent
skills (MASTER_SPEC.md §28 Phase 4) — their domain-layer logic (`PhoneOpenAppSkillFactory`,
`PhoneFindContactSkillFactory`, `PhoneCallSkillFactory`, and `OnDeviceInputBuilder`, which
maps a matched skill + raw utterance to that skill's own input shape rather than one
hardcoded shape for every on-device match) is unit-tested and build-verified
(`./gradlew :domain:build`). Their real Android platform implementations
(`AndroidAppLauncherPort`/`AndroidContactLookupPort`/`AndroidPhoneCallPort` in
`core-tooling`, plus the `AndroidManifest.xml` permissions/`<queries>` declaration they
need) are written and reviewed against this codebase's existing patterns but — like the
rest of the Android app beyond `domain` — not compiler-verified in this environment; see
MASTER_SPEC.md §32.

**Business and Creative Agents, stated honestly:** unlike Phone (Android, unverifiable
here), these six are backend TypeScript and fully compiler- and test-verified in this
environment — `npm run build && npm test` (backend), 67 tests, 0 failures. All six
generation-based skills (everything except `business.draft_invoice`, which needs no AI)
share one `ContentGenerator` (`backend/src/ai/contentGenerator.ts`, moved out of a
`business/`-specific location once Creative needed it too): real one-shot Gemini generation
when `GEMINI_API_KEY` is configured, an honestly-labeled deterministic mock otherwise —
deliberately not `MockAIProvider` (the Orchestrator's tool-*selection* mock, which returns
"not sure which skill can help" for a plain generation request with no tools). A live
end-to-end smoke test against a running server caught a real bug in
`MockAIProvider.fillInput()` itself: its one generic "fill every required field with the
whole utterance" fallback was correct only by coincidence for every skill before
`business.draft_invoice` (each had at most one field, or `repoUrl`'s own regex case) — a
skill with two distinct fields (`client` + `items`) got the *same* full utterance crammed
into both. Fixed with field-specific heuristics (`test/ai/mockProvider.test.ts` now covers
this) — the same class of bug, and the same fix shape, as `OnDeviceInputBuilder` above. The
three Creative skills (all single-`prompt`-field, like `business.social_post`) hit no such
bug and were confirmed live, each correctly routed by the mock's keyword matching with no
cross-contamination between them or with Business's own generation skills.

**Automation Agent, stated honestly:** its first three skills need no `GEMINI_API_KEY` at
all — they're CRUD over the already-implemented Task Engine (§18: `TaskService`, previously
untested — `test/tasks/taskService.test.ts` is new here too), not generation. This is the
first backend skill set to need a dependency `buildSkillRegistry()` didn't already have
(`Store`, to build a `TaskService`), so its signature changed from `()` to `(store: Store)` —
its one caller (`container.ts`) was updated accordingly. `automation.create_workflow`
creates and tracks a real, multi-step `Task` (visible and controllable — pause/resume/
cancel/retry — in both clients' existing task views) but **does not execute the steps**;
claiming it did would be exactly the "fake success" Product Principle #4 forbids —
step-by-step execution remains future work, same as it already was for the Task Engine in
general. `automation.cancel_workflow` never accepts a raw task id from the user: it only
searches by goal text within the *calling account's own* tasks (`TaskService
.listForAccount`), so it can't be pointed at another account's workflow regardless of
`TaskService.cancel`'s own authorization posture — covered by a dedicated test. A live
end-to-end smoke test caught the same `MockAIProvider.fillInput()` bug class a *third* time
— `goal`/`steps` (create) and `goalMatch` (cancel) all fell through to the whole-utterance
default, so a cancel utterance's own trigger words ("cancel my ... workflow") never matched
any stored goal text at all. Fixed with field-specific heuristics, covered by two more
regression tests, and re-confirmed live (create → cancel → list correctly shows
`CANCELLED`). `npm run build && npm test` — 85 tests, 0 failures.

**Research Agent, stated honestly:** its three skills are deliberately distinct from
categories that could sound similar — `research.compare` from `web.search` (which fetches
live results; this reasons over general knowledge only), and `research.report` from
`docs.summarize` (which condenses text the user already has; this writes a structured
overview from a topic alone). Both, and `research.outline`, share the same
`ContentGenerator` Business/Creative already established, all single-`prompt`-field like
Creative's, so this category hit none of the `MockAIProvider.fillInput()` bugs the
multi-field skills did — confirmed live, including that a plain search request still
correctly routes to `web.search` and not `research.compare` despite both mentioning
comparison. Because a comparison/report/outline generated from general knowledge alone
(no live search) is never sourced or current, every one of these three skills' own system
prompts requires the model to say so explicitly in its reply — not just a doc-comment
disclaimer, an instruction the generated output itself must carry, consistent with §12's
"no un-sourced claims presented as fact." `npm run build && npm test` — 91 tests, 0
failures. This was also the last of the five previously-empty categories (Phone, Business,
Creative, Automation, Research) — every `SkillCategory` MASTER_SPEC.md §1 names now has at
least one real, working skill.

## "What can you do?"

The Orchestrator answers this by rendering `SkillRegistry.all()` grouped by `category`,
filtered to what the asking account's entitlement allows to *see* (even skills above the
account's plan are shown, marked upgrade-required, rather than hidden — discoverability
matters more than upsell pressure). This is live registry data, not a hand-maintained
screen, so it can never drift out of sync with what the product actually does.
