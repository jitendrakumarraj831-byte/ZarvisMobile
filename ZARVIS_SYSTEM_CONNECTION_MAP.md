# ZARVIS system connection map

- **Date:** 2026-10-02
- **Code base:** PR #78 head `5cc165f` plus the fixes on `claude/optimistic-lovelace-y9w9q6`.
- **Method:** every row was traced in source. "Tested" means a test in this repository exercises
  the connection. Status values: CONNECTED, BROKEN, MISSING, MISCONFIGURED, PARTIAL, UNUSED,
  PLANNED.

`main` (`e010c12`) is **not** described here. It is 86 commits behind PR #78 and is missing most
of what is below: server-side confirmations, sessions, the capability registry, quota handling
and turn cancellation. See [ZARVIS_PRODUCTION_READINESS.md](./ZARVIS_PRODUCTION_READINESS.md) §1.

## 1. Topology

```
Browser (web/index.html → logic.js → app.js → feature-pages.js, sw.js)
  │  same origin, HTTPS, Bearer access token (localStorage)
  ▼
Vercel ── vercel.json routes ── /api/*, /health → api/index.ts (@vercel/node)
  │                              /*            → web/** (static)
  ▼
Express app  backend/src/server.ts
  securityHeaders (CSP) → CORS → JSON body (1 MB) → /health
  → per-IP limiter 600/min on /api/v1 → routers → error handler (safe codes)
  │
  ├─ auth / account / conversations / entitlements / usage / tasks / billing
  ├─ orchestrator  ─▶ Orchestrator.runTurn ─▶ turn ledger (clientTurnId)
  │                    ├─ greeting / creator-identity fast paths (no model call)
  │                    └─ agent loop ≤ 5 steps:
  │                         GeminiProvider.generate ─▶ Gemini generateContent
  │                         ToolPipeline.execute    ─▶ skill handler
  │                              registry → validate → permission → entitlement
  │                              → confirmation (server-issued) → execute → verify → charge
  │                              skills ─▶ Gemini (google_search grounding / generation)
  │                                     ─▶ GitHub REST (per-user token, AES-256-GCM)
  │                                     ─▶ TaskService (store)
  ├─ confirmations ─▶ ServerConfirmationService ─▶ ToolPipeline (approve once)
  ├─ tts           ─▶ GeminiTtsProvider ─▶ Gemini TTS (unary WAV / streamed PCM)
  ├─ documents     ─▶ unpdf / mammoth (PDF, DOCX) · Gemini vision (images)
  ├─ integrations  ─▶ GitHub (token check) ─▶ store (encrypted)
  └─ store: PostgresStore (POSTGRES_URL/DATABASE_URL, TLS verified) | InMemoryStore (dev/tests)

Android app (Compose, Hilt)
  ConversationViewModel → AndroidOrchestrator
     ├─ DeviceCommandGate / KeywordSkillMatcher → on-device ToolPipeline
     │     → RuntimePermissionBroker (Android permission dialogs) → ports
     │       (contacts, call, app launch, reminders/AlarmManager, …)
     └─ everything else → Retrofit ZarvisApi → POST /api/v1/orchestrator/turn (same Brain)
  AuthInterceptor + TokenAuthenticator → /auth/refresh (rotation) · SecureStorage (Keystore)
  AndroidSpeechToTextEngine (SpeechRecognizer) · AndroidTextToSpeechEngine → /tts/synthesize
```

## 2. Web → backend

| # | Source (file → function) | Destination | Method / path | Auth | Request → response | Timeout / retry / failure | Status |
|---|---|---|---|---|---|---|---|
| W1 | `app.js` `createGuestSession` | `auth.ts` `/guest` | POST `/api/v1/auth/guest` | none; IP limit 60/h | `{}` → `{accessToken, refreshToken, isGuest}` | no retry; failure shows boot error, never a fake account | CONNECTED, tested (E2E) |
| W2 | `apiFetch` → `refreshSession` → `doRefresh` | `/refresh` | POST `/api/v1/auth/refresh` | refresh token in body; IP 30/min | rotation; old token replay revokes the session | one refresh per tab (Web Locks across tabs); network/5xx keeps the account; only `session_*` codes end it | CONNECTED, tested |
| W3 | `signInWithEmail`, session gate | `/login`, `/link`, `/logout`, `/me` | POST/GET | Bearer (except login) | credentials → tokens | login 20/15 min/IP; link 10/15 min/account | CONNECTED, tested (E2E) |
| W4 | `runTurn` | `orchestrator.ts` `/turn-stream` | POST `/api/v1/orchestrator/turn-stream` | Bearer; 30/min/account | `{utterance ≤70k, locale, isFirstTurn, conversationId, history ≤12, clientTurnId}` → SSE `meta`, `progress` (thinking, tool_started, tool_finished), `delta`, `done`, `error` | no automatic retry; Stop/new turn aborts (server aborts too); a stream without `done`/`error` is a failure with Retry; **Retry re-sends the same `clientTurnId`** | CONNECTED, tested (unit + E2E) |
| W5 | conversation restore | `conversations.ts` | GET `/api/v1/conversations/:id/messages` | Bearer, ownership | → `{messages[]}` | 404 for unknown/foreign/non-UUID id | CONNECTED, tested |
| W6 | confirmation card | `confirmations.ts` | POST `/:id/approve`, `/:id/decline`; GET `/:id` | Bearer, ownership; 30/min | server-issued id → outcome | approve runs once; replay 409 `confirmation_already_used`; foreign 404 | CONNECTED, tested |
| W7 | Developer page | `developer.ts` | POST `/analyze`, `/implement` | Bearer; 10/min | `{repoUrl[, requirement]}` | implement always returns a confirmation; needs the user's own GitHub token | CONNECTED, tested (GitHub stub). Real GitHub write: NOT TESTED |
| W8 | GitHub connect | `integrations.ts` | GET/POST/DELETE `/integrations/github` | Bearer; 10/15 min | `{token}` → `{login, scopes}` | token verified with GitHub before storing; needs `INTEGRATION_ENCRYPTION_KEY` | CONNECTED, tested (stub) |
| W9 | `speakGeminiStream` | `tts.ts` | POST `/api/v1/tts/synthesize-stream` | Bearer; 40/min | `{text, voice}` → PCM stream | ≤2 concurrent segments, ordered playback; quota stops later segments; Stop aborts all | CONNECTED (code + mocked tests); live audio NOT TESTED |
| W10 | `speak` (unary) | `tts.ts` | POST `/api/v1/tts/synthesize` | Bearer | → WAV | no browser speechSynthesis fallback by design (Gemini is the only voice); 503 is shown as voice unavailable | CONNECTED |
| W11 | upload | `documents.ts` | POST `/api/v1/documents/extract` | IP 60/min + Bearer + 20/min | multipart ≤4 MB → `{text ≤60k chars}` | images need `GEMINI_API_KEY` (503 otherwise); quota → 429 | CONNECTED, tested |
| W12 | text that follows an upload | W4 | — | — | extracted text rides in `utterance` | was **BROKEN** for Hindi documents (>100 kB body → 500); fixed | CONNECTED, tested |
| W13 | Capabilities / Permission Center | `capabilities.ts` | GET `/api/v1/capabilities` | none | → registry (`shared/capability-registry.json` parity) | — | CONNECTED, tested |
| W14 | Skills, Plans, Usage | `skills.ts`, `entitlements.ts` | GET `/skills`, `/entitlements/me` | Bearer | → catalogue / plan + credits | — | CONNECTED |
| W15 | Tasks page | `tasks.ts` | GET `/tasks`, POST `/:id/{pause,resume,cancel,retry}` | Bearer, ownership | → task | transitions are stored, **no executor runs any step** | PARTIAL (see readiness §3) |
| W16 | Delete account | `account.ts` | DELETE `/api/v1/account` | Bearer | → 204 | cascades every account table, turn records included | CONNECTED, tested |
| W17 | Settings → status | `server.ts` | GET `/health` | none; 600/min/IP | → `{status, provider, database}` | 503 when the database is configured but unusable | CONNECTED, tested |
| W18 | Billing | `billing.ts` | POST `/api/v1/billing/webhook` | Bearer | purchase token | no Web checkout exists; server verifier fails closed in production | PARTIAL (no client) |

## 3. Android → backend

| # | Source | Destination | Method / path | Notes | Status |
|---|---|---|---|---|---|
| A1 | `SessionRepository` | auth routes | `/auth/guest`, `/signup`, `/login`, `/refresh`, `/me`, `/link`, `/logout` | `TokenAuthenticator` refreshes once; only `session_invalid`, `session_revoked`, `refresh_token_reused` clear tokens; a POST is never silently re-sent | CONNECTED (CI + emulator); device NOT TESTED |
| A2 | `AndroidOrchestrator.handleWithBrain` | `/orchestrator/turn` (JSON) | POST | OkHttp connect 15 s, read/write 150 s, call 180 s. Quota → honest FAILED turn. Sends no `clientTurnId` (no Retry exists on Android, so a re-send is a new message by the user) | CONNECTED |
| A3 | `restoreConversation` | `/conversations/{id}/messages` | GET | conversation id persisted locally | CONNECTED |
| A4 | confirmation dialog | `/confirmations/{id}/approve|decline` | POST | ≤ `MAX_CONFIRMATION_ROUNDS` when the action changed after approval | CONNECTED |
| A5 | `AndroidTextToSpeechEngine` | `/tts/synthesize` | POST `@Streaming` | body read on `Dispatchers.IO`; `MediaPlayer` plays the WAV | CONNECTED (CI); audio on device NOT TESTED |
| A6 | Developer screen | `/developer/analyze` | POST | read-only | CONNECTED |
| A7 | Tasks screen | `/tasks`, `/tasks/{id}/{action}` | GET/POST | same as W15 | PARTIAL |
| A8 | on-device skills | `/usage/charge` | POST | cost from the server registry, never from the client; all on-device skills cost 0 today | CONNECTED, effectively UNUSED |
| A9 | Plans | `/entitlements/me`, `/skills` | GET | display only; no Play Billing client | PARTIAL |
| A10 | Release build | `https://zarvismobile.com/` | — | asserted in CI; debug uses `http://<dev-host>:3000/` (cleartext scoped to that host) | CONNECTED (CI) |

`ContractTest`: `backend/test/api/clientContract.test.ts` checks mechanically that every Android
Retrofit endpoint and every web `apiFetch` path is a served route with the same method.

## 4. Android on-device chain

| Step | Code | Status |
|---|---|---|
| Utterance → gate | `DeviceCommandGate`, `KeywordSkillMatcher` (domain) | CONNECTED, 120 JVM tests pass locally |
| Input building | `OnDeviceInputBuilder` | CONNECTED |
| Capability check | `shared/capability-registry.json` (16 capabilities) | CONNECTED (emulator phase D) |
| Permission | `ActivityRuntimePermissionBroker` → Android dialog; Permission Center; revocation detection | CONNECTED on emulators API 26/30/34; device NOT TESTED |
| Confirmation | `ComposeConfirmationPort` | CONNECTED |
| Tool execution | `AndroidContactLookupPort`, `AndroidPhoneCallPort`, `AndroidAppLauncherPort`, `AndroidReminderAlarmPort` | CONNECTED (emulator) |
| Verification | `ToolPipeline` non-empty result check | PARTIAL (no per-capability evidence) |
| STT | `AndroidSpeechToTextEngine` (`SpeechRecognizer`, destroyed in `awaitClose`) | CONNECTED; real microphone NOT TESTED |

## 5. Backend → external providers

| # | Caller | Provider | Credential (env) | Timeout | Retry | Failure → client | Status |
|---|---|---|---|---|---|---|---|
| E1 | `GeminiProvider.generate/streamGenerate` | Gemini `generateContent` | `GEMINI_API_KEY` (header `x-goog-api-key`) | per request | `ai/geminiErrors.ts`: daily quota 0 retries; per-minute 1 retry if wait ≤8 s; 5xx 2 retries + backoff/jitter, then fallback model; other 4xx none | `AIProviderError` → SSE `error` / JSON 429/503 with `type`, `retryable`, `retryAfterMs`, `quotaType` | CONNECTED (live chat verified by the owner on a phone, 2026-10-01). The CI smoke test did not check it until this branch (its "Hi" never calls Gemini). Production with no key now fails closed (`UnavailableAIProvider`) instead of answering with the mock. Fallback-model switch now logged |
| E2 | `GeminiSearchProvider` | Gemini + `google_search` grounding | `GEMINI_API_KEY` | per request | same policy | `execution_failed` (`ai_quota_exceeded`, `search_provider_unavailable`); never fake sources in production | CONNECTED (mocked HTTP tests) |
| E3 | `GeminiTtsProvider` | Gemini TTS models | `GEMINI_API_KEY`, `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE` | 120 s | same policy; candidate models | 429/503 with codes | CONNECTED (mocked); live NOT TESTED here |
| E4 | `documents.ts` image analysis | Gemini vision | `GEMINI_API_KEY` | 60 s | same policy | 503 when no key; 429 on quota | CONNECTED |
| E5 | `githubClient.ts` | GitHub REST | per-user token, encrypted with `INTEGRATION_ENCRYPTION_KEY`; `GITHUB_API_BASE_URL` | per request | none | `execution_failed` | CONNECTED (stub); live write NOT TESTED |
| E6 | `PostgresStore` | Postgres (Neon in production) | `POSTGRES_URL`/`DATABASE_URL`, `POSTGRES_CA_CERT`, `POSTGRES_SSL_MODE` | pool defaults; health 5 s | schema init retried | `/health` code; route 500 with safe code | CONNECTED (live `/health` `database: ok`) |
| E7 | `playBillingVerifier.ts` | Google Play Developer API | `PLAY_BILLING_SERVICE_ACCOUNT_JSON`, `PLAY_BILLING_PACKAGE_NAME` | — | none | fails closed in production when unset | PARTIAL (no client) |
| E8 | — | Anthropic / OpenAI | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | — | — | read by `env.ts`, **used nowhere** | UNUSED |

## 6. Gemini requests per user turn

From `backend/test/agents/turnEconomy.test.ts` (real provider classes, only `fetch` stubbed)
plus code reading where marked.

| Turn | Requests | Why each exists |
|---|---|---|
| Greeting ("Hi", "नमस्ते") or creator question | 0 | deterministic fast path |
| Plain question | 1 | planner answers directly |
| Web search | 3 | plan → grounded search → answer from the sources |
| Creative ("poem likho"), research, document summary, business draft | 3 | plan → generation skill → final reply (code reading for non-poem skills; poem is tested) |
| Research that searches first | 5 | plan → search → plan → generation → final (model-dependent; code reading) |
| Daily quota on the first call | 1 | then a structured error; no retry, no fallback |
| Search hits the daily quota | 2 | plan + search; no re-search, no further planning |
| Voice turn | as the typed turn, plus 1 TTS request per spoken segment (~220–320 characters) | TTS is separate from the turn and never starts another turn |
| Re-sent turn with the same `clientTurnId` (new) | 0 | stored result replayed |

Correlation ids: `turnId` (per request; in `meta`/`done` and the `Turn finished` log line),
`clientTurnId` (per logical turn, from the client), `toolCallId` (per execution), Gemini
`responseId` (per model response), `servedModels` (which model answered). There is no separate
`modelCallId`; `modelCalls` and `providerHttpRequests` counts are in the turn log line.

## 7. Streaming state machine (web)

| UI state | Set when | Real event behind it |
|---|---|---|
| IDLE | no turn in flight | — |
| UNDERSTANDING | request sent; `progress.thinking` step > 1 | request / model step started |
| EXECUTING | `progress.tool_started` | ToolPipeline started a skill |
| SPEAKING | audio actually starts | Web Audio playback |
| SUCCESS → IDLE | `done` | turn completed (or replayed) |
| ERROR | `error`, non-2xx, stream ended without `done` | real failure |
| (CONFIRMATION_REQUIRED) | `done` with a `confirmation_required` tool call | server-issued confirmation card |

PLANNING, WAITING, VERIFYING, PERMISSION_REQUIRED (web), CANCELLED and DISCONNECTED as distinct
UI states do not exist. They are not faked; the missing ones are listed in the readiness report.
