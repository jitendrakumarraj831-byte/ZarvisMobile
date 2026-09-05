# ZARVIS MOBILE — MASTER SPECIFICATION

**Status:** Living document — source of truth for product and technical decisions.
**Version:** 0.2.0 (Phase 0–3 — Foundation + Web Client + first live AI provider)
**Last updated:** 2026-09-05
**Production domain:** [zarvismobile.com](https://zarvismobile.com) — the registered domain
for this product; the backend's `PUBLIC_APP_URL`/`CORS_ORIGINS` default to it (see
`backend/.env.example`) and both the browser web client (§12a) and, once published, the
Android app's backend base URL target it.

> Every major implementation decision must be consistent with this document. If a better
> technical approach is discovered later, this file is updated **first**, then the codebase
> is changed to match. The codebase and this specification must never silently diverge.

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Target Users](#2-target-users)
3. [Product Principles](#3-product-principles)
4. [Core User Journeys](#4-core-user-journeys)
5. [Agent Architecture](#5-agent-architecture)
6. [Skill Architecture](#6-skill-architecture)
7. [Tool Architecture](#7-tool-architecture)
8. [Android Architecture](#8-android-architecture)
9. [Backend Architecture](#9-backend-architecture)
10. [AI Architecture](#10-ai-architecture)
11. [Voice Architecture](#11-voice-architecture)
12. [Web Agent Architecture](#12-web-agent-architecture)
    - [12a. Web Client Architecture](#12a-web-client-architecture)
13. [Developer Agent Architecture](#13-developer-agent-architecture)
14. [GitHub Architecture](#14-github-architecture)
15. [Security Architecture](#15-security-architecture)
16. [Permission Architecture](#16-permission-architecture)
17. [Memory Architecture](#17-memory-architecture)
18. [Task Engine](#18-task-engine)
19. [Subscription Model](#19-subscription-model)
20. [Trial Model](#20-trial-model)
21. [Usage / Credits](#21-usage--credits)
22. [UI/UX System](#22-uiux-system)
23. [Navigation](#23-navigation)
24. [Data Model](#24-data-model)
25. [API Boundaries](#25-api-boundaries)
26. [Testing Strategy](#26-testing-strategy)
27. [Privacy Strategy](#27-privacy-strategy)
28. [Development Phases](#28-development-phases)
29. [MVP Scope](#29-mvp-scope)
30. [Future Roadmap](#30-future-roadmap)
31. [Technical Decisions](#31-technical-decisions)
32. [Risks and Limitations](#32-risks-and-limitations)

---

## 1. Product Vision

ZARVIS MOBILE is a **Universal AI Digital Agent** for Android. It is not a chatbot, not a
voice assistant shell, not a phone-automation macro tool, and not a coding assistant alone.

Core promise:

> "Tell your AI what you want done. It understands the goal, plans the work, uses the
> appropriate skills and tools, completes whatever it can legitimately complete, and
> reports the result."

The user interacts entirely in natural language (English, Hindi, Hinglish) — by voice or
text. They never need to learn commands, understand APIs, or operate a "complicated app."
The product exposes **outcomes**, not features.

Reference interactions the product must eventually support (not all in MVP):

- "मेरे लिए आज का जरूरी काम ढूंढो।" (personal/productivity)
- "मेरे लिए एक अच्छा birthday message तैयार करो।" (creative)
- "इस PDF को आसान हिंदी में समझाओ।" (documents)
- "मेरे business के लिए आज की social media post तैयार करो।" (business)
- "सबसे अच्छा phone ढूंढकर compare करो।" (web/research)
- "मेरी website में contact form जोड़ो।" (developer)
- "मेरे GitHub project को check करके errors ठीक करो।" (developer)

## 2. Target Users

| Segment | Need | Primary value |
|---|---|---|
| Everyday consumers (India-first, Hindi/Hinglish speakers) | Daily tasks, reminders, information | Voice-first simplicity |
| Students | Learning, summarization, explanation | Education skills |
| Small business owners | Marketing, invoices, customer comms | Business skills |
| Professionals | Email, docs, research, planning | Productivity skills |
| Developers | Coding, GitHub, debugging, deployment | Developer Agent |
| Power users | Automation, multi-step workflows | Task/Automation engine |

The product must be approachable to a **non-technical first-time user** while still being
powerful enough for a developer to fix a GitHub repository from their phone.

## 3. Product Principles

1. **Outcome over interface.** The user states a goal; the system finds the path.
2. **Skill-first, not screen-first.** Every capability is a discoverable, composable Skill.
3. **Security is a boundary, not a checkbox.** The AI never gets raw device/OS/API access —
   only registered, validated Tools behind permission, risk, and subscription checks.
4. **Never fake success.** Failures, missing permissions, and platform limits are always
   reported honestly, with a clear next step for the user.
5. **Voice-first, text-always.** Every capability reachable by voice must also be reachable
   by typing; voice is a UX preference, not a hard requirement.
6. **Bilingual by default.** English, Hindi, and Hinglish are first-class, not a bolt-on
   localization layer.
7. **Server is authoritative for money and identity.** Client state (subscription, usage,
   entitlements) is a cache; the backend is the source of truth.
8. **Grow through skills, not rewrites.** New capability categories must be addable as
   Skills/Agents without touching the orchestrator core.
9. **Progressive trust.** Permissions and risky actions are requested when needed, not all
   at once at install time.
10. **Consistency across agents.** All agents share one context, memory, permission,
    entitlement, and tool-registry system. No agent is an isolated silo/app.

## 4. Core User Journeys

### 4.1 First-run (Onboarding → Trial)
Install → Welcome → capability tour → language selection → minimal permission requests →
account creation (or guest) → free trial activated → Home screen.

### 4.2 Voice task (happy path)
Home → tap orb / "Hey Zarvis" → LISTENING → STT transcript shown live → UNDERSTANDING
(intent + entity extraction) → PLANNING (orchestrator selects agent/skill) → risk & permission
check → (confirmation if MEDIUM/HIGH risk) → EXECUTING (tool calls, progress shown) →
VERIFYING → SPEAKING/showing result → task saved to history.

### 4.3 Text task
Same pipeline as 4.2, entered via the text composer instead of voice; TTS output is optional.

### 4.4 Multi-step task ("audit my website")
Orchestrator decomposes the goal into a Task with ordered Steps (see §18), shows live
progress per step, allows pause/cancel/retry, and produces a final report artifact.

### 4.5 Developer journey
"मेरे GitHub project को check करके errors ठीक करो" → Developer Orchestrator analyzes the
repo (read-only) → produces a plan → (user approval for any write) → Coding Agent makes
changes on a branch → Testing/Debugging/Security agents validate → PR opened → user notified.
Destructive or direct-to-main changes are never made without explicit confirmation.

### 4.6 Upgrade journey
User hits a trial/usage limit → system explains the limit honestly → presents plan options →
purchase via platform billing → backend verifies receipt → entitlements updated → task resumes.

### 4.7 "What can you do?" discovery
User asks in any supported language → capability catalogue rendered by category (from the
live Skill Registry, not a hardcoded screen) → user can tap a category to try an example.

## 5. Agent Architecture

```
                         ┌─────────────────────────┐
                         │      AI ORCHESTRATOR     │
                         │  (intent → plan → route) │
                         └────────────┬─────────────┘
                                      │  shared: context, security,
                                      │  permissions, tool registry,
                                      │  entitlements, usage, memory
        ┌──────────────┬─────────────┼─────────────┬──────────────┬─────────────┐
        │              │             │             │              │             │
 ┌──────▼─────┐ ┌──────▼─────┐ ┌─────▼──────┐┌─────▼──────┐┌──────▼─────┐┌──────▼─────┐
 │  Personal  │ │   Phone    │ │    Web     ││  Document  ││  Business  ││  Research  │
 │   Agent    │ │   Agent    │ │   Agent    ││   Agent    ││   Agent    ││   Agent    │
 └────────────┘ └────────────┘ └────────────┘└────────────┘└────────────┘└────────────┘
        ┌──────────────┬─────────────┐
 ┌──────▼─────┐ ┌──────▼─────┐ ┌─────▼───────┐
 │  Creative  │ │ Developer  │ │ Automation  │
 │   Agent    │ │   Agent    │ │    Agent    │
 └────────────┘ └────────────┘ └─────────────┘
```

- The **Orchestrator** owns intent understanding, planning, agent selection, and result
  aggregation. It never executes Tools directly — it always delegates to an Agent, which
  calls Skills, which call Tools.
- Each **Agent** is a bounded-context planner/executor for one capability category. Agents
  are stateless services over shared context; they hold no private user data store.
- Agents communicate only through the Orchestrator's shared `AgentContext` and the common
  `ToolRegistry` — never directly with each other's internals. This keeps agents addable/
  removable without cross-wiring.
- MVP ships the Orchestrator plus **Personal, Web (research-only), Document, and Developer**
  agents fully wired with a real reference skill each (§29). **Phone, Business, Research,
  Creative, and Automation** are registered as **foundation interfaces** (agent contract +
  category entry in the Skill Registry, no handler yet) — proving the architecture accepts
  them without orchestrator changes, while their first working skill ships in Phases 4–9
  (§28) rather than being simulated here.

## 6. Skill Architecture

A **Skill** is the unit of capability. Skills are declarative + an execution handler; the
Orchestrator/Agents select skills dynamically from a registry rather than hardcoding
`if`/`switch` logic per feature.

```kotlin
data class SkillDefinition(
    val id: String,                       // "web.search", "docs.summarize"
    val name: String,
    val description: String,               // used for LLM tool-selection
    val category: SkillCategory,           // PHONE, WEB, DOCUMENTS, BUSINESS, ...
    val capabilities: List<String>,
    val requiredPermissions: List<PermissionType>,
    val requiredEntitlement: EntitlementLevel,   // FREE, TRIAL, PLUS, PRO, BUSINESS...
    val usageCost: UsageCost,              // credit units charged on success
    val riskLevel: RiskLevel,              // LOW, MEDIUM, HIGH
    val requiresConfirmation: Boolean,
    val inputSchema: JsonSchema,
    val outputSchema: JsonSchema,
    val handler: SkillHandler              // suspend fun execute(input, context): SkillResult
)
```

Directory layout mirrors categories from the product vision:
`skills/{phone,web,research,documents,productivity,business,creative,education,seo,
developer,github,automation}`. Each skill package is self-contained: definition + handler +
tests. Adding a skill never requires modifying the Orchestrator.

Skills are versioned and registered at app/backend startup into an in-memory
`SkillRegistry`; the backend exposes a catalogue endpoint so the client can render "What can
you do?" from live data.

## 7. Tool Architecture

Tools are the only way any Agent/Skill touches the outside world (device APIs, network,
filesystem, external services). The AI/LLM never gets raw execution access.

```
AI (plans a tool call)
   → Tool Registry (does this tool exist? is it enabled?)
   → Tool Validation (input schema, argument sanity)
   → Permission Check (Android runtime permission / OAuth scope granted?)
   → Risk Check (LOW auto-run, MEDIUM/HIGH require confirmation)
   → Subscription/Entitlement Check (plan allows it? credits available?)
   → Confirmation (user-facing prompt for MEDIUM/HIGH risk)
   → Tool Execution (sandboxed handler, timeout-bound)
   → Verification (did it actually do what was claimed?)
   → Result (structured ToolResult, success or explained failure)
```

This pipeline is implemented once, centrally (`core/tooling`), and every Skill handler
runs through it — no Skill can bypass a stage. Tool execution is logged (redacted) for
observability (§30) and abuse detection.

## 8. Android Architecture

- **Language:** Kotlin. **UI:** Jetpack Compose + Material 3 (custom design system on top,
  see §22). **Min SDK:** 26 (Android 8.0) — covers voice/Compose requirements broadly.
  **Target/Compile SDK:** latest stable at build time.
- **Pattern:** Clean Architecture, unidirectional data flow (MVI-flavored: `UiState` +
  `Intent`/`Event` + `ViewModel` with Kotlin `StateFlow`).
- **DI:** Hilt (Dagger) — constructor injection throughout, no service locators.
- **Async:** Kotlin Coroutines + Flow.
- **Modules** (Gradle multi-module, dependencies flow inward):

```
app/                    # Composition root, navigation graph, DI wiring, entry Activity
core/
  core-ui/              # Design system: theme, typography, components, motion
  core-common/          # Result types, dispatchers, extensions, logging facade
  core-security/        # Secure storage, Android permission bridge (real ContextCompat checks)
  core-tooling/         # Android-side bindings (permission bridge, confirmation UI hook)
                         # wiring platform ports into the pure pipeline defined in domain/
domain/                 # Pure Kotlin (no Android deps): entities, use cases, agent/skill/
                         # tool contracts, the Tool pipeline (registry, validation, risk,
                         # entitlement) and orchestrator planning logic, all built against
                         # injected ports (PermissionPort, EntitlementPort, UsagePort,
                         # ConfirmationPort) — fully unit-testable on plain JVM, no emulator
data/
  data-remote/          # Backend API client (Retrofit/OkHttp), DTOs, auth interceptor
  data-local/           # Room DB, DataStore prefs, local memory/task cache
  data-repository/      # Repository implementations binding domain <-> data sources
agents/                 # Orchestrator + per-category Agent implementations
skills/                 # Skill packages by category (phone/, web/, documents/, developer/, ...)
features/
  feature-onboarding/
  feature-home/
  feature-conversation/  # voice/text chat + task timeline
  feature-tasks/
  feature-developer/      # Developer Agent UI (repo picker, plan review, PR status)
  feature-subscription/
  feature-settings/       # privacy, permissions, memory controls, language
```

- **Navigation:** Jetpack Navigation Compose, single-Activity, type-safe routes per feature
  module, deep-link ready for future notification-triggered flows.
- **Reactive state:** each feature exposes a `StateFlow<UiState>` consumed by Compose via
  `collectAsStateWithLifecycle`.
- **Background work:** WorkManager for scheduled/automation tasks (§18, §30); a foreground
  service (with visible notification) for in-progress voice/task execution, respecting
  Android background-execution limits.

## 9. Backend Architecture

Android is a thin, secure client. All provider secrets, subscription verification, and
heavy orchestration live server-side.

- **Language/runtime:** TypeScript on Node.js (fast to iterate, strong ecosystem for
  webhook/GitHub/AI-provider SDKs; matches the JS/TS tooling already available in this
  environment). **Framework:** Express (minimal, explicit).
- **Structure:**

```
backend/
  src/
    api/            # HTTP route handlers (REST, versioned /api/v1)
    domain/         # Entities/use-cases mirroring domain/ concepts server-side
    ai/             # AIProvider abstraction + provider adapters (§10)
    skills/         # Server-executed skills (web agent, developer agent, github)
    agents/         # Orchestrator + agent services (mirrors mobile architecture)
    auth/           # Authentication, session/JWT issuance
    billing/        # Subscription, entitlement, receipt verification
    usage/          # Usage/credit ledger
    security/       # Risk engine, secret management, log redaction
    github/         # GitHub App/OAuth integration (§14)
    db/             # Schema + migrations
    config/
  test/
```

- **Responsibilities:** auth, subscriptions/billing, usage accounting, AI orchestration and
  provider calls, Web Agent execution, Developer Agent execution (repo analysis, codegen,
  PR creation), GitHub integration, long-running task execution, push notifications.
- **API boundary:** the Android app never calls AI providers, GitHub, or arbitrary web
  endpoints directly for anything requiring a secret — it calls the ZARVIS backend, which
  proxies with server-held credentials. Direct-from-device calls are limited to
  no-secret, user-authorized flows (e.g., OS-level intents).
- **Persistence:** relational DB (PostgreSQL in production; the reference backend in this
  repo ships an interface-based store with an in-memory/SQLite adapter for local dev, so the
  same code targets Postgres later without an API change).
- **Long-running tasks:** modeled as jobs with status polling + webhook/push callback,
  since multi-step agent tasks (website audits, repo fixes) can exceed a single request's
  lifetime.

## 10. AI Architecture

No feature hardcodes a single AI vendor. A provider-agnostic contract is used everywhere:

```ts
interface AIProvider {
  id: string;                        // "anthropic", "openai", "google", "local"
  generate(request: AIRequest): Promise<AIResponse>;
  streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk>;
}

interface AIRequest {
  systemPrompt: string;
  messages: ConversationMessage[];
  tools?: ToolDefinition[];          // derived from the active Skill Registry
  modelConfig: ModelConfiguration;   // model id, temperature, maxTokens...
}

interface AIResponse {
  message: ConversationMessage;
  toolCalls: ToolCall[];
  usage: TokenUsage;
}
```

- `ProviderFactory` selects a provider/model per request (cost, capability, region,
  fallback chain). Swapping or adding a provider means adding one adapter, not touching
  callers.
- **Google Gemini is this repository's first wired, real provider** (`backend/src/ai/
  geminiProvider.ts`, registered as `id: "google"`). Setting `GEMINI_API_KEY`
  (`backend/.env.example`) is the entire integration step: `providerFactory.ts` resolves the
  turn-loop's `defaultModelConfig` to Gemini automatically whenever that key is present, and
  falls back to `MockAIProvider` when it isn't — no caller of `getProvider`/`Orchestrator`
  changes either way. This is the "config-only change, not a redesign" §32 previously called
  out as pending.
- **Important constraint:** a developer's Claude subscription (e.g., Claude Pro, or this
  Claude Code session) is a *development environment*, not a runtime API credential. The
  shipped product calls AI providers via **server-held API keys** billed to the product's
  own account, requested through the backend `ai/` module — never bundled in the APK,
  never assumed to exist because the developer happens to have a Claude subscription. The
  same rule applies to `GEMINI_API_KEY`: it is a backend environment variable, never bundled
  in the APK or the web client's static assets (§15).
- Tool-calling loop: Orchestrator builds `ToolDefinition[]` from the currently-enabled
  Skill Registry (filtered by user entitlement/permissions) → sends to the provider → model
  returns `ToolCall`s → each goes through the Tool Architecture pipeline (§7) → results are
  fed back to the model → final natural-language response returned to the user.

## 11. Voice Architecture

State machine (single source of truth, drives both UI and TTS/STT lifecycle):

```
IDLE → LISTENING → UNDERSTANDING → PLANNING → EXECUTING → SPEAKING → IDLE
                                                     ↘ ERROR ↗
```

- **STT:** Android `SpeechRecognizer` (on-device where available) for MVP; abstracted
  behind a `SpeechToTextEngine` interface so a cloud STT provider can be swapped in later
  without UI changes.
- **TTS:** Android `TextToSpeech` engine for MVP, Hindi + English voices; same
  provider-abstraction pattern (`TextToSpeechEngine`) for future higher-quality voices. The
  web client (§12a) already has a higher-quality option live: `POST
  /api/v1/tts/synthesize` calls Gemini's native audio voice server-side (§10,
  AI_ARCHITECTURE.md "Native audio voice") — the same underlying voice technology behind
  the Gemini app's voice mode — falling back to the browser's built-in engine if that call
  fails. Wiring the Android `TextToSpeechEngine` to the same backend endpoint instead of
  the on-device engine is a natural follow-up, not implemented here yet.
- Every state is rendered distinctly in the UI (orb animation + status text) so the user
  always knows what the system is doing.
- Full interruption support: tapping the orb or speaking again while SPEAKING/EXECUTING
  cancels the current turn cleanly (coroutine cancellation, not force-kill).
- Text input is always available side-by-side with voice — never voice-only.

## 12. Web Agent Architecture

- Capabilities: search, research, webpage understanding/extraction, comparison, document
  discovery, form assistance (fill-and-hand-back, not autonomous submission of sensitive
  forms), content generation, research reports.
- Executes **server-side** (backend `skills/web`) using a fetch/render pipeline behind the
  Tool pipeline (§7): every fetch is a Tool call, rate-limited and logged.
- **Hard constraints (non-negotiable):** never attempts to bypass CAPTCHA, authentication,
  payment security, access controls, or anti-abuse mechanisms. If a page requires login,
  payment, or a CAPTCHA, the agent stops and returns control to the user with a clear
  explanation — it does not simulate a human to evade detection.
- Structured extraction results carry source URLs for user verification (no un-sourced
  claims presented as fact when they originate from a fetched page).

## 12a. Web Client Architecture

Distinct from the **Web Agent** (§12, a server-side skill that researches the open web on
the user's behalf): this is the **browser client** — a second, thin frontend for the same
product, served from the product's own domain, [zarvismobile.com](https://zarvismobile.com),
alongside the Android app rather than instead of it. It exists so "run ZARVIS in a browser"
requires no install, matching Product Principle #1 (outcome over interface) for a user who
just wants to try the agent from a link.

- **No separate backend.** The web client calls the exact same versioned API (§25) the
  Android app calls — `GET /api/v1/skills`, `POST /api/v1/orchestrator/turn`, `POST
  /api/v1/auth/*` — so a skill added once (§6) is immediately usable from both clients with
  zero web-specific server code.
- **Serving:** `backend/src/server.ts` serves the static client (`web/` at the repo root)
  from the same Express app and origin as the API, so the one production domain
  (zarvismobile.com) serves both the app shell and `/api/v1/*` — no CORS hop for the default
  deployment. `CORS_ORIGINS`/`PUBLIC_APP_URL` (`backend/.env.example`) exist for the case
  where the client is instead deployed to a separate static host (e.g. a CDN) pointed at the
  same backend.
- **Deployment target: Vercel.** `vercel.json` + `api/index.ts` (both repo root) wrap the
  same `buildContainer()`/`buildServer()` composition root as a Vercel serverless function,
  with `web/` served as static files by the same project — see DEVELOPMENT.md "Deploying to
  Vercel" for the exact setup steps and the honestly-documented limitation this implies
  (the in-memory `Store` doesn't persist reliably across cold serverless instances; a real
  database is the pre-launch fix, not a redesign).
- **No framework/build step.** Plain HTML/CSS/JS (`web/index.html`, `styles.css`, `app.js`)
  deliberately mirrors the zero-credential, zero-setup spirit of `MockAIProvider` (§10):
  the product is demoable by opening a URL, no `npm install`/bundler required for the client
  itself (the backend it talks to still needs `npm install` per DEVELOPMENT.md).
- **Session:** mirrors the Android app's guest bootstrap (§32) — on first load the client
  calls `POST /api/v1/auth/signup` with a generated, unguessable device-scoped email so a
  first-time visitor starts talking to ZARVIS immediately, no signup form. Tokens are kept in
  `localStorage`, scoped to the browser/device like the Android app's Keystore-backed token
  storage is scoped to the device (§15) — this is a convenience cache, not a durable identity;
  linking a real account across devices is the same open item tracked in §32.
- **Voice (§11):** uses the browser-native Web Speech API (`SpeechRecognition` for STT,
  `speechSynthesis` for TTS) behind the same IDLE→LISTENING→UNDERSTANDING→EXECUTING→SPEAKING
  state machine the orb renders on Android, rather than Android's `SpeechRecognizer`/
  `TextToSpeech` — a different concrete engine behind the same product-level state machine,
  consistent with §11's "abstracted behind an interface so a provider can be swapped."
  Voice input degrades to text-only when the browser doesn't support it (Safari/older
  browsers) — never a dead end (Product Principle #4). Voice output tries Gemini's native
  audio voice first (`POST /api/v1/tts/synthesize`) before falling back to
  `speechSynthesis` — see above and AI_ARCHITECTURE.md "Native audio voice".
- **Hands-free wake word (web only, differs from §11's Android orb-tap behavior):** arms
  itself automatically on page load (explicit product request — no tap needed); tapping
  the orb here mutes/unmutes it instead of cancelling the current turn like Android's orb
  does. Say "Zarvis" (or a common mishearing like "Jarvis") followed by a command. This is
  a software approximation of a wake word (continuous `SpeechRecognition` with
  auto-restart), not a true low-power OS wake-word detector — it only works while the tab
  is foregrounded. The muted/armed choice is never persisted across a reload — it always
  re-arms fresh rather than remembering a muted state indefinitely. Deliberately quiet by
  design: arming/muting shows no bubble or toast (explicit product feedback — it should
  listen in the background without announcing itself); the subtle cyan ring around the orb
  is the transparency trade-off (§15 "never secretly monitor the device"), and the first
  visible/audible reaction happens only once "Zarvis" is actually heard. See
  DEVELOPMENT.md "Hands-free 'wake word' mode".
- **Personalization:** the client sends an optional `userName` with every orchestrator
  turn (`localStorage["zarvis.userName"]`, no settings UI yet — see §32) so replies can
  address the user by name; a display label only, never an identity/auth claim.
- **Bilingual (§3.6):** a lightweight English/Hindi copy toggle, extended the same way the
  Android app's locale system is meant to grow — this is not a replacement for real i18n
  infrastructure, just enough to prove the product's bilingual promise from a browser too.
- **What it does not do:** it does not duplicate the Tool pipeline (§7) or entitlement
  resolution (§19) — those live only in the backend, exactly as ARCHITECTURE.md's
  "Backend/Android parity note" already requires for any client. The web client is a UI over
  the same authoritative backend, not a second implementation of product logic.

## 13. Developer Agent Architecture

```
Developer Orchestrator
 ├── Requirement Agent   — clarifies the ask into a concrete spec
 ├── Planning Agent      — breaks the spec into ordered, reviewable steps
 ├── Repository Agent    — clones/reads repo, builds a structural understanding
 ├── Coding Agent        — writes/edits code on a branch
 ├── Testing Agent       — runs/writes tests
 ├── Debugging Agent     — diagnoses failures, iterates fixes
 ├── Code Review Agent   — self-review pass against diffs
 ├── Security Agent      — checks for injected vulnerabilities/secrets
 └── Deployment Agent    — opens PR / triggers deploy (never auto-merges)
```

Flow: `Requirement Analysis → Project Analysis → Plan → Code → Test → Debug → Security
Review → Final Review → User Approval → Commit/PR/Deployment`.

Guardrails: read-only analysis requires no confirmation (LOW risk); any write (branch
creation, file edits) is MEDIUM risk and summarized to the user; **direct pushes to a
protected/default branch, force-push, and history rewriting are always HIGH risk and
require explicit per-action confirmation** — the default path is always a branch + PR.
Never blindly applies destructive changes.

## 14. GitHub Architecture

- `backend/src/github/` wraps a GitHub App (preferred) or OAuth token: repository read,
  branch/commit/file operations, PR creation, and repo-structure analysis, all behind an
  internal `GitHubClient` interface — call sites never touch raw REST/GraphQL.
- The Repository Agent (§13) always builds a structural understanding (languages, build
  system, test setup, CI config) **before** any modification is proposed.
- Mobile app never holds a GitHub token; it calls the backend, which holds the
  installation/OAuth credential server-side.

## 15. Security Architecture

- **Secure storage:** Android Keystore-backed encryption for local secrets/tokens
  (`core-security`), `EncryptedSharedPreferences`/DataStore for sensitive prefs.
- **AuthN:** email/OAuth-based account, short-lived access token + refresh token, issued by
  backend `auth/`.
- **AuthZ:** every backend route checks entitlement + resource ownership; every tool call
  checks permission + risk + entitlement (§7) before execution.
- **Tool validation:** strict JSON-schema validation of every tool input server-side, even
  though the client also validates — never trust the client.
- **Secret management:** provider API keys, GitHub credentials, and DB credentials live in
  backend environment/secret manager only. **Never embedded in the APK.**
- **Logging redaction:** a central logging facade strips known-sensitive field names
  (password, otp, token, secret, authorization, cardNumber, ...) before any log line is
  emitted, both client and server.
- **Never:** log passwords/OTPs/tokens, bypass Android security, secretly monitor the
  device, capture credentials, bypass app authentication, or perform unauthorized
  surveillance — these are absolute constraints, not configurable.

## 16. Permission Architecture

- Android runtime permissions are requested **progressively**, only when a skill that needs
  them is first invoked — never all at once at onboarding.
- Each `SkillDefinition.requiredPermissions` maps to Android permission strings; the Tool
  pipeline checks `ContextCompat.checkSelfPermission` before execution and triggers the
  system rationale/request flow if missing, surfacing a clear in-product explanation of
  *why* the permission is needed before the OS dialog appears.
- A denied permission is treated as a normal failure path (§29 Error Philosophy) — the
  assistant explains the limitation, it never nags repeatedly or dark-patterns the user.
- Settings screen exposes a full permission/entitlement audit: what's granted, why, and a
  one-tap revoke path (deep-links to Android App Settings where OS-level revocation lives).

## 17. Memory Architecture

Categories: conversation context (session-scoped), preferences (language, tone, default
skills), active tasks, project context (Developer Agent), user-approved long-term memories.

- Nothing is written to long-term memory automatically from sensitive categories
  (financial, health, credentials-adjacent) — only explicit user-approved "remember this"
  moments persist beyond the active session/task.
- User controls (Settings → Memory & Data), all backend-enforced not just hidden client UI:
  view memory, delete a memory item, clear conversation, clear all data, export data,
  delete account (cascades: memory, tasks, usage history, subscription record retained only
  as required by law/billing).

## 18. Task Engine

A reusable engine for multi-step work, independent of which Agent produces the steps.

```ts
interface Task {
  id: string; goal: string; status: TaskStatus;   // PENDING|RUNNING|PAUSED|DONE|FAILED|CANCELLED
  steps: TaskStep[]; createdBy: AgentId; riskLevel: RiskLevel;
}
interface TaskStep {
  id: string; description: string; toolCallId?: string;
  status: StepStatus; result?: StepResult; retryCount: number;
}
```

- Supports pause, cancel, retry (per-step, bounded retry count), and resume from the last
  completed step (not restart-from-zero).
- Progress is streamed to the client (SSE/WebSocket from backend for long tasks; local Flow
  for on-device-only tasks) so the UI can render live per-step status.
- Failure recovery: a failed step surfaces its explained error and offers retry/skip/cancel
  — it never silently continues on a false-success basis.

## 19. Subscription Model

Entities: `User → Account → Plan → Subscription → Entitlement`, plus `Trial`, `Usage`,
`CreditBalance`, `Transaction` (§21, §24).

Plans (extensible enum, not hardcoded per-screen): `FREE, TRIAL, PLUS, PRO, BUSINESS,
ENTERPRISE`. MVP activates `FREE`, `TRIAL`, and `PRO`; `PLUS`/`BUSINESS`/`ENTERPRISE` are
modeled in the schema now so they need no migration later.

- **Entitlement resolution is centralized**: one backend service (`billing/entitlements.ts`)
  answers "can this account use skill X right now?" — no plan/price logic is duplicated in
  UI or in individual skills. The mobile app calls this before offering an action, and the
  backend re-checks it authoritatively inside the Tool pipeline regardless of what the
  client believed.
- Billing integration point: Google Play Billing on Android, verified server-side via the
  Play Developer API (webhook + server verification of purchase tokens) — client-reported
  purchase state is never trusted for entitlement grants.

## 20. Trial Model

- New accounts receive a **time-boxed + usage-boxed** trial (`Trial` entity: `startsAt`,
  `expiresAt`, `includedCredits`, `includedSkillCategories`) granting access to a curated
  set of skills across multiple categories, so the user experiences the *universal agent*
  breadth, not one narrow feature.
- On trial expiry (time OR credits, whichever first), the account transitions to `FREE`
  (a minimal always-available tier: LOW-risk, low-cost skills only) and is offered `PRO`.
- Trial state is resolved server-side on every entitlement check — the device clock is
  never trusted for expiry.

## 21. Usage / Credits

- Every skill declares a `UsageCost` (credit units). Categories tracked: AI usage (tokens),
  web research (fetches), document processing (pages/MB), code generation (LLM calls),
  repository analysis, long-running agent tasks (wall-clock/step count), future media
  generation.
- `usage/` ledger records one entry per billable tool execution (`accountId, skillId,
  cost, timestamp, taskId`), append-only, server-authoritative.
- Enforcement happens in the Tool pipeline's Subscription/Entitlement Check stage (§7):
  insufficient balance blocks execution *before* any cost is incurred, with a clear
  in-product explanation and upgrade path — never a partial charge for a blocked action.
- Client-side usage counters are read-only projections for UX (progress bars, "X credits
  left") and are never used to authorize execution.

## 22. UI/UX System

**Direction:** futuristic, premium, minimal, trustworthy, modern, voice-first. Not a
generic chatbot UI.

- **Design tokens** (`core-ui/theme`): color scales (dark-first, with a full light theme),
  an 8dp spacing scale, type scale (Latin + Devanagari-capable font pairing for
  Hindi/English), elevation/motion tokens, and a consistent corner-radius system.
- **Core components:** buttons (primary/secondary/ghost/destructive), cards, the AI Orb
  (animated, state-driven per §11), input composer (text + mic toggle), chips (skill
  categories), bottom sheets (confirmation, skill details), dialogs (risk confirmation),
  loading states (skeletons, per-step progress), empty states, error states (with a clear
  next action, never a dead end).
- **Themes:** dark (default) and light, both meeting WCAG AA contrast; full accessibility
  support (TalkBack labels, scalable type, min touch targets 48dp).
- **Motion:** purposeful, state-communicating (orb pulses while LISTENING, morphs while
  PLANNING/EXECUTING) — never decorative-only animation.

### Home Screen (concept)
```
   ZARVIS MOBILE
   "आप क्या करवाना चाहते हैं?"

        [ AI ORB ]

   [ 🎙 Speak ]   [ Type your task ]

   Quick categories: Phone · Web · Work · Documents · Developer

   Recent Tasks
   Active Task (if any, with live progress)
   Subscription Status
```

## 23. Navigation

Single-Activity, Navigation Compose, top-level graph:

`Onboarding → Home ⇄ {Conversation, Tasks, Developer, Subscription, Settings}`,
with Conversation reachable directly from Home's orb/composer, deep-linkable from
notifications (task completed, PR ready, trial ending).

## 24. Data Model (core entities)

```
User(id, email, authProvider, createdAt, locale)
Account(id, userId, plan, status)
Plan(id, name, priceUsd/priceInr, entitlements[])
Subscription(id, accountId, planId, status, startedAt, renewsAt, source)
Entitlement(id, planId, skillCategory|skillId, limit)
Trial(id, accountId, startsAt, expiresAt, includedCredits)
Usage(id, accountId, skillId, cost, taskId, createdAt)
CreditBalance(accountId, remaining, resetAt)
Transaction(id, accountId, amount, currency, provider, status, createdAt)
Task(id, accountId, goal, status, riskLevel, createdAt)
TaskStep(id, taskId, description, status, resultRef, retryCount)
Skill(id, name, category, riskLevel, usageCost, requiredEntitlement)
ToolExecution(id, taskId, skillId, toolId, input, output, status, createdAt)  # redacted
Memory(id, accountId, category, content, createdAt, expiresAt?)
Permission(id, accountId, type, granted, grantedAt)
```

## 25. API Boundaries

- `POST /api/v1/auth/*` — signup/login/refresh
- `GET  /api/v1/skills` — live skill catalogue (drives "What can you do?")
- `POST /api/v1/orchestrator/turn` — one conversation turn (text/voice-transcript in →
  plan/response + tool calls out), streamed
- `POST /api/v1/tasks` / `GET /api/v1/tasks/:id` / `POST /api/v1/tasks/:id/{pause,resume,
  cancel,retry}`
- `GET  /api/v1/entitlements/me` — resolved plan/usage snapshot
- `POST /api/v1/billing/webhook` — Play Billing verification callback
- `POST /api/v1/developer/*` — repo analyze/plan/apply, PR status
- `POST /api/v1/usage/charge` — records a completed, verified on-device skill execution
  against the server-authoritative credit ledger, cost looked up server-side by skill id
  (never client-supplied) — see ARCHITECTURE.md "Backend/Android parity note"
- `POST /api/v1/tts/synthesize` — Gemini native audio voice for a piece of text, returns
  `audio/wav` (§11, AI_ARCHITECTURE.md "Native audio voice"); not yet metered through the
  usage ledger above (§21) — a known gap before this could scale beyond a single account
- Versioned from day one (`/api/v1`), all authenticated routes require the access token,
  all mutating routes are idempotency-key aware for safe client retries.

## 26. Testing Strategy

- **Domain module (pure Kotlin):** JUnit5 unit tests for use cases, planning logic, risk/
  entitlement resolution — runnable on plain JVM, no emulator needed, in CI on every push.
- **Backend:** unit tests per module (`vitest`), integration tests for the Tool pipeline
  and entitlement checks against the in-memory store adapter.
- **Android UI:** Compose UI tests for critical flows (onboarding, home composer, risk
  confirmation dialog) using `compose-test`; instrumented tests deferred to Phase 12 where
  an emulator/device is available.
- **Contract tests:** shared JSON-schema fixtures for `SkillDefinition` I/O so mobile and
  backend skill implementations can't silently drift.
- CI must run: lint, domain unit tests, backend unit tests on every PR (Phase 12 hardens
  this into a required check).

## 27. Privacy Strategy

- Data minimization: only what a skill's declared `inputSchema` needs is sent to that
  skill's handler; the AI provider only receives what's needed for the current turn plus
  explicitly-approved memory.
- User-facing privacy controls mirror §17 (view/delete/export/clear/delete-account).
- **Observability stays privacy-respecting by construction.** Error reporting, task-status
  tracking, AI-request tracing, tool-execution status, and performance monitoring all key
  off structured identifiers (`taskId`, `skillId`, `toolId`, status, latency, error class)
  — never raw conversation or document content. `ToolExecution` records (§24) apply the
  same redaction facade as logging (§15) before persistence, so tracing data and audit
  logs can't become a side channel for sensitive content. Usage analytics (feature used,
  task succeeded/failed, latency) are aggregate/event-based only.
- A `PRIVACY.md` (repo root) documents this in user-facing language; this section is the
  binding technical policy behind it.

## 28. Development Phases

| Phase | Scope |
|---|---|
| 0 | Product specification (this document) |
| 1 | Android + UI foundation, module skeleton, design system |
| 2 | Voice + AI conversation (orb state machine, STT/TTS, orchestrator turn loop) |
| 3 | Skill/Tool architecture (registry, pipeline) end-to-end with 2–3 real skills |
| 4 | Phone Agent (open app, contacts, reminders) |
| 5 | Web Agent (search, extraction, comparison) |
| 6 | Documents/Productivity skills |
| 7 | Developer Agent (repo analysis → PR) |
| 8 | GitHub integration hardening |
| 9 | Task/automation engine (scheduling, WorkManager) |
| 10 | Subscription + premium (Play Billing, entitlement enforcement) |
| 11 | Security + privacy hardening (pen-test pass, redaction audit) |
| 12 | Testing + production readiness (CI required checks, instrumented tests) |

This session executes **Phase 0** fully and lays the buildable skeleton for **Phase 1–3**
(architecture, design system, orchestrator/skill/tool contracts, 2–3 working reference
skills end-to-end) so every later phase has real code to extend rather than a blank module.

## 29. MVP Scope

Included in this repository's first implementation pass:
- Premium Home UI, onboarding flow, design system (dark+light), navigation shell.
- Voice/text input with the full IDLE→...→SPEAKING state machine wired to a mock/local
  response path (real provider call wired through the backend contract, provider adapter
  stubbed for local dev).
- Orchestrator + Skill Registry + Tool pipeline implemented in `domain`/`core-tooling`,
  unit-tested on the JVM.
- Reference skills proving the architecture across categories: `personal.reminder`
  (LOW risk, on-device), `web.search` (MEDIUM cost, backend-executed, mocked provider),
  `docs.summarize` (backend-executed), `developer.analyze_repo` (read-only, backend).
- Backend service (`backend/`) with auth stub, skill catalogue endpoint, orchestrator turn
  endpoint (mocked AI provider by default, real adapter interface ready), entitlement
  resolution, usage ledger, in-memory/SQLite store.
- Subscription/entitlement/trial data model wired end-to-end with mock billing (Play
  Billing integration point documented, not live — requires a Play Console app listing
  this repo does not have).
- Security/permission foundation: Tool pipeline, permission bridge, secure storage helper,
  logging redaction facade.
- "What can you do?" screen driven by the live Skill Registry.
- A **browser web client** (§12a) at the product's own domain, zarvismobile.com, serving
  the same conversation/skill-catalogue experience over the same API the Android app uses —
  no separate backend, no build step.
- A **live AI provider adapter** (Google Gemini, §10) wired behind the existing
  provider-agnostic contract, selected automatically when `GEMINI_API_KEY` is configured.

Explicitly **not** in this pass (documented as planned, not faked): a *deployed, credentialed*
production environment (this repository ships the Gemini adapter and domain wiring, not a
live server with a key already loaded — see §32), live Play Billing, Phone Agent's actual
call/contacts intents beyond an "open app" skill, full Web Agent scraping pipeline,
instrumented/emulator test runs (no Android SDK in this build environment — see §32).

## 30. Future Roadmap

Beyond Phase 12: additional skills per category (§ product vision list), local/offline
model fallback, richer automation (multi-trigger workflows), team/business seats under
`BUSINESS`/`ENTERPRISE` plans, expanded observability (tracing dashboards), multi-language
expansion beyond Hindi/English/Hinglish, on-device model exploration for latency-sensitive
LOW-risk skills.

## 31. Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Mobile language/UI | Kotlin + Jetpack Compose + Material 3 | Modern Android standard, best Compose/voice/animation support |
| Architecture pattern | Clean Architecture + MVI-flavored ViewModels | Testability, unidirectional flow fits task/voice state machines |
| DI | Hilt | Standard, compile-time safe, less boilerplate than manual Dagger |
| Backend language | TypeScript/Node.js + Express | Fast iteration, strong AI/GitHub SDK ecosystem, available in this build env |
| DB (prod target) | PostgreSQL | Relational integrity for billing/entitlements; interface-based store ships now, Postgres adapter is additive later |
| DB (local/dev, this repo) | In-memory adapter behind a `Store` interface (Postgres adapter additive later, same interface) | No external DB dependency needed to run/test locally; zero-migration path to Postgres |
| AI provider integration | Server-side only, provider-agnostic `AIProvider` interface | Never ship secrets in the APK; swappable providers |
| Billing | Google Play Billing, server-verified | Android-native, authoritative server check per §19 |
| Module boundaries | `domain` pure Kotlin, no Android deps | Enables fast JVM unit testing without an emulator |
| Voice engines | Android `SpeechRecognizer`/`TextToSpeech` behind interfaces | Ship MVP without cloud STT/TTS cost; swappable later |

## 32. Risks and Limitations

- **No Android SDK in this build environment.** The Gradle/Android project is written to
  compile under a standard Android Studio/SDK setup, but this session cannot run a full
  Android Gradle build or instrumented tests here. The pure-Kotlin `domain` module and the
  Node/TypeScript `backend` **are** built/tested in this session as real, verifiable
  correctness signals. This is called out explicitly in the final report rather than
  claiming an unverified Android build succeeded.
- **The Gemini adapter has been live-verified, but no key is committed to this repository.**
  A real `GEMINI_API_KEY` was configured locally (never committed — `.env` is git-ignored)
  and exercised end-to-end against the real Generative Language API: `GET /health` reported
  `provider: "google"`, and live turns correctly answered a direct question, selected
  `web.search` for a shopping query, and selected `docs.summarize` for a summarization
  query — genuine model-driven tool selection, not the keyword-matching mock. The
  downstream skill results themselves are still `MockSearchProvider`/`NaiveSummarizer`
  output (honestly labeled as such in the response) since no live search/summarization API
  is wired — only the *AI provider* step of the pipeline is real. **No live billing
  credential exists at all** — that remains a config-only change pending a Play Console
  listing (§19). Note also: the live call surfaced that `gemini-2.0-flash` (this adapter's
  original default) has been retired by Google in favor of `gemini-3.6-flash` — the default
  in `config/env.ts`/`.env.example` was corrected accordingly; a deployment should still
  confirm the current recommended model at integration time rather than trusting any
  hardcoded default indefinitely.
- **A live-triggered bug was found and fixed in the same session:** the same Gemini error
  (before the model-name fix) crashed the *entire* backend process, because Express 4 does
  not catch a rejected promise thrown inside an `async` route handler — it becomes an
  unhandled rejection that kills the whole Node process, not just the one request. Every
  route handler that lacked its own `try`/`catch` (`orchestrator`, `developer`,
  `entitlements`, `skills`, `billing`, `usage`, most of `tasks`) is now wrapped in a shared
  `asyncHandler` (`backend/src/api/asyncHandler.ts`) that forwards the rejection to
  Express's error middleware instead, which logs it and returns an honest 500 — one failed
  AI/GitHub/billing call can no longer take down every other in-flight user's request.
- **The web client (§12a) is unverified in a real browser in this session.** It was built
  and its backend contract exercised end-to-end via `curl` against the running server
  (guest signup → skill catalogue → orchestrator turn, all returned real, correct
  responses) — but no browser (and therefore no Web Speech API STT/TTS path, no visual
  layout check) was available to click through it here. Open `web/index.html` served by a
  running backend (`npm run dev` in `backend/`, then visit `http://localhost:3000/`) to
  verify visually before relying on it.
- **Voice quality depends on Android OS engines at MVP** — acceptable for Hindi/English
  coverage on modern devices, but quality will vary by device/OEM until a cloud engine is
  wired in behind the existing interface.
- **Web Agent is intentionally limited** by design (no CAPTCHA/auth/payment bypass) — some
  user requests will legitimately be refused or handed back to the user; this is a product
  constraint, not a bug.
- **Regulatory/compliance** (payment handling, data residency, consumer protection for AI
  agents acting on a user's behalf) is out of scope for this pass and must be revisited
  before any HIGH-risk financial/account-changing skill ships.
- **No login screen yet.** `SessionRepository` (Android) bootstraps a device-scoped backend
  account automatically on first launch instead of showing a signup/login UI, so the app is
  usable immediately (§4.1's "account creation (or guest)" journey resolves to guest for
  now). Linking that account to a real email/password or OAuth identity — so a trial or
  purchase follows the user across devices — is planned, not implemented.
- **`personal.reminder` does not yet trigger an OS-level alert.** The skill validates,
  persists (Room), and lists/completes reminders through the full Tool pipeline, but does
  not yet schedule an `AlarmManager` trigger or post a notification at the due time — see
  `RoomReminderScheduler`'s doc comment. This is the first concrete gap to close in Phase 4
  (§28).
