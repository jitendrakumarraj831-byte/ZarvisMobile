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
| OpenRouter | **not reachable here**: `openrouter.ai` is blocked by this environment's network policy, so nothing in this work was verified against the live OpenRouter API (see §8) |

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
                                        text to speech (Gemini native audio)
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
| Text to speech | Gemini native audio | yes, **outside the gateway** | never | never |
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
- **Text to speech** stays Gemini native audio on its own routes; OpenRouter is never involved.

---

## 3. Configuration reference

Everything is read on the server. Nothing here is exposed to the browser (the web client is static
files with no build step and no `process.env`), to the Android app, or to a log. The page's
Content-Security-Policy keeps `connect-src 'self'`: the browser never talks to an AI provider.

| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | none | Gemini key (chat, search grounding, TTS, images). Secret |
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
| `GEMINI_API_KEY` | required for Gemini, search, voice, images | same | mark as Sensitive |
| `OPENROUTER_API_KEY` | to enable the fallback | to test it on a PR | mark as Sensitive. Absent = Gemini only |
| `OPENROUTER_MODEL` | optional (default `openrouter/free`) | optional | |
| `OPENROUTER_MODEL_CAPABILITIES` | set `tools` once the model is verified to call tools; otherwise tool-using chat turns will not fall back | same | |
| `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL_CONTEXT_TOKENS`, `OPENROUTER_TIMEOUT_MS` | optional | optional | |
| `AI_PRIMARY_PROVIDER`, `AI_FALLBACK_PROVIDER`, `AI_QUOTA_COOLDOWN_MS`, `AI_MODEL_CATALOG_JSON` | optional | optional | |

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

---

## 6. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Gemini hits its quota and users still see the quota error | the fallback is off, not configured, or cannot serve the request | `/health`: `aiFallback` present? `aiFallbackTools` true? (false = the OpenRouter model declares no `tools`, which every chat turn needs). In the `AI call failed` log line, `attempts` listing only `google` means the fallback was never tried |
| No fallback for chat turns only; content skills do fall back | the OpenRouter model does not declare `tools` (the safe default) | verify the model supports function calling, then `OPENROUTER_MODEL_CAPABILITIES=tools` |
| Nothing falls back, and logs show `AI_PROVIDER_AUTH_ERROR` | a provider rejects its key (never a fallback reason) | fix the key; `AI call failed` names which provider |
| `/health` 500 `ai_provider_config_invalid` | a present-but-wrong AI variable | read the function log's "Invalid AI configuration: ..." (it names the variable) |
| Only `OPENROUTER_API_KEY` is set and chat fails | tool support not declared | declare `tools`; web search and voice need Gemini |
| `AI_PROVIDER_CAPABILITY_UNSUPPORTED` | the request needs something no configured model declares (tools, vision, coding, a larger context, a HEIC image) | declare the capability, change the model, or configure Gemini |
| OpenRouter 402 | the OpenRouter balance is empty (it blocks free models too) | add credits; it is reported as a spent quota, never retried |
| OpenRouter 429 | free-model caps (OpenRouter documents per-minute and per-day limits that depend on the account's credit history: https://openrouter.ai/docs) | retried once if the wait is short; a daily cap is not retried |
| A tool call runs with "missing details" | the model returned tool arguments that are not valid JSON, so the input is empty (never invented) | use a model with reliable function calling |
| Answers differ in quality or language after a fallback | a different, possibly free, model answered | check `model` and `fallbackReason` in `AI call` |
| Turns time out on Vercel | the function's maximum duration is shorter than Gemini plus OpenRouter | raise it, or lower `OPENROUTER_TIMEOUT_MS` |
| Preview works, Production does not (or the reverse) | the variable exists in only one environment | set it for both, redeploy, compare `/health` |
| An image is not read on fallback | the OpenRouter model has no `vision`, or the image is HEIC/HEIF | declare `vision`; HEIC/HEIF are only read by Gemini |

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
| `test/api/gatewayApi.test.ts` | `/health`, request ids and log correlation, nothing provider-specific reaches a client, image route, TTS independence, a real HTTP disconnect |
| `test/security/redact.test.ts`, `test/ai/contentGenerator.test.ts`, `test/observability/requestContext.test.ts` | redaction, skill error mapping, correlation ids |

---

## 8. Limitations and operating notes

- **OpenRouter has not been exercised against the live API.** The build environment's network policy
  blocks `openrouter.ai`, so the adapter follows OpenRouter's documented OpenAI-compatible contract
  and is verified against stubbed HTTP responses only (as the Gemini tests have always been). First
  real use: set `OPENROUTER_API_KEY` in Preview, confirm `/health` shows `aiFallback: true` (and
  `aiFallbackTools: true`, or chat turns will not fall back), run the
  smoke test, and watch the function log for the first real Gemini quota or outage event (an
  `AI provider fallback` line). An invalid Gemini key is deliberately not a fallback reason, so it
  cannot be used to force one.
- **Android** was not changed and could not be built here (no Android SDK; `dl.google.com` is
  blocked). It runs on GitHub Actions. The wire contract it depends on is unchanged.
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
