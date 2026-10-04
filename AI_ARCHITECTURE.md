# ZARVIS AI Architecture

## One Brain

ZARVIS uses one shared agent architecture across Web and Android. Client applications do not maintain independent AI brains.

## Reasoning and execution boundary

The AI layer can interpret intent and propose a plan. It must not directly bypass policy or platform security.

```
Intent
 → Planner
 → Agent / Skill selection
 → Capability Registry
 → Permission / Integration check
 → Risk / Confirmation
 → ToolPipeline
 → Verification
 → Response
```

## Agent behavior

Agents should:

1. Understand the user's goal.
2. Ask only essential questions.
3. Build an executable plan.
4. Identify required capabilities and access.
5. Request confirmation where required.
6. Execute through authorized tools.
7. Verify actual results.
8. Report exact outcomes.
9. Persist resumable state when appropriate.

## Failure honesty

The AI must distinguish permission denial, unsupported capability, required user action, authentication failure, provider failure, timeout, verification failure, partial success and cancellation.

## AI Model Gateway

Nothing in ZARVIS names an AI vendor except the two adapters. The planner, the content skills and
image analysis call one **ModelGateway** (`backend/src/ai/modelGateway.ts`), which is itself an
`AIProvider`. It routes each request to a configured model that **declares** every capability the
request needs (text, streaming, tools, vision, structured output, long context, coding, reasoning),
and, when the primary provider fails for a temporary, provider-side reason, makes exactly one more
attempt on the fallback provider if it can serve the same request.

```
ZARVIS Brain → ModelGateway → Gemini      (primary: chat, tools, vision, search grounding, voice)
                            → OpenRouter  (fallback: only what its configured model declares)
```

- The fallback never hides a real bug: authentication errors, invalid requests, a missing model, a
  capability the fallback does not declare, an application error and a cancelled turn never fall
  back.
- A provider switch is never silent: the answer carries `AICallMeta` (provider, model, fallback,
  reason), the call log records both attempts, and one structured log line is written per call.
- Web search (Google Search grounding) is not behind the gateway and is never answered by another
  provider. Text to speech is not an AI provider call at all: it is Edge's neural voices
  (`backend/src/tts/`), behind its own `TtsProvider` boundary and independent of Gemini and
  OpenRouter (AI_MODEL_GATEWAY.md §2.14).
- One user turn is still one generation: no hedging, one fallback hop, bounded retries, and the
  `clientTurnId` ledger below is unchanged.

Architecture, the capability matrix, fallback rules, configuration, Vercel setup, observability and
troubleshooting: **[AI_MODEL_GATEWAY.md](./AI_MODEL_GATEWAY.md)**.

## Provider failures, quota and retries

Every Gemini call (chat generation, web-search grounding, image analysis) uses one
policy, `backend/src/ai/geminiErrors.ts`, and OpenRouter shares its retry rules (the gateway
document lists them for both providers):

| Failure | What happens |
|---|---|
| 429 for an exhausted **daily/project quota** (`QuotaFailure` quota id `...PerDay...`, e.g. `generate_content_free_tier_requests`) | No retry and no fallback model. `AIProviderError` `AI_QUOTA_EXCEEDED`, `retryable: false`. |
| 429 for a **per-minute** rate limit | One retry, only when the advised wait (`RetryInfo` / `Retry-After`) is ≤ 8 s. Otherwise `AI_RATE_LIMITED` with `retryAfterMs`. |
| 408 / 5xx / network failure | At most two retries with exponential backoff and jitter, then the fallback model. |
| Timeout | Not retried: the provider may still be working. A structured `AI_PROVIDER_TIMEOUT` (wire `AI_UNAVAILABLE`, retryable). |
| 404 (model not available) | Next candidate model. |
| Other 4xx | Fails at once. |

Clients receive the structured error. The SSE `error` event and the JSON 429 body carry
`type`, `retryable`, `retryAfterMs` and `quotaType`. Nothing is fabricated and nothing is
charged for a failed generation.

## One user turn, one execution

- A turn has a `turnId`. Each tool execution has a `toolCallId`. One log line per turn
  records model calls, provider HTTP requests (retries included), Gemini response ids and
  tool calls.
- The same skill with the same input is not run twice in a turn.
- A skill whose service failed in this turn (handler error, AI quota, provider unavailable)
  is not run again with reworded input. An AI quota failure ends the turn without another
  model call. A search that found nothing may still be refined.
- When the client disconnects (Stop, a newer turn, a closed tab), the turn is aborted: no
  further model or tool call starts.
- A client may send a `clientTurnId` (its idempotency key for one logical turn; the web client
  creates one per submission and reuses it for Retry). A completed turn re-sent with the same
  key is answered from its stored result (`replayed: true`): no model call, no tool, no charge,
  no new message. A turn still running elsewhere gets `turn_in_progress`. A failed one runs
  again in the same conversation without storing the user's message twice. Keys are per
  account and kept 24 hours.
- A key reused for a *different* message is refused (`client_turn_id_reused`); nothing runs.
- A Retry of a turn that failed after a tool succeeded reuses that tool's result for the same
  request (same `toolCallId`): no second execution, no second charge.
- Every logical AI call in a turn has a `modelCallId` and is listed in the turn log line's
  `aiCallLog` (planner steps and the calls skills make, such as search grounding and
  generation), with `kind`, `configuredModel`, `servedModel`, `httpRequests`, `outcome` and
  `status`; `aiCalls` / `aiHttpRequests` give the totals.
- **Fallback model.** On 404 or a 5xx that outlasts its bounded retries, chat moves to
  the fallback model. This is never silent: a warning names the `modelCallId`, the configured
  and the serving model, and `servedModel` records it in `aiCallLog`
  (`geminiProvider.test.ts`). A daily quota never falls back to another *model*.
- **Fallback provider.** After Gemini's own retries and model fallback, the ModelGateway may make
  one attempt on OpenRouter (see "AI Model Gateway"). A daily quota does fall back to another
  *provider* (without retrying first), because a different provider has a different quota.
- Every call in `aiCallLog` names its `provider`; a fallback attempt carries `fallback: true` and
  `fallbackReason`, and shares the `modelCallId` of the attempt it replaced. The turn line also
  reports `aiLogicalCalls`, `aiProviders`, `aiFallbackCalls` and `chargedCredits`.

## Tasks

No task executor exists yet. Tasks are tracked, can be paused or cancelled, and are never
reported as running: `resume` / `retry` answer `task_execution_unavailable`.

## No AI credential

In production with neither `GEMINI_API_KEY` nor `OPENROUTER_API_KEY`, every model call fails with
`AI_UNAVAILABLE` (503) and `/health` reports `provider: none`. With only `OPENROUTER_API_KEY`,
OpenRouter answers the requests its model declares it can serve. The deterministic mock provider, mock search and mock
content generators exist for development and tests only. Greetings and creator questions need
no model and still answer.
