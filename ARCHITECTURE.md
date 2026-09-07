# ARCHITECTURE

Deep-dive companion to [MASTER_SPEC.md](./MASTER_SPEC.md) §5–§9, §12a, §22–§25. This
document explains *how the pieces connect*; MASTER_SPEC.md remains the authority on *what
is decided*.

## System overview

```
┌───────────────────────────── Android App ─────────────────────────────┐   ┌─────────────────────────┐
│  features/*  (Compose UI, ViewModels)                                 │   │  Browser Web Client     │
│      │ StateFlow<UiState> / Intent                                    │   │  (web/, plain HTML/CSS/ │
│  agents/  (Orchestrator + per-category Agents)                        │   │  JS, no build step —    │
│      │ uses                                                            │   │  MASTER_SPEC.md §12a)   │
│  domain/  (pure Kotlin: entities, Skill/Tool contracts, ToolPipeline,  │   └────────────┬────────────┘
│            RiskEngine, EntitlementResolver, planning logic — ports:    │                │
│            PermissionPort, EntitlementPort, UsagePort, ConfirmationPort)│                │
│      │ implemented by                                                  │                │
│  core/core-security, core/core-tooling  (Android bindings for ports)   │                │
│  data/data-remote  (Retrofit client)  ──────────────┐                  │                │
└──────────────────────────────────────────────────────┼──────────────────┘                │
                                                         │ HTTPS, versioned API              │ HTTPS, same-origin
                                                         ▼                                    ▼ (served by the backend itself)
                                        ┌──────────────────────────── Backend ─────────────────────────────┐
                                        │  api/  (Express routes)                                          │
                                        │  agents/ (server-side Orchestrator + Web/Document/Developer agents) │
                                        │  skills/ (server-executed skills)                                 │
                                        │  ai/     (AIProvider abstraction: MockAIProvider + GeminiProvider) │
                                        │  billing/, usage/, auth/, github/, security/, db/                 │
                                        │  serves web/ as static assets at zarvismobile.com (server.ts)     │
                                        └────────────────────────────────────────────────────────────────────┘
```

## Why a pure-Kotlin `domain` module

Every rule that decides *whether an action is allowed* (risk classification, entitlement
resolution, tool-call validation, orchestrator planning) lives in `domain` as plain Kotlin
against small port interfaces:

```kotlin
interface PermissionPort { suspend fun isGranted(permission: PermissionType): Boolean }
interface EntitlementPort { suspend fun resolve(accountId: String, skill: SkillDefinition): EntitlementDecision }
interface UsagePort { suspend fun charge(accountId: String, cost: UsageCost): UsageChargeResult }
interface ConfirmationPort { suspend fun confirm(request: ConfirmationRequest): Boolean }
```

Android supplies real implementations (`ContextCompat` permission checks, a Compose
confirmation dialog, a Retrofit-backed entitlement/usage client). The backend supplies its
own server-side implementations of the *same shaped* logic in TypeScript
(`backend/src/domain`, `backend/src/tooling`), so both client and server enforce identical
rules — the client check is a fast-fail UX convenience, the server check is the actual
security boundary (never trust the client — see [SECURITY.md](./SECURITY.md)).

This split is what makes `domain` buildable and unit-testable on plain JVM without an
Android SDK or emulator — see [DEVELOPMENT.md](./DEVELOPMENT.md).

## Request lifecycle (voice or text turn)

1. **features/feature-conversation** captures input (STT transcript or typed text),
   dispatches an `Intent.SubmitTurn`.
2. The ViewModel calls **agents/Orchestrator.planTurn(...)**, passing conversation context.
3. Orchestrator asks `domain.SkillRegistry` for the currently-enabled skills (filtered by
   the account's resolved entitlements) and builds an `AIRequest` with those as tool
   definitions.
4. For skills marked `executesOnDevice = true` (e.g. `personal.reminder`), the Orchestrator
   may resolve locally; otherwise it calls **data-remote** → backend
   `POST /api/v1/orchestrator/turn`.
5. The backend Orchestrator runs the same tool-calling loop server-side against the
   configured `AIProvider`, executing any backend-side skill's `ToolPipeline` (permission →
   risk → entitlement → confirmation → execute → verify), and streams back a response plus
   any tool results.
6. The Android Orchestrator merges local + remote results into a single `TurnResult`,
   updates Task state (`domain.Task`/`TaskStep`), and the UI renders the result / speaks it
   via TTS.

## Module dependency direction

`features → agents/skills → domain ← core-tooling/core-security ← data-repository → data-remote/data-local`

`domain` has **zero** outward dependencies on Android, networking, or persistence — it only
defines ports. Every other module depends inward toward `domain`, never the reverse. This
is what allows a skill or agent to be added without modifying the Orchestrator (MASTER_SPEC
§3.8) and lets `domain` be reused verbatim as the reference implementation the backend's
TypeScript port mirrors conceptually.

## Backend/Android parity note

The backend is not a thin proxy that merely forwards to an AI provider — it re-implements
the same Tool pipeline shape (registry → validation → permission → risk → entitlement →
confirmation → execute → verify) shown in MASTER_SPEC §7, because any client-side check can
be bypassed by a modified client. The Android pipeline exists for responsive UX (instant
"you don't have permission for this" before a network round-trip); the backend pipeline is
what actually authorizes execution of anything billable or server-executed.

## Further reading

- [AI_ARCHITECTURE.md](./AI_ARCHITECTURE.md) — provider abstraction and tool-calling loop
- [SKILLS.md](./SKILLS.md) — skill catalogue and authoring guide
- [DEVELOPER_AGENT.md](./DEVELOPER_AGENT.md) — Developer Agent design
- [SECURITY.md](./SECURITY.md) / [PRIVACY.md](./PRIVACY.md)
- [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md)
