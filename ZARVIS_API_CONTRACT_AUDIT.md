# ZARVIS API contract audit

- **Date:** 2026-10-02. **Code:** PR #78 head `5cc165f` plus this branch's fixes.
- **Mechanical checks in the repository:**
  - `backend/test/api/clientContract.test.ts`: every Android Retrofit endpoint (`ZarvisApi.kt`)
    and every web `apiFetch(...)` path is a served Express route with the same method.
  - `backend/test/api/routeAuthCoverage.test.ts`: every route except the documented public ones
    requires auth.
  - `backend/test/capabilities/registry.test.ts` plus the CI diff of
    `shared/capability-registry.json`: the registry the clients read equals the server's.
- **This audit** read every router, both clients and the error handler, and reproduced each
  mismatch below before fixing it.

## 1. Endpoint table

Common to every route: same-origin web client, so CORS is an allow-list (`CORS_ORIGINS`) only
for other origins; a per-IP ceiling of 600/min on `/api/v1`; errors are
`{error, code?}` with safe codes only (no SQL, upstream bodies or secrets).

| Method | Path | Auth | Route limit | Request | Response | Streaming | Web | Android |
|---|---|---|---|---|---|---|---|---|
| GET | `/health` | none | 600/min/IP | — | `{status, provider, database}`; 503 when the DB is unusable | no | yes | no |
| POST | `/api/v1/auth/guest` | none | 60/h/IP | — | `{accessToken, refreshToken, isGuest}` | no | yes | yes |
| POST | `/api/v1/auth/signup` | none | 60/h/IP | `{email, password}` | tokens | no | — | yes |
| POST | `/api/v1/auth/login` | none | 20/15 min/IP | `{email, password}` | tokens; 401 `invalid_credentials` | no | yes | yes |
| POST | `/api/v1/auth/refresh` | refresh token | 30/min/IP | `{refreshToken}` | rotated tokens; 401 `session_invalid` / `session_revoked` / `refresh_token_reused` | no | yes | yes |
| POST | `/api/v1/auth/logout` | Bearer | — | — | 204 | no | yes | yes |
| GET | `/api/v1/auth/me` | Bearer | — | — | account summary | no | yes | yes |
| POST | `/api/v1/auth/link` | Bearer | 10/15 min/account | `{email, password}` | tokens; 409 `email_taken` / `not_guest` | no | yes | yes |
| DELETE | `/api/v1/account` | Bearer | — | — | 204 | no | yes | yes |
| GET | `/api/v1/skills` | Bearer | — | — | catalogue with entitlement | no | yes | yes |
| GET | `/api/v1/capabilities` | none | — | — | registry | no | yes | (bundled JSON) |
| POST | `/api/v1/orchestrator/turn-stream` | Bearer | 30/min/account | `{utterance, locale?, isFirstTurn?, conversationId?, history?, userName?, clientTurnId?}` | SSE `meta`, `progress`, `delta`, `done{message, toolCalls, conversationId, turnId, replayed?}`, `error{error, code?/type?, retryable, retryAfterMs?, quotaType?, turnId}` | **yes** | yes | no |
| POST | `/api/v1/orchestrator/turn` | Bearer | 30/min/account | same | `{message, toolCalls, conversationId, turnId, replayed?}`; 429/503 provider; 409 `turn_in_progress` / `client_turn_id_reused`; 400 `invalid_client_turn_id` / `invalid_json`; 413 `payload_too_large` | no | — | yes |
| GET | `/api/v1/conversations/:id/messages` | Bearer, owner | — | — | `{messages[]}`; 404 | no | yes | yes |
| GET | `/api/v1/confirmations/:id` | Bearer, owner | — | — | record | no | — | — |
| POST | `/api/v1/confirmations/:id/approve` | Bearer, owner | 30/min | — | tool outcome; 409 `confirmation_already_used`; 404 | no | yes | yes |
| POST | `/api/v1/confirmations/:id/decline` | Bearer, owner | 30/min | — | outcome | no | yes | yes |
| POST | `/api/v1/developer/analyze` | Bearer | 10/min | `{repoUrl}` | outcome | no | yes | yes |
| POST | `/api/v1/developer/implement` | Bearer | 10/min | `{repoUrl, requirement}` | confirmation required | no | yes | — |
| GET/POST/DELETE | `/api/v1/integrations/github` | Bearer | POST 10/15 min | `{token}` | `{connected, login, scopes}` | no | yes | — |
| GET | `/api/v1/entitlements/me` | Bearer | — | — | plan, credits, trial | no | yes | yes |
| POST | `/api/v1/usage/charge` | Bearer | — | `{skillId}` (on-device skills only; cost from server registry) | `{balance}` | no | — | yes |
| POST | `/api/v1/tasks` | Bearer | — | `{goal}` | task | no | — | yes |
| GET | `/api/v1/tasks`, `/api/v1/tasks/:id` | Bearer, owner | — | — | tasks | no | yes | yes |
| POST | `/api/v1/tasks/:id/{pause,cancel}` | Bearer, owner | — | — | task; 409 invalid transition | no | yes | yes |
| POST | `/api/v1/tasks/:id/{resume,retry}` | Bearer, owner | — | — | always 409 `task_execution_unavailable` (no executor exists; status unchanged) | no | — | — |
| POST | `/api/v1/tts/synthesize` | Bearer | 40/min | `{text, voice?}` | WAV; 503 no key; 429 quota | chunked body | yes | yes |
| POST | `/api/v1/tts/synthesize-stream` | Bearer | 40/min | `{text, voice?}` | PCM stream | **yes** | yes | — |
| POST | `/api/v1/documents/extract` | Bearer | 60/min/IP + 20/min/account | multipart `file` ≤4 MB | `{text ≤60k chars, kind?}`; 400/413/415/422/429/503 codes | no | yes | — |
| POST | `/api/v1/billing/webhook` | Bearer | — | purchase token | plan | no | — | — (no Play Billing client) |

Never called by either client (served, used by tests/ops only): `GET /confirmations/:id`.
Android-only: `/auth/signup`, `/tasks` POST, `/usage/charge`, JSON `/orchestrator/turn`.
Web-only: `/orchestrator/turn-stream`, `/developer/implement`, `/integrations/github`,
`/tts/synthesize-stream`, `/documents/extract`.

## 2. Mismatches found and fixed (PR #79)

| # | Contract | What the clients/docs expected | What the server did | Fix | Test |
|---|---|---|---|---|---|
| C1 | Request body errors | 4xx for a client error | malformed JSON → **500 `internal_error`** | 400 `invalid_json`, including the Vercel runtime's own `ApiError(400, "Invalid JSON")` | `test/api/requestBody.test.ts` |
| C2 | Turn body size | route documents `utterance` ≤70,000 characters; uploads produce ≤60,000 characters that the web sends with the next turn | `express.json()` 100 kB default: a 60,000-character **Hindi** document (~180 kB UTF-8) → **500** | 1 MB JSON limit; over-limit → 413 `payload_too_large`; web shows "too long to send" instead of "can't connect" | `requestBody.test.ts`, `web/tests/logic.test.js` |
| C3 | Turn idempotency | Retry should re-send *the same* turn | every request was a new turn: tools re-ran, charged again, user message stored twice | `clientTurnId`: replay / 409 / safe retry | `test/agents/turnIdempotency.test.ts` (both stores), E2E |
| C4 | Unknown ids | 404 for an id that names nothing (in-memory behaviour, which most tests use) | Postgres: a non-UUID id → **500** on turn, conversation messages, confirmations, tasks | non-UUID = not found | `test/api/nonUuidIds.test.ts` (both stores) |
| C5 | AI answers in production | an answer comes from the AI, or an honest error | with no `GEMINI_API_KEY`, the planner was `MockAIProvider` in production too: canned text shown as the AI's reply | production uses `UnavailableAIProvider`: SSE `error` / JSON 503 `AI_UNAVAILABLE`; `/health` `provider: none` | `test/ai/unavailableProvider.test.ts` |
| C6 | Live smoke "chat works" | a real model answer | the only smoke turn ("Hi") never reaches Gemini | `scripts/live-smoke.mjs`: model answer, web search, upload, TTS, auth lifecycle, errors, replay; a mock answer never passes | live run on the preview: 19 PASS, 1 WARN (search rate-limited) |
| C7 | `clientTurnId` reuse | one key = one message | a reused key with other text replayed the earlier answer | fingerprint bound to the key; 409 `client_turn_id_reused` | `turnIdempotency.test.ts` |
| C8 | Task resume/retry | a reported state is a real state | `resume`/`retry` set `RUNNING` with no executor | 409 `task_execution_unavailable`; clients offer no Start/Resume/Retry | `api.test.ts`, `taskService.test.ts` |
| C9 | Retry after a late failure | a Retry does not repeat work already done | the tool that succeeded before the failure ran and was charged again | the failed attempt's successful executions are reused (same `toolCallId`) | `turnIdempotency.test.ts` |

## 3. Checked and consistent

- Every client endpoint exists with the same method (`clientContract.test.ts`, re-run: pass).
- No client sends a `confirmed` flag that the server honours; the server ignores it.
- SSE framing: `event:`/`data:` frames, the web parser drops malformed frames and flushes the
  tail once (`web/tests/logic.test.js`).
- A stream that ends without `done`/`error` is a failure on the web (E2E).
- Error shape for provider failures is identical on SSE (`error` event) and JSON (429/503).
- Auth errors: only the three `session_*`/`refresh_token_reused` codes end a session on either
  client; network and 5xx failures keep the same account (E2E, Android `TokenAuthenticator`).

## 4. Open contract items (not changed)

| # | Item | Why not changed |
|---|---|---|
| O2 | `/billing/webhook` is client-called, not a Play RTDN webhook | needs Play Billing integration |
| O4 | Android sends no `clientTurnId` | Android has no Retry action, so every send is a new message by the user; add it when Retry is added |
| O5 | SSE has no heartbeat while a long model call runs | progress events are sent at every real stage; idle proxies have not been observed to cut a turn. Watch the Vercel logs |
