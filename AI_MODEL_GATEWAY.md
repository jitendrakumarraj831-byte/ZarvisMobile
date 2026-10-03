# ZARVIS AI Model Gateway

This document is written in the order the work was done: **audit first, then design, then
implementation, then verification.** Section 1 was committed before any source file changed.
Later sections are added with the implementation (see the git history of this file).

- **Baseline audited:** `8c94c4c` (`main` after PR #81).
- **Scope:** `api/`, `backend/`, `web/`, `shared/`, `android/`, `vercel.json`, the CI workflows
  and the tests. No secret value was read or written.

---

## 1. Audit: how one user message becomes an AI answer (before the gateway)

### 1.1 Web path, step by step

| # | Step | File → function (line at baseline) |
|---|---|---|
| 1 | The user presses Send / Enter / the orb. One call, one `clientTurnId`. | `web/app.js` `submitUtterance` (2658) clears the input, adds the bubble, calls `runTurn` with `Logic.createClientTurnId()` (`web/logic.js` 236) |
| 2 | A new turn aborts the one in flight; the stream is opened. | `web/app.js` `runTurn` (2671): `currentTurnController.abort()`, then `apiFetch("/orchestrator/turn-stream")` (2700) with `utterance, locale, conversationId, history ≤12, clientTurnId` |
| 3 | Vercel routes `/api/*` and `/health` to the serverless function. | `vercel.json` (route `^/(api/.*|health)$`) → `api/index.ts` `handler` (115) → `getApp` (87), lazy `buildContainer()` + `buildServer()` |
| 4 | Composition root. | `backend/src/container.ts` `buildContainer` (37): store, ports, `ToolPipeline`, **`getProvider(defaultModelConfig)`**, `Orchestrator`, `GeminiTtsProvider` |
| 5 | Express middleware, then the route. | `backend/src/server.ts` `buildServer` (59): security headers → CORS → JSON body (1 MB) → per-IP limiter → `orchestratorRouter` |
| 6 | Auth, per-account limit, validation, disconnect handling. | `backend/src/api/routes/orchestrator.ts`: `POST /turn-stream` (30) → `requireAuth` → `turnLimit` (30/min/account) → `parseTurnRequest` (141, a malformed `clientTurnId` is refused) → `abortOnClientGone` (130) |
| 7 | **Idempotency ledger.** | `backend/src/agents/orchestrator.ts` `runTurn` (141) → `store.claimTurn` (151): `completed` → replay the stored result (no model, tool or charge); `in_progress` → 409 `turn_in_progress`; different text → `client_turn_id_reused`; `failed`/stale `running` (5 min) → claimed again |
| 8 | Fast paths with **no model call**. | `executeTurn` (224): greeting and creator-identity answers |
| 9 | Tool list from the user's entitlements. | `executeTurn`: `registry.all()` filtered by `executesOnDevice` and `resolveEntitlement` |
| 10 | **Planner model call**, up to `MAX_AGENT_STEPS = 5` (104). | `executeTurn` → `this.provider.generate({purpose: "planner", tools, signal, trace})` (345) → `GeminiProvider.generate` (`backend/src/ai/geminiProvider.ts` 35) → `send` (78) → `fetchWithTimeout` (249) → Gemini `generateContent` |
| 11 | Tool execution, strictly through the pipeline. | `backend/src/tooling/toolPipeline.ts` `execute` (52): registry → validation → permission → entitlement → prepare → server-issued confirmation → handler → verification → **charge only after a verified success** (151) |
| 12 | Skills that call AI themselves. | `AIContentGenerator.generate` (`ai/contentGenerator.ts` 29) → `provider.generate({purpose: "generation"})`; `GeminiSearchProvider.search` (`skills/webSearch.ts` 33) → Gemini with the `googleSearch` tool |
| 13 | Reply. | `executeTurn` persists the assistant message; the route sends SSE `meta`, `progress`, **one** `delta` with the whole text, then `done`; an `AIProviderError` becomes an SSE `error` with `type`, `code`, `retryable`, `retryAfterMs`, `quotaType`, `turnId` (`orchestrator.ts` route 65-78) |

There is no token-by-token streaming of model output to clients today. `AIProvider.streamGenerate`
exists (Gemini and mock implement it) but **no production code calls it**. "Streaming" for the
clients means real progress events plus one `delta`.

### 1.2 Android path

`ConversationViewModel.runTurn` → `AndroidOrchestrator` → `api.runTurn(OrchestratorTurnRequest)`
(`AndroidOrchestrator.kt` 146) → `POST /api/v1/orchestrator/turn` (JSON) → the same
`Orchestrator.runTurn`. The request has **no `clientTurnId`**; there is no Retry action on Android,
so a second send is a new message by the user. The DTO decoder uses `ignoreUnknownKeys`, so
additive response fields are safe. Android turns the structured 429/503 bodies into honest failed
turns (`AiServiceErrors.kt`, keyed on `AI_QUOTA_EXCEEDED`, `AI_RATE_LIMITED`, `AI_UNAVAILABLE`).

### 1.3 The other AI paths

| Path | Where | Provider coupling |
|---|---|---|
| Web search | `skills/webSearch.ts` `GeminiSearchProvider` | Gemini only: needs Google Search **grounding** to return real sources |
| Image analysis | `api/routes/documents.ts` `analyzeImageWithGemini` (39) | A private Gemini loop inside the route; gated on `env.geminiApiKey` **per request** |
| Text to speech | `api/routes/tts.ts` → `ai/geminiTts.ts` `GeminiTtsProvider` | Gemini only, independent of the chat path |
| Content generation skills | `skills/index.ts` `contentGenerator` (32) | pins `{provider: "google"}` and gates on `env.geminiApiKey` |
| Health | `server.ts` `/health` (95), `api/index.ts` fallback app | reports `defaultModelConfig.provider`; the web UI and `scripts/live-smoke.mjs` read `provider === "google"` |

`api/routes/voice.js` and `web/hooks/useVoiceAssistant.ts` are not mounted or loaded by the
shipped client, and neither calls an AI provider.

### 1.4 Retry, error and charging behaviour

- **Gemini policy** (`ai/geminiErrors.ts`): `classifyGeminiFailure` (59), `retryDelayMs` (93),
  `shouldTryNextModel` (111), `toProviderError` (116). A daily quota is never retried; a
  per-minute limit is retried once when the advised wait is ≤ 8 s; 408/5xx get at most two
  retries with backoff and jitter, then the in-provider fallback model `gemini-3.8-flash`.
- **Structured error:** `AIProviderError` (26) with the wire codes `AI_QUOTA_EXCEEDED`,
  `AI_RATE_LIMITED`, `AI_UNAVAILABLE`. Both clients and several tests depend on these strings.
- **Charging:** `ToolPipeline.execute` charges once, after a verified skill success, through
  `StoreUsagePort.charge`. Planner model calls, image analysis and TTS are not credit-charged.
  A thrown handler error is never charged.
- **Observability today:** `callTrace.ts` records one `ModelCallRecord` per provider call in an
  `AsyncLocalStorage` log; the orchestrator writes one `Turn finished` line per request.

### 1.5 Duplicate-model-call audit (the one user turn = one generation rule)

| Source of a possible duplicate | Finding |
|---|---|
| Web double submit (Enter, Enter, click) | One request: the input is cleared before the call and a new turn aborts the old one. Covered by `web/e2e/quality.e2e.cjs`. |
| Web Retry | User-initiated only; re-sends the **same** `clientTurnId`, so a finished turn is replayed (no model, no tool, no charge). |
| Web stream reconnect / replay | None. The client never reconnects on its own; a stream that ends without `done`/`error` is shown as a failed turn with Retry. The service worker never intercepts `/api/*`. |
| Voice input | Speech recognition (`continuous = false`) calls `submitUtterance` once per final result; results while speaking are ignored. |
| TTS callbacks | Speak only; they never submit a turn. TTS is a separate request path. |
| Android | `turnJob.cancel()` on a new turn, the start request guarded by `SavedStateHandle`, OkHttp's silent retry off and `SafeRetryInterceptor` retrying only GET/HEAD or connection-never-opened failures. A 401 refresh re-sends a request the auth layer rejected before any AI work. |
| Backend agent loop | Bounded to 5 steps; the same skill with the same input does not run twice; a skill whose service failed is not run again; an AI quota ends the turn. |
| Backend provider retries | Bounded by the policy above; one logical call, N HTTP requests, all counted in `trace.httpRequests`. |
| Confirmation approve | Single-use, atomically consumed; the action runs once. |
| Vercel | HTTP functions are not retried by the platform. |
| Page refresh / request replay | Same as Retry: only `clientTurnId` makes a replay safe. A client that sends no key (Android, curl) has no server-side protection, by design of the existing contract. |

### 1.6 Gaps the gateway work has to close

| # | Gap (evidence) |
|---|---|
| G1 | Gemini is hard-wired in many places: the `providerFactory.ts` registry, `skills/index.ts` (`{provider: "google"}`), the `/health` label, the `api/index.ts` fallback app, and `server.ts`' error handler, which matches the text `Gemini ... failed`. |
| G2 | A Gemini **timeout** or **network error** is a plain `Error`. It is not an `AIProviderError`, so the turn route answers with a generic failure instead of a structured, retryable one. The chat path does not retry a temporary network failure. |
| G3 | A quota or outage inside a **generation skill** is reported as a generic `handler_error` ("ran into an error"); only web search converts it to `ai_quota_exceeded`. So the orchestrator's "an AI quota ends the turn" rule does not apply to generation skills. |
| G4 | Image analysis is a private Gemini loop in a route, outside any abstraction. |
| G5 | `security/redact.ts` redacts by **key name** only: `apiKey`, `x-goog-api-key` or a key inside an error string are not redacted. |
| G6 | No capability model, no fallback, and no provider or model in the logs except `configuredModel` / `servedModel`. |
| G7 | `GeminiProvider.streamGenerate` releases the reader lock but does not cancel the upstream body when the consumer stops early. |
| G8 | No correlation id for calls that are not part of a turn (image analysis). |

### 1.7 Baseline (before any change)

| Check | Result at `8c94c4c` |
|---|---|
| `backend`: `npm run typecheck` | pass |
| `backend`: `npx vitest run` (in-memory) | 319 passed, 12 skipped |
| `backend`: `npx vitest run` with `TEST_DATABASE_URL` (real Postgres 16) | **362 passed, 2 skipped** (the two live-credential tests) |
| root: `npx tsc -p tsconfig.json --noEmit` (the Vercel entrypoint) | pass |
| web: `node --check` on the four scripts, `node --test web/tests/*.test.js` | pass, 13/13 |
| Android | **not runnable here**: no Android SDK, and `dl.google.com` is blocked (the same limit the earlier audits recorded); Android runs on GitHub Actions |
| OpenRouter | **not reachable here**: `openrouter.ai` is blocked by this environment's network policy, so nothing in this work was verified against the live OpenRouter API (see the limitations section) |
