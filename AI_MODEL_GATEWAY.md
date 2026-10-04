# ZARVIS AI Model Gateway

This document is written in the order the work was done: **audit first, then design, then
implementation, then verification.** Section 1 (the audit) was committed before any source file
changed; sections 2 to 8 describe what was built. Read §2 for how it works, §3 for every setting,
§5 for Vercel, §6 when something does not behave as expected.

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
| 4 | Composition root. | `backend/src/container.ts` `buildContainer` (37): store, ports, `ToolPipeline`, **`getProvider(defaultModelConfig)`**, `Orchestrator`, `GeminiTtsProvider` (since replaced by Edge's voices, see §2.14) |
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
| Text to speech | `api/routes/tts.ts` → `ai/geminiTts.ts` `GeminiTtsProvider` (since replaced by Edge's voices, see §2.14) | Gemini only, independent of the chat path |
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
| OpenRouter | **not reachable from the build sandbox**: `openrouter.ai` is blocked by this environment's network policy, so the unit tests use stubbed HTTP. The adapter was verified against the live API afterwards, from GitHub Actions, with the live probe (§5; what it showed is in §8) |

---

## 2. The AI Model Gateway (as built)

### 2.1 Where it sits

```
 Web (app.js)   Android            clients never name a vendor, a model or a key
      │            │
      └─────┬──────┘
            ▼
   Express routes  ──  /orchestrator/turn(-stream)   /documents/extract (images)
            │
            ▼
   Orchestrator ── ToolPipeline ── skills          one turn, one clientTurnId, bounded loop
            │            │
            ▼            ▼
        ┌────────────────────────┐
        │   ModelGateway         │   ai/modelGateway.ts: capability routing, ONE controlled
        │   (an AIProvider)      │   fallback hop, quota cooldown, metadata, logs
        └──────────┬─────────────┘
                   │  chooses by declared capability (ai/modelCatalog.ts)
          ┌────────┴─────────┐
          ▼                  ▼
    GeminiProvider     OpenRouterProvider        the only code that speaks a vendor's wire format
    (Gemini REST)      (OpenAI-compatible API)
          │                  │
   Gemini models      free / paid models         (a router such as openrouter/free picks its own)

   Not behind the gateway, by design:   web search (Gemini + Google Search grounding)
                                        text to speech (Edge neural voices, tts/, see 2.14)
```

The gateway **is** an `AIProvider` (`ai/provider.ts`), so everything that already accepted a
provider (the orchestrator, `AIContentGenerator`, the existing tests) accepts it unchanged.
Its named API: `generateText`, `generateWithTools`, `streamText`, `analyzeImage`,
`canAnalyzeImage`, `getProviderStatus`, plus `generate` / `streamGenerate` from the interface.

### 2.2 Files

| File | Role |
|---|---|
| `backend/src/ai/modelGateway.ts` | Routing, fallback, quota cooldown, `AICallMeta`, one log line per call |
| `backend/src/ai/providerFactory.ts` | Builds the gateway from the environment (`createModelGateway`, `getModelGateway`); `UnavailableAIProvider`; `selectDefaultModel` |
| `backend/src/ai/geminiProvider.ts`, `geminiVision.ts`, `geminiErrors.ts` | The Gemini adapter, image analysis (moved out of the upload route), the shared failure classification and retry policy |
| `backend/src/ai/openRouterProvider.ts`, `openRouterErrors.ts` | The OpenRouter adapter and its failure classification (same retry policy) |
| `backend/src/ai/capabilities.ts`, `modelCatalog.ts` | The capability model and the declared, validated model catalog |
| `backend/src/config/aiConfig.ts`, `aiConfigError.ts` | Startup validation and resolution of every AI setting |
| `backend/src/ai/errorTaxonomy.ts`, `transportErrors.ts` | The structured error kinds; timeouts and network failures |
| `backend/src/ai/callTrace.ts`, `observability/requestContext.ts`, `security/redact.ts` | Per-call records, correlation ids, log redaction |
| `backend/src/ai/contentGenerator.ts` | Generation skills: provider failures become `SkillUserError`s the agent loop understands |

### 2.3 How a request is routed

1. **What does the request need?** `text` always; `tools` when tools are offered; `vision` for an
   image (and the image's MIME type); `structuredOutput` for a JSON response format; `streaming`
   for a stream; anything the caller passes in `requires` (repository changes require
   `coding`); and a context window that fits the prompt (see §2.7).
2. **Which providers are usable right now?** A provider is usable when its key is present
   (checked per request, never captured at startup). The preferred primary
   (`AI_PRIMARY_PROVIDER`, default Gemini) is used when it is usable; if it is not, the other
   provider answers and there is no fallback. With neither, see §2.9.
3. **Which model?** For each provider, the most preferred (`priority`) enabled catalog model that
   declares everything the request needs. A request is never made to "work" on a model by
   dropping tools or an image.
4. **Attempt the primary.** On success the answer is returned. On a *fallback-eligible* failure
   (§2.4) and when the fallback provider has a model that can serve the same request, the gateway
   makes **exactly one** more attempt there. Two providers are never called at once, and nothing
   returns to the first provider.
5. If no model can serve the request: AI_PROVIDER_CAPABILITY_UNSUPPORTED, with nothing sent.

### 2.4 When it falls back, and when it must not

| Failure of the primary | Fallback? | Why |
|---|---|---|
| 429 rate limit (per minute, after its bounded retry) | **yes** | temporary, provider side |
| 429 exhausted daily / project quota, 402 empty balance | **yes** (no retry first) | cannot recover inside a request |
| 5xx / 408 / network failure (after the bounded retries) | **yes** | temporary, provider side |
| Timeout | **yes** (never retried on the same provider) | the provider may still be working |
| 401 / 403 (the provider rejects the key) | **no** | an operator problem; answering elsewhere would hide it |
| 400 / 413 / 422 (the provider rejects the request or content) | **no** | the request is wrong; another provider would fail or accept what this one refused |
| 404 (the model does not exist for this account) | **no** | a configuration bug, exactly what broke production once (retired model name) |
| A capability the fallback model does not declare | **no** | the honest primary error is returned |
| An application bug (any non-provider exception) | **no** | rethrown untouched; never disguised as an outage |
| The client went away (abort) | **no** | nothing runs for nobody |
| Permission denied, confirmation declined, entitlement denied | not applicable | decided before any model call, in the ToolPipeline |

If the fallback itself fails, the user sees the **last provider's** error, unless that error is
about our own configuration (a rejected OpenRouter key, an unsupported request): then the
primary's real condition is reported instead (a spent Gemini quota is still "the AI is out of
quota", not "temporarily unavailable"). Both failures are in the log (`failedAttempts`).

### 2.5 Retries (one policy for both providers)

`ai/geminiErrors.ts` `retryDelayMs` is shared. Every number below is a cap, not a goal.

| Condition | Behaviour |
|---|---|
| Daily quota (Gemini `...PerDay...`, OpenRouter `free-models-per-day`), 402 | no retry |
| Per-minute 429 | one retry, only if the advised wait (`RetryInfo`, `Retry-After`, `X-RateLimit-Reset`) is at most 8 s |
| 408 / 5xx / network failure | at most two retries (about 1 s, 2 s, plus jitter). Gemini then tries its own fallback model (`gemini-3.8-flash`) with the same limits; OpenRouter has one model per call |
| Timeout | no retry. Gemini 90 s (120 s for a stream to its first byte), OpenRouter `OPENROUTER_TIMEOUT_MS` (60 s) |
| 400 / 401 / 403 / 404 / 413 / 422 | no retry |

Worst case for one logical call: 6 Gemini requests (two models, three attempts each) plus 3
OpenRouter requests, then an error (image analysis tries up to three Gemini models, so up to 9 plus
3, with a 60 s timeout per Gemini request). There is no loop anywhere. **Time** is bounded by the sum of
the timeouts above: the Vercel function's maximum duration must be longer (§5).

### 2.6 Quota cooldown

When a provider reports an exhausted quota, the gateway remembers it for `AI_QUOTA_COOLDOWN_MS`
(default 5 minutes). During that time a request goes **straight to a fallback that can serve it**
(`fallbackReason: GEMINI_QUOTA_COOLDOWN`) instead of spending a request on a provider known to
refuse it. After the cooldown the next request probes the provider again, and its success clears
the state. It never applies when no fallback can serve the request, so a Gemini-only deployment
behaves exactly as before. The state is per server instance (see §8).

### 2.7 Capabilities, declared and never assumed

Capabilities are *declared* in the model catalog (`ai/modelCatalog.ts`), not probed and not
guessed. The Gemini entry declares what this repository already relies on in production (tool
calling, image input, streaming) and what Google documents for the Gemini Flash family. An
OpenRouter model declares only text and streaming until the operator says more, because free
models differ widely and `openrouter/free` may serve a different model on each request.

| | text | streaming | tools | vision | structured output | long context (≥ 100k) | coding | reasoning | context | image types |
|---|---|---|---|---|---|---|---|---|---|---|
| Gemini (`GEMINI_MODEL`, default `gemini-3.6-flash`) | yes | yes | yes | yes | yes | yes | yes | yes | 1,000,000 | png jpeg webp heic heif |
| OpenRouter (`OPENROUTER_MODEL`, default `openrouter/free`) | yes | yes | **no** | **no** | **no** | no (32,768) | **no** | **no** | 32,768 | none |

`OPENROUTER_MODEL_CAPABILITIES=tools,vision,...` (or `AI_MODEL_CATALOG_JSON`) changes the OpenRouter
row. Declare a capability only after checking that the chosen model really has it. `longContext` is
derived from the context size, never set separately.

What each kind of request needs, and where it can go:

| Request | Needs | Gemini | OpenRouter, defaults | OpenRouter, capability declared |
|---|---|---|---|---|
| Planner step (tools offered) | text, tools | yes | **not used** (no tool support declared) | with `tools` |
| Content skill (poem, summary, report, ...) | text | yes | yes | yes |
| Repository change (`developer.implement`) | text, coding | yes | no | with `coding` |
| Image analysis, png / jpeg / webp | vision | yes | no | with `vision` |
| Image analysis, heic / heif | vision + MIME type | yes | no | **never** (not accepted by OpenRouter vision models) |
| Streamed text | streaming | yes | yes | yes |
| A prompt larger than the model's context | context fits | yes (1M) | no, unless a larger `OPENROUTER_MODEL_CONTEXT_TOKENS` is declared | same |
| Web search | Google Search grounding | yes, **outside the gateway** | never | never |
| Text to speech | Edge's neural voices (§2.14) | **outside the gateway**: no AI provider speaks | never | never |
| Greeting, creator-identity answer | nothing | no model call at all | | |

The token estimate is deliberately pessimistic (3 characters per token, Hindi needs more than
English), so it can only withhold a fallback, never send a prompt that will not fit.

### 2.8 Errors a client can see

Internally every failure has one of eight kinds (`ai/errorTaxonomy.ts`). A client sees only the
three codes it has always understood, plus a fixed, safe message. It never sees the kind, the
provider, a model, a key, a provider body or a stack trace.

| Internal kind | Wire code | Status | Retryable | Example cause |
|---|---|---|---|---|
| `AI_PROVIDER_QUOTA_EXCEEDED` | `AI_QUOTA_EXCEEDED` | 429 | no | daily quota, 402 |
| `AI_PROVIDER_RATE_LIMIT` | `AI_RATE_LIMITED` | 429 | yes | per-minute limit |
| `AI_PROVIDER_UNAVAILABLE` | `AI_UNAVAILABLE` | 503 | yes | 5xx, network failure |
| `AI_PROVIDER_TIMEOUT` | `AI_UNAVAILABLE` | 503 | yes | request outlived its budget |
| `AI_PROVIDER_AUTH_ERROR` | `AI_UNAVAILABLE` | 503 | no | the provider rejects our key |
| `AI_PROVIDER_INVALID_REQUEST` | `AI_UNAVAILABLE` | 503 (image route: 422) | no | the provider refuses the request or the image |
| `AI_PROVIDER_CAPABILITY_UNSUPPORTED` | `AI_UNAVAILABLE` | 503 | no | no configured model can serve it; a model that does not exist |
| `AI_INTERNAL_ERROR` | `AI_UNAVAILABLE` | 503 | no | an application bug that the AI layer detected |

The SSE `error` event and the JSON body keep their existing shape (`type`, `code`, `error`,
`retryable`, `retryAfterMs`, `quotaType`). Messages: "The AI service is temporarily unavailable,
so this request was not completed. Nothing was charged. Please try again." (outages); "ZARVIS has
reached its AI usage limit for today ..." (a daily quota) or "... the current AI usage limit ..."
(a spent credit balance); "This request needs an AI capability that is not available right now
..." (capability). Each says nothing was charged, and it is true.

### 2.9 No provider configured

- OpenRouter not configured: ZARVIS runs on Gemini exactly as before.
- Gemini not configured: OpenRouter answers, but only for requests its model declares it can serve
  (so, with no declared `tools`, a tool-using chat turn fails with a capability error and nothing is
  sent; plain generation works). Web search and voice are unavailable (Gemini only).
- Neither configured: in production every model call fails honestly with `AI_UNAVAILABLE` (503) and
  `/health` says `provider: none`. The labelled deterministic mock exists only outside production and
  only when nothing real is configured. It is never a fallback and never used when a real provider
  is configured but cannot serve a request.

### 2.10 Observability

One request can be followed by id. `X-Request-Id` is returned on every response; the same
`requestId`, plus `turnId`, `clientTurnId` and (when present) Vercel's own `vercelId`, are on every
gateway log line.

| Log message | Level | Fields |
|---|---|---|
| `AI gateway ready` | info, once per cold start | mode, effective primary/fallback, preferred, each provider's models and declared capabilities, notes (for example "the fallback model does not declare tool support") |
| `AI call` | info, per logical call | `requestId, turnId, clientTurnId, modelCallId, purpose, finalStatus, provider, model, fallback, fallbackReason, latencyMs, providerHttpRequests, retryCount, attempts[]` (each: provider, model, outcome, status, httpRequests, latencyMs, fallback) |
| `AI provider fallback` | warn, at the moment of the switch | `fallbackReason`, `from {provider, model, kind, status}`, `to {provider, model}` |
| `AI call failed` | warn | the same, plus `errorKind`, `errorStatus`, `quotaType`, `failedAttempts[]` |
| `AI call failed with an internal error` | error | an application bug inside an AI call (never turned into a fallback) |
| `Turn finished` | info, per request | existing fields, plus `aiLogicalCalls`, `aiProviders`, `aiFallbackCalls`, `chargedCredits`; `aiCallLog` records now carry `provider`, `fallback`, `fallbackReason`, `latencyMs` |

Example: `modelCallId=… purpose=generation provider=openrouter model=vendor/model:free
fallback=true fallbackReason=GEMINI_QUOTA_EXCEEDED retryCount=0 finalStatus=success`.

| Question | Where the answer is |
|---|---|
| Which turn / request? | `turnId`, `clientTurnId`, `requestId` on every line; `X-Request-Id` header |
| Which provider and model? | `AI call` `provider`, `model` (the model the provider says served it) |
| How many provider requests? | `Turn finished` `aiHttpRequests`; per call `providerHttpRequests`, `retryCount` |
| Fallback, and why? | `fallback`, `fallbackReason` (`GEMINI_QUOTA_EXCEEDED`, `_RATE_LIMITED`, `_UNAVAILABLE`, `_TIMEOUT`, `_QUOTA_COOLDOWN`, `_CAPABILITY_UNSUPPORTED`) |
| How long? | `latencyMs` per call and per attempt |
| Did generation succeed? | `finalStatus`, `Turn finished` `outcome` |
| Was a tool executed? | `Turn finished` `toolCalls` |
| Was usage charged? | `Turn finished` `chargedCredits` and per tool call |

**No secret reaches a log.** `security/redact.ts` redacts by key name (`apiKey`, `x-goog-api-key`,
`authorization`, `token`, ...) and by value: key-shaped strings (OpenRouter, Google, OpenAI-style,
GitHub, `Bearer ...`, JWTs) and the exact keys this process was configured with are replaced even
inside an upstream error message. Provider error bodies are not copied into messages (OpenRouter's
`metadata.raw`, a moderation `flagged_input`); only a bounded, scrubbed detail is.

### 2.11 One user turn, one generation (duplicate protection)

| Layer | Guarantee | Proven by |
|---|---|---|
| Web | one request per submission; a new turn aborts the old one; Retry re-sends the same `clientTurnId`; no automatic reconnect or replay | `web/e2e/quality.e2e.cjs`, `logic.test.js` |
| Android | `turnJob` cancelled by a new turn, start request handled once per entry (`SavedStateHandle`), no silent POST retry | existing Android tests (CI) |
| Server, same `clientTurnId` | a finished turn is replayed (no model call, tool or charge); a running one gets `turn_in_progress`; a failed one runs again and reuses tool results that already succeeded | `turnIdempotency.test.ts`, `gatewayTurns.test.ts` (in-memory and real Postgres) |
| Orchestrator | 5 steps at most; the same skill with the same input does not run twice; a failed skill is not re-run; a spent quota ends the turn | `turnExecution.test.ts` |
| Gateway | no hedging (the fallback starts only after the primary failed), one fallback hop, no return, bounded retries, quota cooldown | `modelGateway.test.ts` ("request economy") |
| Client disconnect | the turn aborts: no fallback request, no further model call, no tool | `gatewayTurns.test.ts`, `gatewayApi.test.ts` (a real HTTP disconnect) |

A fallback adds a provider request, never a second generation: the failed attempt produced no
answer. Note the honest limit: a client that sends no `clientTurnId` (Android, curl) has no
server-side replay protection; that is the existing contract and is unchanged.

### 2.12 Usage and charging

Credits are charged by the ToolPipeline, once, after a *verified* skill success. A fallback happens
inside one skill execution, so it is one charge. A failed generation (every provider failed) throws
before the charge, so it is never charged. Planner calls, image analysis and TTS are not
credit-charged (unchanged; rate limits bound their cost). A Retry reuses the tool results that
already succeeded. Provider and model are tracked internally in the logs (`chargedCredits` next to
`aiProviders`); they are not added to the usage ledger, which would need a database migration, and
they are never copied into a skill output (skill outputs are sent to clients).

### 2.13 Streaming, images, search, voice

- **Streaming.** The orchestrator streams real progress events and one reply, as before. The
  gateway's `streamText` fails over only **before the first chunk**: once text has been delivered
  the answer is never restarted or mixed with another model. Stopping early cancels the upstream
  response (Gemini and OpenRouter). A stream with tools is refused (the calls would be lost).
- **Images.** `canAnalyzeImage(mime)` and `analyzeImage` route to a vision model that accepts the
  type. The route's MIME validation, 4 MB limit and error mapping are unchanged. An image is never
  sent to a text-only model; if nothing can read it the route says so (503
  `image_analysis_unavailable`) or returns the real provider error.
- **Web search** stays Gemini with Google Search grounding, because only that returns real sources.
  It is never answered by a model that did not search, and never claimed if it did not run.
- **Text to speech** is not an AI provider call at all any more: it is Edge's neural voices on its own
  routes, behind its own boundary (§2.14). Neither Gemini nor OpenRouter is involved.

### 2.14 Spoken replies (text to speech)

Voice is separate from the AI gateway. A reply is already on screen when its client asks for the
voice: `POST /api/v1/tts/synthesize` returns a WAV file (Android, the web Listen button) and
`POST /api/v1/tts/synthesize-stream` returns 24 kHz 16-bit mono PCM as it is produced (the web
client's spoken replies). Both take `{ text, voice? }`, need a Bearer token, are limited to 40
requests a minute per account, and cut the text to 2,000 and 1,200 characters. No AI provider is
involved, so a spent Gemini or OpenRouter quota never silences the voice and a failing voice never
touches a reply. Each answer names its engine in `X-Zarvis-TTS` (`edge`, `edge-stream`) and the voice
that spoke in `X-Zarvis-TTS-Voice` (for example `hi-IN-SwaraNeural`: a voice name, nothing of the
text), so a deployment can be checked, from outside, for the voice it really used.

**The voice** is Microsoft Edge's neural voices (the service behind Edge's Read Aloud), reached by
`tts/edgeTtsProvider.ts` behind the `TtsProvider` interface (`tts/provider.ts`): the routes ask for
audio and know nothing about the engine, so it can change, or its transport can move to a separate
service, without touching a route, the web client or Android. It needs **no API key, no account and
no billing**, so there is no secret to configure.

| File | Does |
|---|---|
| `tts/voices.ts` | every voice name; local language detection; which voice speaks a text |
| `tts/ssml.ts` | makes a reply speakable (Markdown, code blocks, URLs, emoji), escapes it, splits it, builds the SSML |
| `tts/edgeTransport.ts` | the WebSocket conversation with the service: the only file that knows the wire (`ws`) |
| `tts/mp3Decoder.ts` | MP3 to 24 kHz 16-bit mono PCM (mpg123 compiled to WebAssembly: no native module, no system binary) |
| `tts/guard.ts` | a cap on syntheses in flight and a circuit breaker |
| `tts/edgeTtsProvider.ts` | puts those together behind `TtsProvider` |
| `config/ttsConfig.ts` | reads `TTS_PROVIDER` and the voice settings |

**Which voice.** Chosen from the text, locally, with no API call. Devanagari anywhere: the Hindi voice
(`hi-IN-SwaraNeural`). Latin letters only, with enough common Hindi words (`aaj kya karna hai`): the
Hinglish voice (`TTS_HINGLISH_VOICE`, by default the Hindi voice). Anything else: the English voice
(`en-US-JennyNeural`). Every neural voice reads Latin letters with English letter-to-sound rules, so
Hinglish has no perfect answer; if it sounds wrong, try an Indian-English voice
(`TTS_HINGLISH_VOICE=en-IN-NeerjaNeural`). A request's `voice` is honoured when it is on the
allow-list (the configured voices and a short built-in list such as `hi-IN-MadhurNeural` and
`en-US-GuyNeural`), because the name goes into the SSML. The five old Gemini voice names that the web
picker and Android still send keep working as a choice of style: `Kore` and `Aoede` mean the usual
voice, `Puck`, `Charon` and `Fenrir` a male voice, in the language of the text. Anything else is
ignored and the voice is chosen from the text, as an unknown voice always was.

**Audio.** The service answers only in MP3 (24 kHz, 48 kbit/s, mono); it has no PCM output. The server
decodes it as it arrives into the format the web player already schedules, and the unary endpoint
wraps the same PCM in a WAV header, so the two endpoints cannot disagree about how a text sounds. Audio
at another sample rate, or that does not decode, is refused (`BAD_AUDIO`) and never played at the wrong
speed. The MP3 has no gapless header, so each part starts with about 46 ms of encoder silence.

**One request.** Text, made speakable, is split into parts of at most 3,000 escaped bytes (the service
refuses about 4 KB; Hindi is three bytes a letter) at sentence ends; a spoken sentence from the web
client is one part. Parts are spoken one after the other and their audio is delivered in order, as it
is produced. The route reads the first chunk before it commits the response, so a failure before any
sound is a real HTTP error, not a broken stream. Everything about playback (the ordered segments, two
at once, the 2.3 s start timer, 1.2 s of preroll, Stop and a new turn aborting every request) is in
the web client and is unchanged, apart from two fixes to how a spoken turn ends (§8).

**Failure and cancelling.** A part is tried at most twice (one short pause), only after a failure that
can be temporary, and only if it has produced no sound yet: audio is never repeated, and a failure
after sound began ends the stream there. There is no other voice to fall back to and none is
invented. A closed connection or a client's `Stop` aborts the request, which closes the upstream
WebSocket and frees the decoder; that is never logged as a failure. A 403 on connect is read as a
disagreement about the clock: the service's `Date` header is used to correct it and the connection
is tried once more. Timeouts: 10 s to connect, 15 s of silence, 60 s for one synthesis.

| What happened | Status and code | `retryable` |
|---|---|---|
| nothing speakable in the text (empty, only punctuation, emoji, a code block) | 400 `tts_invalid_request` | no |
| the service is unreachable, closed early, rate limited, or this server is protecting it | 503 `tts_unavailable` (and `Retry-After` when known) | yes |
| no answer in time | 504 `tts_timeout` | yes |
| the service refused the connection, sent no audio, or sent audio that cannot be played | 502 `tts_failed` | no |
| spoken replies switched off (`TTS_PROVIDER=none`) | 503 `tts_disabled` | no |
| this account asked for more than 40 in a minute | 429 `rate_limited` | after the wait |

The messages say that the reply is still shown as text and carry nothing the service said. The web
client logs a failed sentence and goes on to the next one; only a `rate_limited` answer stops the
speech for the rest of that turn, and Listen shows its "Spoken reply isn't available" toast.

**Protecting the service.** It is not ours and promises nothing. At most 8 syntheses run in this
process and 16 wait; beyond that the answer is `503` at once. After 3 failed requests in a row (not
cancellations, not unspeakable text) further requests fail at once for 30 seconds, then one is let
through to see whether the service is back; without this, a service that is down would cost every
sentence of every reply a full timeout, because the client keeps asking for the next one. Both are
per process, like the rate limiter.

**Privacy.** The text a person asks to hear is sent to Microsoft's speech service: not to Gemini,
not to OpenRouter. Nothing else goes with it (no account, no key); Microsoft sees the server's
address. The logs record the engine, the voice, the language, sizes and timings, never the text or the
audio. Caching is deliberately not done: replies are private and rarely repeat, and a shared cache of
them would be a leak.

---

## 3. Configuration reference

Everything is read on the server. Nothing here is exposed to the browser (the web client is static
files with no build step and no `process.env`), to the Android app, or to a log. The page's
Content-Security-Policy keeps `connect-src 'self'`: the browser never talks to an AI provider.

| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | none | Gemini key (chat, search grounding, images). Secret |
| `GEMINI_MODEL` | `gemini-3.6-flash` | the Gemini chat model |
| `OPENROUTER_API_KEY` | none | OpenRouter key. Secret. Absent = no OpenRouter |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | must be https (http only for localhost); no credentials or query string |
| `OPENROUTER_MODEL` | `openrouter/free` | the model sent to OpenRouter |
| `OPENROUTER_MODEL_CAPABILITIES` | none | extra capabilities the model declares: `tools`, `vision`, `structuredOutput`, `coding`, `reasoning` |
| `OPENROUTER_MODEL_CONTEXT_TOKENS` | `32768` | declared context window (1,000 to 10,000,000) |
| `OPENROUTER_TIMEOUT_MS` | `60000` | time to response headers (1,000 to 300,000) |
| `AI_PRIMARY_PROVIDER` | `gemini` | `gemini` (alias `google`) or `openrouter` |
| `AI_FALLBACK_PROVIDER` | the other provider | `openrouter`, `gemini` or `none`; must differ from the primary |
| `AI_QUOTA_COOLDOWN_MS` | `300000` | how long an exhausted provider is skipped; `0` = never |
| `AI_MODEL_CATALOG_JSON` | none | describes several models (below) |
| `TTS_PROVIDER` | `edge` | spoken replies: `edge` or `none` (no spoken replies from this server). Not a secret; Edge needs no key |
| `TTS_HI_VOICE` | `hi-IN-SwaraNeural` | the voice for Hindi (Devanagari) text |
| `TTS_EN_VOICE` | `en-US-JennyNeural` | the voice for English text |
| `TTS_HINGLISH_VOICE` | the Hindi voice | the voice for Hindi written in Latin letters |

**Validation at startup.** A value that is present and wrong stops the server with a message that
names the variable and never its value; on Vercel `/health` then answers 500
`reason: ai_provider_config_invalid` and the function log has the message. A **missing** key is not
an error. Warnings (logged once): a base URL that is not `openrouter.ai` (the key is sent there);
`OPENROUTER_MODEL` ignored because the catalog JSON lists OpenRouter models.

`AI_MODEL_CATALOG_JSON` is a one-line JSON array. Keys: `provider` (`gemini` or `openrouter`),
`model`, `enabled`, `free`, `priority` (lower is preferred), `streaming`, `tools`, `vision`,
`structuredOutput`, `coding`, `reasoning`, `contextTokens`, `imageMimeTypes`. Anything not stated is
the conservative value. Unknown keys are rejected (a typo such as `tool` would otherwise silently
leave a capability off). A provider listed in the JSON is described entirely by it.

```json
[
  {"provider": "openrouter", "model": "openrouter/free", "enabled": true, "free": true,
   "streaming": true, "tools": false, "vision": false, "priority": 2},
  {"provider": "openrouter", "model": "vendor/tool-capable-model", "enabled": true,
   "streaming": true, "tools": true, "contextTokens": 65536, "priority": 3}
]
```

`/health` reports `provider` (the one answering by default: `google`, `openrouter`, `mock` or `none`)
and, only while a fallback is active, `aiFallback: true` and `aiFallbackTools`. `aiFallbackTools: false`
means the fallback model declares no tool support, so **chat turns will not fall back** (every chat
turn starts with a tool-using planner step); only text-only skills can. It is the one-tap way to see,
from a phone, whether `OPENROUTER_MODEL_CAPABILITIES=tools` took effect. It names no model, address
or key.

---

## 4. Local development

```
cd backend
cp .env.example .env        # .env is git-ignored, as is any .env.* at the repo root
# set GEMINI_API_KEY and/or OPENROUTER_API_KEY in .env
npm ci && npm run dev
curl localhost:3000/health   # {"status":"ok","provider":"google","aiFallback":true,"aiFallbackTools":false,...}
```

With no key at all the server runs on the labelled development mock (`provider: mock`). Tests never
use a real key or the network: `fetch` is stubbed and every provider request is recorded (see
`backend/test/ai/gatewayHarness.ts`).

---

## 5. Vercel

Vercel scopes environment variables per environment (Production, Preview, Development). A Preview
deployment does not see a variable set only for Production, so set each one for every environment
that must work, and **redeploy**: a changed variable applies to new deployments only.

| Variable | Production | Preview | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | required for Gemini, search, images | same | mark as Sensitive |
| `OPENROUTER_API_KEY` | to enable the fallback | to test it on a PR | mark as Sensitive. Absent = Gemini only |
| `OPENROUTER_MODEL` | optional (default `openrouter/free`) | optional | |
| `OPENROUTER_MODEL_CAPABILITIES` | set `tools` once the model is verified to call tools; otherwise tool-using chat turns will not fall back | same | |
| `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL_CONTEXT_TOKENS`, `OPENROUTER_TIMEOUT_MS` | optional | optional | |
| `AI_PRIMARY_PROVIDER`, `AI_FALLBACK_PROVIDER`, `AI_QUOTA_COOLDOWN_MS`, `AI_MODEL_CATALOG_JSON` | optional | optional | |
| `TTS_PROVIDER`, `TTS_HI_VOICE`, `TTS_EN_VOICE`, `TTS_HINGLISH_VOICE` | optional (the defaults speak) | optional | none is a secret; Edge's voices need no key. `TTS_PROVIDER=none` switches spoken replies off |

Runtime facts, from the code and `vercel.json` (a real Vercel build was not run from this
environment): `vercel.json` is unchanged and needs no change. The new files are imported, directly
or transitively, by the same entry modules as the existing AI files, so they are bundled the same
way; SSE streaming is untouched; the CSP is unchanged. The code uses `fetch` and `AbortSignal.any`
(Node 20.3 or later; the backend requires Node 22), which the existing Gemini adapter already used.
The real `api/index.ts` handler was run locally under seven configurations (invalid AI setting, both
providers, Gemini only, OpenRouter only, none in production, fallback off) and `/health` answered as
documented in each.

**Timeouts.** The function's maximum duration (Project Settings, Functions) must be longer than the
worst chain in §2.5 for the requests you accept: with the defaults a single call can wait 90 s for
Gemini and then 60 s for OpenRouter. If your plan's limit is lower, lower `OPENROUTER_TIMEOUT_MS`
(Gemini's 90 s is in code). Per-instance memory (rate limits, the quota cooldown) is not shared
between serverless instances.

**Check a deployment.**

1. `GET /health` returns `provider` and, with a fallback, `"aiFallback": true` and `"aiFallbackTools"`
   (`false`: chat turns will not fall back). Compare Production and Preview: they must agree. Code
   that is not merged is not on Production: it has no `aiFallback` at all.
2. The function log's `AI gateway ready` line lists the models and declared capabilities and any
   `notes` (for example that tool-using turns will not fall back).
3. Run the **Live preview API smoke test** workflow (`workflow_dispatch` with the URL); it reports the
   default provider and whether a fallback is configured, warns when the fallback cannot serve chat
   turns, and says web search was not exercised on a deployment without Gemini. It cannot say which
   provider answered a given turn (the response deliberately carries no provider); the function log's
   `AI call` line (`provider`, `fallback`, `attempts`) does.
4. A rejected setting shows as `/health` 500 `ai_provider_config_invalid` with the variable named in
   the function log.

**Prove OpenRouter works (live probe).** OpenRouter is the *backup*: while Gemini is healthy it is
never asked, so a working deployment shows nothing of it, and `aiFallback: true` only proves a key is
present, not that it is valid or that a model can serve chat. The manual **OpenRouter live probe**
workflow calls the live API through this repository's own adapter, from GitHub Actions (which can
reach openrouter.ai):

1. Add the repository secret `OPENROUTER_API_KEY` (Settings, Secrets and variables, Actions).
2. Start it. From a pull request branch, add the label `openrouter-probe` to the pull request
   (remove and add it again to re-run; same-repository pull requests only, because GitHub passes no
   secrets to a fork). Once the workflow file is on the default branch: Actions, **OpenRouter live
   probe**, Run workflow, with an optional `model` to test first and a count of other free models
   with tool support to try.
3. Read the job log or its summary. The probe tests the configured model (default `openrouter/free`),
   then the models that router actually served (they are known to be reachable with this key and
   this account's settings), then down the public list of free models with tool support, until a few
   of them answered. A model can be listed as free and tool-capable and still be refused (the 403 and
   404 rows in §6), so a refusal does not end the probe. Per model: a plain request and a tool call
   (`PASS`, `WARN`, `FAIL`, with the structured kind, the HTTP status and OpenRouter's whole
   explanation of a failure: a rejected key, an empty balance, a data-policy refusal, a model without
   tool support). Every line names the model that actually answered, which matters because
   `openrouter/free` is a router that can serve each request with a different free model. A model that
   called the tool then gets one real ZARVIS turn (the planner prompt with the real skill registry)
   through an OpenRouter-only gateway, up to three models in turn (a pinned model before a router,
   unless you named a model: a router can serve each request with a different model, and the
   account's data policy can leave its pool empty for one request and not for the next). That turn is
   the verdict: the exact `OPENROUTER_MODEL` and `OPENROUTER_MODEL_CAPABILITIES=tools` to copy into
   Vercel are printed only for a model that answered it correctly. The key is never printed. A run sends up to about 20
   requests, which count against the free-model limits (the 429 row in §6).

Without the workflow, the same proof is to set `AI_PRIMARY_PROVIDER=openrouter` and
`AI_FALLBACK_PROVIDER=none` on a Preview deployment (with `OPENROUTER_MODEL_CAPABILITIES=tools`),
send a message, and remove both again.

**The voice on Vercel (§2.14).** What it asks of the deployment, from the code and `vercel.json` (a real
Vercel build was not run from this environment):

- *Dependencies.* `ws` and `mpg123-decoder` (and `@types/ws`) are in **both** `backend/package.json` and the
  root `package.json`: Vercel installs the root one, and CI typechecks the entrypoint against it.
  Both are loaded on first use, so requests that never speak do not pay for them at start-up. Measured
  on Node 22: about 50 ms to load `ws`, 10 ms the decoder and 12 ms its first start, once per instance.
- *Node version.* Measured, not assumed: from a root-only install (which is what Vercel builds, with no
  `backend/node_modules`), `ws` loads and `mpg123-decoder` decodes a real MP3 to the right number of
  samples on Node 18.20.8, 20.18.3, 20.19.0, 22.22.0 and 24.21.0. Select the version the rest of the
  backend needs (`engines`: 22 or later). If the decoder or `ws` ever cannot load, the first spoken reply
  fails (`BAD_AUDIO`, "The audio decoder could not start", or `UNAVAILABLE`) and the function log's
  `TTS failed before audio` line carries the system error as `cause`; start-up and every other route
  are unaffected, and the reply is still shown as text.
- *What goes into the function.* The same tracer Vercel uses (`@vercel/nft`), run on a fresh root-only
  install, includes the eight `backend/src/tts` files, `ws`, `mpg123-decoder` and the three packages it
  needs. Nothing is left out and no separate `.wasm` file is needed.
- *Network.* The function makes one outbound WebSocket (TLS, port 443) to `speech.platform.bing.com`
  per spoken part. Vercel functions may open outbound connections; they cannot accept WebSockets,
  and none is needed. No key, no account and no extra service.
- *Duration and size.* A spoken sentence from the web client is a request of about one to three
  seconds. `vercel.json` sets no function duration, so the platform's default for the plan applies, and the
  measurements below were made under it. The WAV endpoint takes up to 2,000 characters, about two minutes
  of speech, and 24 kHz 16-bit mono is 48 KB a second, so its largest answer is 5 to 6 MB. Vercel
  documents about 4.5 MB as the most a function answers in one piece, and an earlier version of this note
  predicted that a long Listen would therefore fail. **It does not, here (measured, 2026-10-04, on the
  Preview deployment of commit `487dc10`):** a 1,950-character text came back as a 108.6 s, 5.1 MB WAV in
  one response, in about 4.3 s, and a 1,150-character stream of 62 s of speech began after 0.56 s and was
  complete after 2.0 s, so the stream arrives progressively and the service synthesizes about thirty times
  faster than it is spoken. The live smoke test keeps asking for the longest text on purpose and reports
  `WARN` if the platform ever refuses it.
- *Runtime state.* The decoder is WebAssembly with its code inside the JavaScript, so there is no
  `.wasm` file to include. The circuit breaker and the cap on syntheses live in each instance.
  Memory: eight maximum-length WAV requests at once (the cap on syntheses) took a local server from
  117 MB to a peak of 284 MB, well inside a function's usual 1 GB.
- *Cancelling.* A client that goes away aborts the request in the function, which closes the connection
  to the service and frees the decoder (tested locally down to the socket). Whether the platform delivers
  a client's disconnect to a running function is the platform's behaviour and cannot be seen from outside,
  so the live smoke test shows only that the service stays able to serve after six abandoned streams.
- *Whether the service accepts Vercel's addresses: measured, it did (2026-10-04).* The live smoke test
  against the Preview deployment of commit `487dc10` got real audio from Microsoft's service through that
  deployment, in the right voice, for English, Hindi and Hinglish, on both endpoints (the VOICE SUMMARY
  below was all PASS; §8 has the numbers). It is an **unofficial service**, so that is a fact about that
  day and that deployment and the check runs again after every deployment: the community client's issue
  tracker shows 403 and 503 refusals from time to time, and a secondary source says Microsoft has tightened
  filtering of cloud address ranges. If a later run prints FAIL for *voice service reached*, the log line
  says by how much the clocks differed after the correction (see Troubleshooting).

**Prove the voice works on the deployment (live audit).** Two checks run against the real deployment, after
each Preview deployment is Ready, and both write their results to the run's summary page:

- `scripts/live-smoke.mjs` (workflow *Live preview API smoke test*): English, Hindi and Hinglish on
  **both** endpoints, each asserted for the format the clients play (a 24 kHz mono 16-bit WAV; headerless
  24 kHz PCM), for audio whose length fits the text, for `X-Zarvis-TTS` and for the **voice that spoke**
  (`X-Zarvis-TTS-Voice` must be `hi-IN-SwaraNeural` for Hindi and `en-US-JennyNeural` for English, or the
  voices set in `TTS_HI_VOICE`, `TTS_EN_VOICE` and `TTS_HINGLISH_VOICE`: set the same names as the
  repository variables `EXPECT_HI_VOICE`, `EXPECT_EN_VOICE`, `EXPECT_HINGLISH_VOICE`, which both
  workflows read); a long reply (does the stream arrive
  progressively, or only at the end?); the longest text the WAV endpoint accepts (see Duration and size
  above); six streams abandoned after their first bytes and two WAV requests dropped, after which the
  next request must still be served; and the plain answers to bad requests. It ends with a
  **VOICE SUMMARY**: *voice service reached*, *English*, *Hindi*, *Hinglish*, *Streaming*, *Unary*,
  *Cancellation*, each PASS, WARN, FAIL or NOT RUN. A check that did not run because English had
  already failed on both endpoints is reported FAIL, never skipped silently. `ONLY=tts BASE_URL=https://…
  node scripts/live-smoke.mjs` runs just this, against any deployment, without spending AI quota.
- `web/e2e/tts-audit.cjs` (workflow *Edge TTS live audit (browser)*, Previews and by hand): the real web
  client in a real Chromium against the deployment, with only the AI's answer fixed. English, Hindi and
  Hinglish replies are spoken in the right voice and played in order; a long reply streams two requests at
  a time with no overlap, and the orb says "speaking" until the speech has ended; Stop silences the reply and asks for nothing more, and the next reply plays;
  a new message, typed or spoken, cancels the reply being spoken and nothing of the old reply is asked for
  again; the Listen button plays a WAV in English and in Hindi; and when the voice answers 503 or cannot be
  reached at all, the AI's reply is on screen, the orb is idle and the next message is answered. One extra
  scenario uses a real AI answer and warns if the AI has no quota. `AUDIT_FAILURES=natural` instead
  audits a server whose own voice is failing, and `AUDIT_SLOW_STARTUP_MS=2000` delays the page's start-up
  requests the way a cold serverless function would. A failed check prints the voice requests (when each
  started and ended, with its status) and the orb's timeline.

Neither can make Microsoft fail on a deployment: a deployed voice failure is only seen when it happens.
The same scenarios were run for real, locally, against a service that is genuinely broken in each way
(nothing listening, HTTP 403, silence, a drop mid-stream, `TTS_PROVIDER=none`, a missing decoder package),
and against the real Microsoft address from an environment whose network policy blocks it (§8).

**Prove the voice works (live probe).** Nothing in the build environment can reach Microsoft, so nothing
here has ever called the real service except through this probe. The manual **Edge TTS live probe**
workflow (`.github/workflows/edge-tts-probe.yml`) runs the opt-in live test
(`backend/test/live/edgeTts.live.test.ts`) through this repository's own voice code, from GitHub
Actions: do the configured voices exist on the service, does the handshake work, do English, Hindi and
Hinglish come back as real 24 kHz audio of a plausible length, does the stream deliver its first sound
before the end, and does a long reply (several requests) work. There is no secret to add. Start it from
a pull request by adding the label `edge-tts-probe` (remove and add it again to re-run), or, once the
file is on the default branch, Actions, **Edge TTS live probe**, Run workflow. It proves the service
accepts a GitHub runner's network; the smoke test above proves it for Vercel's. Locally:
`ZARVIS_LIVE_TESTS=1 npx vitest run test/live/edgeTts.live.test.ts`.

---

## 6. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| "OpenRouter does not work", but Gemini does | OpenRouter is the backup: with Gemini healthy it is never asked, and on Production it does not exist until this code is merged | Nothing is wrong. To see it answer, prove it with the live probe (§5), or make it primary on a Preview deployment for a moment |
| `/health` has no `aiFallback` after setting the `OPENROUTER_*` variables and redeploying | the deployment that was redeployed was built from `main`, which does not contain the gateway (the `...-git-main-...` alias, and any Production build made from `main`, have none until this change is merged), so the variables cannot show there. Variables are also per environment: a Preview value does not apply to a build made for Production, and a build promoted to Production keeps the values it was built with | redeploy the deployment whose source is the pull request's branch (or push a commit to it) and read `/health` on that branch's alias (`...-git-<branch>-...vercel.app`). The Actions run "Live preview API smoke test" names the branch it tested and prints the same `/health` |
| Gemini hits its quota and users still see the quota error | the fallback is off, not configured, or cannot serve the request | `/health`: `aiFallback` present? `aiFallbackTools` true? (false = the OpenRouter model declares no `tools`, which every chat turn needs). In the `AI call failed` log line, `attempts` listing only `google` means the fallback was never tried |
| No fallback for chat turns only; content skills do fall back | the OpenRouter model does not declare `tools` (the safe default) | verify the model supports function calling, then `OPENROUTER_MODEL_CAPABILITIES=tools` |
| Nothing falls back, and logs show `AI_PROVIDER_AUTH_ERROR` | a provider rejects its key (never a fallback reason) | fix the key; `AI call failed` names which provider |
| `/health` 500 `ai_provider_config_invalid` | a present-but-wrong AI variable | read the function log's "Invalid AI configuration: ..." (it names the variable) |
| Only `OPENROUTER_API_KEY` is set and chat fails | tool support not declared | declare `tools`; web search and voice need Gemini |
| `AI_PROVIDER_CAPABILITY_UNSUPPORTED` | the request needs something no configured model declares (tools, vision, coding, a larger context, a HEIC image) | declare the capability, change the model, or configure Gemini |
| OpenRouter 402 | the OpenRouter balance is empty (it blocks free models too) | add credits; it is reported as a spent quota, never retried |
| OpenRouter 429 | free-model caps (OpenRouter documents per-minute and per-day limits that depend on the account's credit history: https://openrouter.ai/docs) | retried once if the wait is short; a daily cap is not retried |
| `AI_PROVIDER_AUTH_ERROR`, HTTP 403, "... is only available on agentic harnesses" | that model is restricted to approved coding-agent apps; the key is fine. The live probe met it for two models that the public list showed as free with tool support | choose another model. A 403 is never a fallback reason; the probe walks past such models |
| `AI_PROVIDER_CAPABILITY_UNSUPPORTED`, HTTP 404, "0 endpoints out of N requested are available matching your guardrail restrictions and data policy ..." | the OpenRouter account's own data-policy or guardrail settings (the message names the reason, for example ZDR, zero data retention) removed every endpoint that could serve this request. The probe met it for the real ZARVIS turn through `openrouter/free` while smaller requests were served | the setting is in OpenRouter (Settings, Privacy; Guardrails), not in this repository: allow the endpoints you need, or pin a model whose endpoints pass your policy (the probe tries the models its router served and prints the whole reason list) |
| The probe shows `WARN ... plain request ... empty message` | a reasoning model spent its output budget thinking and wrote no text (the line gives the model and the tokens used); `openrouter/free` is a router, so which model answers varies per request | the real ZARVIS turn decides. For predictable behaviour pin a model id that passed (`OPENROUTER_MODEL`) |
| A tool call runs with "missing details" | the model returned tool arguments that are not valid JSON, so the input is empty (never invented) | use a model with reliable function calling |
| Answers differ in quality or language after a fallback | a different, possibly free, model answered | check `model` and `fallbackReason` in `AI call` |
| Turns time out on Vercel | the function's maximum duration is shorter than Gemini plus OpenRouter | raise it, or lower `OPENROUTER_TIMEOUT_MS` |
| Preview works, Production does not (or the reverse) | the variable exists in only one environment | set it for both, redeploy, compare `/health` |
| An image is not read on fallback | the OpenRouter model has no `vision`, or the image is HEIC/HEIF | declare `vision`; HEIC/HEIF are only read by Gemini |
| The web app's Listen says "Spoken reply isn't available right now", or sentences are not spoken | the voice failed and the toast does not say why | the function log's `TTS failed before audio` line names the kind (`UNAVAILABLE`, `TIMEOUT`, `REJECTED`, `NO_AUDIO`, `BAD_AUDIO`). The reply is unaffected: it is a separate request, made after the text is on screen |
| Every spoken reply fails: `REJECTED` (HTTP 403, "refused the connection") | Microsoft's service refused this server's connection: it blocks the address, or it changed what it requires (the `Sec-MS-GEC` token, the browser version it expects). Retrying does not help; the connection is retried only once, for a clock disagreement. The log line says by how much the clocks still differed after the correction ("HTTP 403 twice; ... still N s"): a large N is a clock problem, about zero is a blocked address or a changed protocol | run the Edge TTS live probe (§5): if it passes, the service refuses Vercel's network and not the code; if it fails too, the protocol changed and the constants in `tts/edgeTransport.ts` need updating. Meanwhile `TTS_PROVIDER=none` makes the app say honestly that voice is off |
| Spoken replies stop for half a minute after a few failures | the circuit breaker: three requests in a row failed, so requests fail at once (`503 tts_unavailable`, with `Retry-After`) until one is let through | it closes by itself when the service answers; the failures before it are in the log |
| `503 tts_unavailable` straight away, with no failures in the log | this instance already has 8 syntheses running and 16 waiting (a burst), so it said busy at once | retry after the `Retry-After`; it is per instance |
| `BAD_AUDIO` | the service sent audio ZARVIS will not play: not MP3, or not 24 kHz (it is never played at the wrong speed) | the service changed its output format; the log line gives the sample rate |
| Hinglish (Hindi in Latin letters) is spoken with English pronunciation | every neural voice reads Latin letters with English rules | try `TTS_HINGLISH_VOICE=en-IN-NeerjaNeural` (an Indian-English voice), or have replies written in Devanagari |
| The voice picker's names (Kore, Puck, ...) do not match the voice that speaks | the picker still lists the five Gemini voice names that older clients send; the server turns them into a style (the usual voice, or a male one) | expected. Replacing the picker's options with Edge voice names is a web change, deliberately not made with the move |

---

## 7. Tests

| File | What it proves |
|---|---|
| `test/ai/modelGateway.test.ts` | routing, the fallback matrix, what must not fall back, capability gating, cooldown, no provider configured, log fields and redaction, request economy |
| `test/ai/modelGatewayStreamingVision.test.ts` | streaming failover and cleanup, vision routing by MIME type, OpenRouter failures inside a 200 |
| `test/ai/openRouterProvider.test.ts` | the OpenRouter wire format, key handling, retries, timeouts, SSE |
| `test/ai/geminiProviderHardening.test.ts` | network retries, structured timeouts, key supplier, stream cancel |
| `test/ai/errorTaxonomy.test.ts`, `test/config/aiConfig.test.ts`, `test/config/startup.test.ts` | the error kinds and wire mapping, config and catalog validation, startup failure and success |
| `test/agents/gatewayTurns.test.ts` | one turn through the real orchestrator, pipeline, skills and providers: request counts, billing, replay, concurrent duplicates, Retry, disconnect (also on real Postgres in CI) |
| `test/api/gatewayApi.test.ts` | `/health`, request ids and log correlation, nothing provider-specific reaches a client, image route, the voice independent of the AI providers, a real HTTP disconnect |
| `test/security/redact.test.ts`, `test/ai/contentGenerator.test.ts`, `test/observability/requestContext.test.ts` | redaction, skill error mapping, correlation ids |
| `test/scripts/openrouterProbe.test.ts` | the live-probe script against a stubbed OpenRouter: model-list parsing and candidate choice, pass / warn / fail for each check, the key only in the Authorization header and never printed, walking past models that refuse (403) within a bounded number of attempts, a rejected key ending the probe, the real turn as the verdict (a second model gets one when the first does not answer it), the serving model named, text from the network kept on one log line |
| `test/tts/voices.test.ts` | Hindi, English and Hinglish detection (and what is not Hinglish), the default voices, a caller's voice allowed or ignored (hostile values included), the old Gemini voice names as styles, the configured Hinglish voice |
| `test/tts/ssml.test.ts` | control characters and lone surrogates, XML escaping, Markdown/code/URL/emoji removal, sentence units (nothing lost), splitting by escaped bytes (Hindi included), SSML that hostile text cannot break out of |
| `test/tts/mp3Decoder.test.ts` | the service's 24 kHz MP3 decoded to the right number of samples, with the right pitch, identical for any way the network splits it (down to one byte), other sample rates and garbage refused, damage in the middle survived, reset, close, independent decoders |
| `test/tts/edgeTransport.test.ts` | the wire against a local fake of the service: the handshake (token checked against the reference algorithm, headers), the two messages, audio frames in order, streaming, simultaneous syntheses kept apart, the 403 clock correction (once), 429/5xx/4xx, no listener, connect/idle/total timeouts, early close, no audio, malformed frames, cancelling at every stage |
| `test/tts/edgeTtsProvider.test.ts` | the provider with a scripted wire and the real decoder: which voice, what is sent, text that cannot be spoken, parts spoken in order, WAV equal to the stream, bounded retries and which failures get one, no repeated audio, cancelling, the cap and the breaker, simultaneous replies not mixed, nothing of the text logged |
| `test/tts/ttsRoutes.test.ts` | the real routes with a scripted voice: WAV and PCM contracts, validation and auth, every failure kind's status and code, a failure before and after sound, a client that disconnects, a slow reader, simultaneous streams, the 40-a-minute limit, and a turn that finishes while the voice is broken |
| `test/tts/ttsConfig.test.ts` | the settings, a wrong value reported and replaced, `none`, the WAV header |
| `test/live/edgeTts.live.test.ts` | opt-in only (`ZARVIS_LIVE_TESTS=1`): the real service, from the Edge TTS live probe workflow |
| `web/e2e/tts-audit.cjs` (workflow *Edge TTS live audit (browser)*; not in the regular CI, because it depends on a service that is not ours) | the spoken reply end to end in real Chromium against a running server or a deployment: three languages and their voices, a long reply in order, Stop, a new message (typed and spoken), the Listen button, a failing voice (answered 503, unreachable, or failing for real) with the AI's reply still on screen and the next message answered |
| `scripts/live-smoke.mjs` (voice section; workflow *Live preview API smoke test*) | the same from the API side, on a deployment: both endpoints, three languages, the voice header, a long stream, the longest WAV, cancellation, bad requests, and the VOICE SUMMARY |
| `web/e2e/quality.e2e.cjs` (voice steps, CI `web-e2e`) | in real Chromium: one recognition result is one turn and its spoken reply starts none; a spoken reply of several sentences asks the voice for every one and ends with the orb idle; Stop silences it and the orb stays idle |

---

## 8. Limitations and operating notes

- **What the live OpenRouter probe has and has not shown (2026-10-04).** The build environment's
  network policy blocks `openrouter.ai`, so the unit tests use stubbed HTTP responses (as the Gemini
  tests always have). The manual **OpenRouter live probe** (§5) called the live API through this
  adapter, from GitHub Actions, with the repository secret. It showed that the key is accepted, that a
  plain request and a tool call (with a dotted tool name) work, and that a complete ZARVIS planner
  turn is answered through OpenRouter alone: through the `openrouter/free` router in one run, and
  pinned to `inclusionai/ling-3.0-flash-sante:free` in another. It also showed that availability under
  a free account is uneven: models that the public list calls free and tool-capable were refused (HTTP
  403 "only available on agentic harnesses"; HTTP 404 "guardrail restrictions and data policy"), and
  the router was refused by the account's data policy in one run and passed in the next. So pin a model
  that the probe verified, and run the probe again when a model stops working. **Not verified:** a
  real Gemini quota or outage event falling back to OpenRouter in a deployed environment, end to end.
  The fallback logic is verified against stubs and the OpenRouter half in isolation by the probe; the
  Vercel value of `OPENROUTER_API_KEY` itself was not exercised (the probe used the GitHub secret).
  First real use in a deployment: set `OPENROUTER_API_KEY` in Preview, confirm `/health` shows
  `aiFallback: true` (and `aiFallbackTools: true`, or chat turns will not fall back), run the smoke
  test, and watch the function log for the first real Gemini quota or outage event (an
  `AI provider fallback` line). An invalid Gemini key is deliberately not a fallback reason, so it
  cannot be used to force one.
- **What the Edge voice has and has not shown (2026-10-04).** The build environment's network policy
  blocks `speech.platform.bing.com`, so the voice is verified against stubs and against a local fake of
  the service that follows the protocol as the community `edge-tts` project documents it. Checked: the
  `Sec-MS-GEC` token against that project's reference algorithm (known answers); the audio path with
  real MP3 made by ffmpeg (decoded to the right length and pitch, identical for any split of the
  input, within one 16-bit step of ffmpeg's own decode); and the whole chain, route to WebSocket to
  decoder to WAV and PCM, run end to end in a real process against the fake. **Not verified:** that
  the live service accepts this handshake today; that it accepts Vercel's network; the exact frames it
  sends (the parser follows the reference: an unknown text frame is ignored, an unknown binary frame
  is refused); that the configured voices exist on it; how Hindi, Hinglish and English sound. The Edge
  TTS live probe and the live smoke test (§5) answer those. It is an **unofficial service**: Microsoft
  publishes no API, terms or guarantee for this use (it is the Read Aloud feature of its browser), it
  has changed what it requires before, and it can throttle or refuse a cloud provider's addresses. The
  code is arranged so that updating the constants, replacing the transport (`EdgeTransport`) or the
  whole provider (`TtsProvider`) touches no route and no client. Azure AI Speech offers the same neural
  voice names as a supported, contracted service, for an Azure account.
- **The voice on Vercel: the final audit (2026-10-04), what it showed and what it did not.**
  *Shown on a real Vercel deployment, against Microsoft's real service.* The environment this was built
  in reaches neither Microsoft nor Vercel, so the first proof had to wait for a push: the Preview
  deployment of commit `487dc10` was built by Vercel, and the live smoke test (§5) ran against it from
  GitHub Actions. Everything in its voice section passed, the whole VOICE SUMMARY: *voice service
  reached, English, Hindi, Hinglish, streaming, unary, cancellation*. English: a 6.7 s WAV and a 6.7 s
  stream in `en-US-JennyNeural`, first audio after 194 ms. Hindi: 10.1 s in `hi-IN-SwaraNeural`, first
  audio after 139 ms. Hinglish: 9.8 s in the Hindi voice, first audio after 189 ms. Every WAV was 24 kHz
  mono 16-bit, every stream whole 16-bit samples, every length plausible for its text. A 62 s stream began
  after 0.56 s and finished after 2.0 s (progressive, not held back); a 108.6 s, 5.1 MB WAV came back in
  one response in about 4.3 s. Six streams abandoned after their first bytes and two WAV requests dropped
  left the service serving (the next request took about 1 s), a caller's allowed voice was honoured
  (`en-US-GuyNeural`), an unknown voice was ignored, and bad requests got plain answers. Not shown by
  this run: how the voices sound (it checks format, length and voice name, not taste), playback on an
  Android phone, the production site (it still runs the build before this change), and whether Microsoft
  keeps accepting Vercel's addresses tomorrow.
  *Shown for real, locally* (real Chromium, real Express app, real `EdgeTtsProvider`, real WebSocket and
  real MP3 decoding; only the far end was a local stand-in, so the audio is a tone, not speech): the
  English, Hindi and Hinglish scenarios of the browser audit pass, each in its voice, on both endpoints,
  11 of 11 on three runs in a row and once more against a stand-in that speaks for as long as the text
  would take (up to 130 s of audio in one reply); Stop, and a new message typed or spoken, leave nothing of
  the old reply asked for and the orb idle; and with the far end failing for real (nothing listening, HTTP
  403, silence until the timeout, a drop in the middle of a sentence, the real Microsoft address from an
  environment that blocks it, `TTS_PROVIDER=none`, and the decoder package missing from the install) the AI's
  reply is on screen, the orb idle and the next message answered every time. The log of such a failure says
  what failed and why (kind, message, system error), never the text.
  *Shown by inspecting the platform:* the function bundle the tracer builds contains everything the voice
  loads; the decoder and `ws` load and decode on Node 18.20.8 to 24.21.0 from a root-only install; the
  protocol constants are identical to the newest release of the community `edge-tts` client (7.2.8,
  2026-03-22), whose tracker in the weeks before this audit shows no wave of 403s but does show reports of
  503 handshake errors and of intermittent "no audio was received" for some voices. A sentence that comes
  back with no audio is not retried here (`NO_AUDIO` is not retryable): the next sentence goes on and the
  reply has a gap. If the live service does that often, allow one retry for it in `tts/edgeTtsProvider.ts`.
  *A wrong prediction, corrected:* an earlier version of this document said a WAV longer than about 94
  seconds could not be delivered from Vercel (a documented limit of about 4.5 MB in one response). The
  deployment delivered 5.1 MB; the estimate was wrong and is removed.
- **A third web client defect, found by the first audit on Vercel, not fixed here.** One of twelve
  browser scenarios failed on the second Preview: the long reply's orb went idle about a second after
  the speech began. The cause is in the page, not in the voice: `init()` in `web/app.js` ends with an
  unconditional `setOrbState("IDLE")`, after the session, the skills and the tasks have loaded, so a turn that
  begins before start-up finishes (a fast tap on a cold serverless function, where start-up takes seconds)
  has its orb state overwritten while it is still speaking. It is old (nothing in this change touches it) and
  small: the speech continues and Stop still works, only the orb and its label say "Ready". The audit had
  started its turn before the page was ready, so it now waits for that last start-up step, and it checks
  that the orb stays on "speaking" until the speech has ended (with a start-up slowed down on purpose, the
  new check fails on the old behaviour and passes with the wait). The one-line fix is to set the orb to
  idle there only when nothing is happening: `setOrbState(isBusy() || state === "LISTENING" ? state : "IDLE")`.
  It is left out of this change, which is about the voice; say if it should go in.
- **Two web client defects found while checking the voice, and fixed.** Running the real client in
  Chromium against the voice routes showed that a spoken turn could end before its speech had begun: it
  waited only for audio that already existed, and a finished turn drops the sentences still waiting for
  their turn (the client speaks two at a time), so when a reply reached the client faster than the first
  audio came back, the sentences after the first two were never requested and the orb was left on
  "speaking". And Stop did not cancel the timers that set the orb to "speaking" when a later segment's
  audio was due, so the orb could return to "speaking" after Stop. Neither depends on the voice (they
  existed with the Gemini voice); both have steps in `web/e2e/quality.e2e.cjs` that fail on the old client.
- **Android** was not changed in its behaviour: only the settings text that named Gemini as the voice. It
  could not be built here (no Android SDK; `dl.google.com` is blocked). It runs on GitHub Actions.
  The wire contract it depends on is unchanged: `POST /api/v1/tts/synthesize` still returns a WAV that
  `MediaPlayer` plays (24 kHz, 16-bit, mono, as before); a non-2xx answer is still handled as "keep the
  reply as text".
- **Privacy.** A fallback sends the conversation to OpenRouter and to whichever upstream provider it
  routes to. Free models may be operated by providers that log or train on prompts; OpenRouter's
  account privacy settings control which providers are allowed. Review `PRIVACY.md` and your
  OpenRouter data-policy setting before enabling the fallback in production.
- **Per-instance state.** The quota cooldown and rate limits live in each serverless instance's
  memory. They bound abuse and waste but are not global.
- **Billing records** do not store the provider or model (a database change); the logs do.
- **Gemini's own model fallback** (`gemini-3.8-flash`) still runs before the gateway moves to
  another provider, so a Gemini outage costs up to about 7 s of backoff before OpenRouter is asked.
- **Web search** is unavailable without Gemini; the planner is still told it exists. It fails
  honestly, once, and is not retried.
- **No token streaming** to clients yet (unchanged): the gateway can stream, the orchestrator does
  not use it.
- **Android sends no `clientTurnId`** (§1.2), so a request replayed at the HTTP level would run
  again; the server-side replay protection in §1.5 covers clients that send the key (the web client).
  Android's own guards (a new turn cancels the old one, OkHttp's silent retry is off, only GET/HEAD
  or never-opened connections are retried) cover the known causes. Adding the key to the Android
  request is a client change and was deliberately not made here.
- **Timeouts bound the wait for response headers**, for Gemini (unchanged) and for OpenRouter
  (`OPENROUTER_TIMEOUT_MS`). A response that sends its headers and then stalls mid-body is bounded
  by the HTTP client's own body timeout (undici's default is 300 s) and by the function's maximum
  duration, not by these settings.
