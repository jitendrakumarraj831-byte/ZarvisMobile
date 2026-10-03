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

## Provider failures, quota and retries

Every Gemini call (chat generation, web-search grounding, TTS, image analysis) uses one
policy, `backend/src/ai/geminiErrors.ts`:

| Failure | What happens |
|---|---|
| 429 for an exhausted **daily/project quota** (`QuotaFailure` quota id `...PerDay...`, e.g. `generate_content_free_tier_requests`) | No retry and no fallback model. `AIProviderError` `AI_QUOTA_EXCEEDED`, `retryable: false`. |
| 429 for a **per-minute** rate limit | One retry, only when the advised wait (`RetryInfo` / `Retry-After`) is ≤ 8 s. Otherwise `AI_RATE_LIMITED` with `retryAfterMs`. |
| 408 / 5xx | At most two retries with exponential backoff and jitter, then the fallback model. |
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
- **Fallback model.** On 404 or a 5xx that outlasts its bounded retries, chat and TTS move to
  the fallback model. This is never silent: a warning names the `modelCallId`, the configured
  and the serving model, and `servedModel` records it in `aiCallLog`
  (`geminiProvider.test.ts`). A daily quota never falls back.

## Tasks

No task executor exists yet. Tasks are tracked, can be paused or cancelled, and are never
reported as running: `resume` / `retry` answer `task_execution_unavailable`.

## No AI credential

In production with no `GEMINI_API_KEY`, every model call fails with `AI_UNAVAILABLE` (503) and
`/health` reports `provider: none`. The deterministic mock provider, mock search and mock
content generators exist for development and tests only. Greetings and creator questions need
no model and still answer.
