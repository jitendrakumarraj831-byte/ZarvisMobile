# ZARVIS MOBILE — FULL CODEBASE AUDIT

Read-only review of the tracked tree (257 files: Android, backend, web, Vercel API, CI, and docs). This document records findings only. It does not change product code.

## 1. Architecture Summary

Zarvis is one product with three clients and one TypeScript backend.

**Long-running server.** `backend/src/index.ts` loads env, builds a container, and listens. `buildServer()` mounts `/health` and `/api/v1/*`, then can serve `web/` as a same-origin SPA.

**Vercel.** `vercel.json` sends `/` and static assets to `web/`, and `/(api/.*|health)` to `api/index.ts`. That file lazily imports the same `buildContainer()` / `buildServer()`. There is no second API implementation. `api/routes/voice.js` is not mounted.

**Composition.** Postgres if `POSTGRES_URL` or `DATABASE_URL` is set; otherwise an in-memory store. Skills go through `ToolPipeline` (registry → validation → permission → entitlement → confirmation → execute → verify → charge). The orchestrator is a bounded loop (max 5 steps) over Gemini, or a mock provider when `GEMINI_API_KEY` is unset. New accounts are created as a 14-day `TRIAL` with 50 credits. Only `developer.implement` requires `PRO` and `confirmed === true`.

**Web.** Vanilla SPA: `web/index.html` + `web/app.js` + `web/styles.css` + `web/sw.js`. Boot creates a guest account (`POST /api/v1/auth/signup`), stores JWTs in `localStorage`, and talks to `/api/v1`. Chat uses `POST /orchestrator/turn-stream` (SSE). Voice-in is one-shot Web Speech. Voice-out is `POST /tts/synthesize-stream` (PCM). Files go to `POST /documents/extract` or are read locally, then folded into the next utterance.

**Android.** Multi-module app (minSdk 26). Hilt wires Retrofit to `BuildConfig.API_BASE_URL`. `AndroidOrchestrator` tries an on-device keyword match first (reminder, open app, find contact, call). Otherwise it calls `POST /api/v1/orchestrator/turn` (not the stream) and `POST /tts/synthesize` (WAV). Tokens live in EncryptedSharedPreferences.

**Actual flows**

1. Frontend → API: Web `apiFetch` and Android `ZarvisApi` both use Bearer access tokens, refresh on 401, and mint a new guest if refresh fails.
2. API → orchestrator: `POST /orchestrator/turn` and `/turn-stream` both call `Orchestrator.runTurn` to completion. The stream route then chunks the finished text.
3. Orchestrator → skills: The model gets entitlement-filtered tools. Each call goes through `ToolPipeline`. `developer.analyze_repo` is hidden unless the current utterance looks like a repo analysis.
4. AI: `GeminiProvider.generate` (90s timeout, retries, fallback model). `streamGenerate` exists and is not used by the orchestrator. `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are read and unused.
5. Voice: Web push-to-talk → utterance → SSE text → Gemini PCM if the turn started from the mic and spoken replies are on. Android STT is hardcoded `en-IN`, then WAV TTS, also `en-IN`.
6. Files: Images, PDF, and DOCX are extracted server-side (images via Gemini). Text types are read in the browser. The next chat turn carries the text. Android has no document client.
7. Auth: Guest signup, HS256 access (1h) and refresh (30d). Refresh is not stored server-side. `requireAuth` trusts the JWT and does not re-check the account row.
8. Activity: Skills can insert `Task` rows. Nothing executes steps. Clients can pause, resume, cancel, and retry the status only.
9. Developer Agent: Analyze is free and read-only. Implement is PRO, confirmation-gated, and uses one shared `GITHUB_TOKEN` to branch, commit, and open a PR. It does not merge. The public web developer screen is intentionally unwired. Android has analyze only.
10. Errors: Express error middleware returns a safe `code`. Gemini HTTP failures are supposed to become 503, but the status regex does not match (see P2). Web shows one generic connection bubble. Android replaces the assistant line with the exception text.

## 2. Critical Issues

### AUD-P0-01 — Cross-account task read and mutation

- **Class:** Confirmed bug. **Severity:** P0.
- **File:** `backend/src/api/routes/tasks.ts` `GET /:id` (lines 32–42) and `POST /:id/{pause,resume,cancel,retry}` (lines 45–57); `backend/src/tasks/taskService.ts` `get` / `transition` (lines 55–89).
- **Problem:** Any logged-in account can read or change any task by UUID.
- **Why:** `list` and `create` filter by `req.auth.accountId`. `get`, `pause`, `resume`, `cancel`, and `retry` load the task by id only.
- **Impact:** Goal text, steps, and status of another account’s workflows can be read or changed. `automation.cancel_workflow` avoids this; the HTTP API does not.
- **Evidence:** `taskService.get(req.params.id!)` and `taskService[action](req.params.id!)` never compare `task.accountId` to `req.auth.accountId`.

### AUD-P0-02 — Unset Play credentials grant PRO

- **Class:** Confirmed bug (default configuration). **Severity:** P0.
- **File:** `backend/src/container.ts` lines 49–51; `backend/src/billing/playBillingVerifier.ts` `MockPlayBillingVerifier` lines 19–25; `backend/src/api/routes/billing.ts` lines 24–44.
- **Problem:** If `PLAY_BILLING_SERVICE_ACCOUNT_JSON` is absent, any non-empty `purchaseToken` plus `zarvis_pro_monthly` or `zarvis_pro_yearly` sets the caller’s plan to `PRO`.
- **Why:** The mock verifier returns `valid: true` for any non-empty token. Production startup does not refuse to boot in that state. The route is authenticated and live.
- **Impact:** A guest can upgrade itself and then use `developer.implement` (10 credits, shared GitHub token). Combined with AUD-P1-10 this is a write path into every repo that token can push.
- **Evidence:** `MockPlayBillingVerifier.verifyPurchaseToken` returns `{ valid: true }` when `purchaseToken` is non-empty. `billingRouter` then calls `store.updateAccountPlan(..., plan)`.

### AUD-P0-03 — Serverless default store does not survive a cold start

- **Class:** Confirmed failure mode when `POSTGRES_URL` and `DATABASE_URL` are unset. **Severity:** P0 for that deploy.
- **File:** `backend/src/container.ts` `defaultStore` lines 21–22; `api/index.ts` (same container).
- **Problem:** With no database URL the process uses `InMemoryStore`.
- **Why:** That is the explicit fallback. On Vercel each cold start is a new process.
- **Impact:** Guest accounts, trials, conversations, and tasks disappear between invocations. Clients keep JWTs for users that no longer exist and fall into repeated guest signup.
- **Evidence:** `return env.databaseUrl ? new PostgresStore(env.databaseUrl) : new InMemoryStore()`.

## 3. Major Functional Bugs

### AUD-P1-01 — Activity controls crash after a successful API call

- **Class:** Confirmed bug. **Severity:** P1.
- **File:** `web/app.js` `performTaskAction` lines 1293–1300; `refreshTasks` lines 1190–1191.
- **Problem:** Pause, Resume, Cancel, and Retry throw after the request succeeds.
- **Why:** Activity cards are built by `renderTaskCard`, whose buttons call `performTaskAction` → `refreshTasks()`. That function always does `el.taskList.innerHTML = ""`. `#task-list` was removed with the metrics view. `el.taskList` is `null`. `refreshActivity()` correctly targets `#activity-task-list` and is not used here.
- **Impact:** The server status changes. The Activity list does not. The console shows `TypeError`.
- **Evidence:** `index.html` has `id="activity-task-list"` only. `getElementById("task-list")` is null.

### AUD-P1-02 — Android never requests runtime permissions

- **Class:** Confirmed bug. **Severity:** P1.
- **File:** `AndroidManifest.xml` (declares `RECORD_AUDIO`, `POST_NOTIFICATIONS`, `READ_CONTACTS`, `CALL_PHONE`); `AndroidPermissionPort.kt` only checks; no `requestPermissions` or Activity Result launcher anywhere under `android/`.
- **Problem:** Dangerous permissions stay denied.
- **Why:** The manifest comment says they are requested when the user taps the mic. No such request exists. Onboarding copy says the same.
- **Impact:** Microphone, reminders (API 33+ notifications), contacts, and phone calls fail closed. Chat over the network still works.
- **Evidence:** Repository search for permission-request APIs in `*.kt` returns only the check in `AndroidPermissionPort`.

### AUD-P1-03 — On-device keyword match swallows normal chat

- **Class:** Confirmed bug. **Severity:** P1.
- **File:** `AndroidOrchestrator.kt` `handleTurn` lines 30–41; `KeywordSkillMatcher.kt` lines 19–31; skill capability lists in `PhoneOpenAppSkillFactory.kt` (`"open"`), `PhoneCallSkillFactory.kt` (`"phone"`, `"call"`), `PhoneFindContactSkillFactory.kt` (`"number"`, `"contact"`), `ReminderSkillFactory.kt` (`"remind"`).
- **Problem:** If the utterance contains any capability substring, the turn never reaches the backend.
- **Why:** Matching is `utterance.contains(capability)` and the highest score wins, before `api.runTurn`.
- **Impact:** Phrases such as “open this topic”, “what’s my account number”, or “call it a day” become a local phone/reminder action and fail or do the wrong thing.
- **Evidence:** `onDeviceMatcher.match(utterance)` returns before the remote call whenever `score > 0`.

### AUD-P1-04 — Android has no conversation memory

- **Class:** Confirmed bug. **Severity:** P1.
- **File:** `android/.../dto/Dtos.kt` `OrchestratorTurnRequest`; `AndroidOrchestrator.kt` lines 44–58. Backend `TurnResult.conversationId` in `orchestrator.ts` lines 26–29 and 54–61.
- **Problem:** Every Android turn is a new server conversation.
- **Why:** The client never sends or stores `conversationId`, `history`, `userName`, or `isFirstTurn`. The response field is not in the DTO.
- **Impact:** Follow-up questions do not see prior turns. The confirmation retry (`confirmed: true`) is also a new conversation, so the model must choose the tool again from the utterance alone.
- **Evidence:** `api.runTurn(OrchestratorTurnRequest(utterance, locale))` only.

### AUD-P1-05 — A TTS failure replaces a good Android reply

- **Class:** Confirmed bug. **Severity:** P1.
- **File:** `ConversationViewModel.kt` `runTurn` lines 116–136.
- **Problem:** After the assistant text is written, `ttsEngine.speak` throwing is caught by the same `catch` as orchestrator failures.
- **Why:** Success UI update and TTS are in one `try`. The catch calls `replaceLastAssistantReply` with `"Something went wrong: …"`.
- **Impact:** The user loses the answer they already received.
- **Evidence:** Lines 116–118 set the real `outcome.message`; lines 127–135 overwrite that same last turn.

### AUD-P1-06 — Clear session / delete account leaves Android without an account id

- **Class:** Confirmed bug. **Severity:** P1.
- **File:** `SettingsViewModel.kt` `clearLocalSession` lines 51–53 and `deleteAccount` lines 55–61; `SessionRepository.kt` `requireAccountId` lines 43–45; `NavGraph.kt` lines 140–144.
- **Problem:** Storage is cleared and the UI goes Home. `ensureSession()` runs only at process start (`AppStartupViewModel`).
- **Why:** Nothing bootstraps a new guest after clear. The next chat calls `requireAccountId()` and throws before the authenticator can heal.
- **Impact:** Chat is broken until the process restarts.
- **Evidence:** `requireAccountId()` errors when `ACCOUNT_ID` is missing. `onSessionCleared` only navigates Home.

### AUD-P1-07 — Web cannot confirm a high-risk action

- **Class:** Confirmed bug. **Severity:** P1.
- **File:** `web/app.js` `runTurn` body (lines 1365–1374) never sends `confirmed`. `renderAssistantResult` (line 1891) is never called. `setupDeveloper` (lines 918–922) returns immediately because the developer inputs are gone. Backend `RequestFlagConfirmationPort` returns true only when `context.confirmed === true`. Only `developer.implement` sets `requiresConfirmation: true`.
- **Problem:** A chat request to implement a repository always ends as `confirmation_declined`. There is no confirm control and no retry.
- **Why:** Android shows a dialog and retries with `confirmed: true`. The web developer screen that called `POST /developer/implement` with `confirmed: true` was removed from the DOM on purpose. Chat was not given the replacement.
- **Impact:** The home card still offers “implement changes through the protected developer workflow.” On the public web that path cannot finish. Direct `POST /api/v1/developer/implement` still works for any PRO caller who sets `confirmed: true` (see AUD-P0-02 and AUD-P1-10).
- **Evidence:** Turn JSON keys are `utterance`, `locale`, `userName`, `isFirstTurn`, `conversationId`, `history`.

### AUD-P1-08 — Credits can go negative under concurrency

- **Class:** Confirmed bug. **Severity:** P1.
- **File:** `backend/src/tooling/toolPipeline.ts` lines 50–84; `postgresStore.ts` `recordUsage` lines 238–249; `inMemoryStore.ts` lines 118–122.
- **Problem:** Balance is checked, then the skill runs, then the balance is decremented with no `WHERE balance >= cost`.
- **Why:** Two overlapping turns can both pass `resolveEntitlement` and both charge.
- **Impact:** Trial/PRO credit limits can be exceeded. The in-memory store subtracts the same way.
- **Evidence:** `UPDATE credit_balances SET balance = balance - $4 WHERE account_id = $2`.

### AUD-P1-09 — Purchase tokens are not single-use

- **Class:** Confirmed bug. **Severity:** P1.
- **File:** `backend/src/api/routes/billing.ts` lines 38–44.
- **Problem:** A verified token upgrades the caller and is not recorded.
- **Why:** There is no ledger of `purchaseToken` or `orderId`. The real Google verifier checks payment state and expiry, then the route still only updates the plan.
- **Impact:** One real purchase can be replayed onto many accounts. The mock path (AUD-P0-02) makes this trivial.
- **Evidence:** After `verification.valid`, the only write is `updateAccountPlan`.

### AUD-P1-10 — One GitHub token acts for every user

- **Class:** Confirmed bug. **Severity:** P1.
- **File:** `backend/src/skills/index.ts` lines 51–53; `developerImplement.ts` lines 60–67; `githubClient.ts` `createImplementationBranch` / `applyImplementationFiles` / `createPullRequest`.
- **Problem:** `GITHUB_TOKEN` is a process-wide credential. The repo URL comes from the user.
- **Why:** Confirmation is a client boolean, not a per-user GitHub OAuth grant. `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are unused.
- **Impact:** Any caller who is PRO and sends `confirmed: true` can open branches and PRs on every repo that token can write. Host is restricted to `github.com`, which blocks SSRF, not this.
- **Evidence:** `new RealGitHubClient(env.githubToken)` is shared. Writes send `Authorization: Bearer` that token.

### AUD-P1-11 — Mic during a turn clears the busy state

- **Class:** Confirmed bug. **Severity:** P1.
- **File:** `web/app.js` `startListening` lines 2089–2094; recognition `end` lines 2057–2060; `isBusy` lines 2004–2007.
- **Problem:** Starting the mic sets the orb to `LISTENING` without cancelling the in-flight turn. When recognition ends on silence, the orb becomes `IDLE` while the request is still running.
- **Why:** `end` sets `IDLE` whenever the state is `LISTENING`. `isBusy()` is derived only from the orb state, so Send stops being Stop.
- **Impact:** The user cannot cancel from the composer. A later result can still abort via `runTurn`, but a no-speech end leaves a hidden in-flight request.
- **Evidence:** `setOrbState("LISTENING")` does not call `cancelCurrentTurn()`. The `end` listener does not check `currentTurnController`.

### AUD-P1-12 — No rate limit, and every guest gets a fresh trial

- **Class:** Confirmed bug. **Severity:** P1.
- **File:** No throttle or helmet usage in `backend/src`. `authService.signup` plus `createAccountForUser` (50 credits, 14-day trial). Web `createGuestSession` and Android `SessionRepository.ensureSession` / `TokenAuthenticator` mint a new guest on unrecoverable 401.
- **Problem:** Signup, login, orchestrator, TTS, documents, and billing are unbounded.
- **Why:** Clearing storage or forcing 401 creates another trial. Parallel 401s in `apiFetch` can each call `createGuestSession()`.
- **Impact:** Credential stuffing, Gemini/TTS bill abuse, and unlimited trial credits.
- **Evidence:** Signup has no IP or device cap. Each account insert sets `TRIAL_INCLUDED_CREDITS = 50`.

## 4. Small Bugs & UX Issues

### P2 — Confirmed

**AUD-P2-01 — Settings subpage survives navigation.** `setActiveView` (`app.js` 714–733) never calls `closeSettingsPage()`. Leaving Settings and coming back still shows the inner panel. Tapping Settings again no-ops because `state.activeView === view`. Recovery is only the panel back control.

**AUD-P2-02 — That back control has no visible label.** `index.html` line 244: `<button class="back-btn settings-panel-back" data-settings-back aria-label="Back to Settings"></button>`. It has the shared back-button size and no icon or text. The settings header back button does have an SVG.

**AUD-P2-03 — Plans is missing from the mobile bottom nav.** Sidebar (`index.html` 28–34) includes Plans. Bottom nav (line 383) does not. Mobile users reach Plans only from the home link.

**AUD-P2-04 — `firstTurn` is cleared before success.** `runTurn` lines 1349–1350 set `state.firstTurn = false` before the fetch. A failed or aborted first turn never sends `isFirstTurn: true` again.

**AUD-P2-05 — Skill result widgets are dead.** `done` only renders `data.message`. `renderAssistantResult` is never called, so code/automation/research widgets never appear.

**AUD-P2-06 — Voice picker does not change playback.** `populateVoiceSelect` can show `#voice-select` and store `zarvis.voiceURI`. Spoken replies use Gemini `synthesize-stream` only. `speak()` / `speechSynthesis` are unused. Settings copy implies the picker matters.

**AUD-P2-07 — Image upload collapses every error into “unreadable”.** PDF/DOCX map `unsupported_file_type` and `document_too_long` (`app.js` 1805–1807). The image branch (1750–1753) always shows `unreadableFile`, including oversize, missing Gemini key, and extraction failure.

**AUD-P2-08 — Long documents are cut to 12,000 characters in memory.** The client allows 60,000 characters. `Orchestrator.runTurn` stores the user message with `.slice(0, 12000)` (`orchestrator.ts` line 85). The current model call still sees the full utterance. The next turn’s stored history does not.

**AUD-P2-09 — Gemini failures stay HTTP 500.** `server.ts` lines 114–117. The regex is `/(?:^|\\D)(408|429|…)/`. In a regex literal `\\D` is a backslash plus `D`, not “non-digit”. Checked in Node: `"Gemini generateContent failed: 503 Service Unavailable"` does not match. `code` becomes `ai_service_unavailable` but `status` stays 500, so `retryable` is omitted. `ETIMEDOUT` still matches.

**AUD-P2-10 — Signup validation is returned as 401.** `auth.ts` `handleAuthError` lines 53–56. Short password, bad email, and duplicate email are all 401 `AuthError`. Duplicate signup tells the client the email exists.

**AUD-P2-11 — `phone.call` requires contacts even for a raw number.** `PhoneCallSkillFactory.kt` line 29 lists `PHONE_CALL` and `CONTACTS`. The handler can dial a number without lookup, but the pipeline denies the skill before the handler if contacts are not granted.

**AUD-P2-12 — Fired reminders stay incomplete.** `ReminderAlarmReceiver` posts a notification and does not mark the Room row complete. `BootRescheduleReceiver` will schedule past-due incomplete rows again.

**AUD-P2-13 — Android analyze crashes the parser on failure outcomes.** `DeveloperAnalyzeResult` requires `summary` and `output.structure`. An `execution_failed` body is `{ kind, reason, userMessage }` inside `result`. kotlinx.serialization throws. The screen shows a generic error.

**AUD-P2-14 — Android locale setting is unused for voice and turns.** `ConversationViewModel` listens and speaks with `"en-IN"`. `handleTurn` defaults locale to `"en"`. Settings `en`/`hi` is not passed. Settings still says there is an Android TTS fallback; `AndroidTextToSpeechEngine` says there is none.

**AUD-P2-15 — Remote Postgres disables certificate verification.** `postgresStore.ts` `poolConfigFor` sets `ssl: { rejectUnauthorized: false }` for non-local URLs.

**AUD-P2-16 — Refresh tokens cannot be revoked.** `authService.refresh` re-signs if the user row exists. There is no token table, rotation blacklist, or logout. A stolen refresh token works for 30 days. Account delete removes the user, so refresh fails after delete. An access token still works until it expires because `requireAuth` does not load the account (up to 1 hour).

**AUD-P2-17 — “Streaming” chat waits for the full model reply.** `orchestrator.ts` route `/turn-stream` awaits `runTurn`, then writes SSE chunks with 12ms gaps. `GeminiProvider.streamGenerate` is unused. Time-to-first-token equals full generation time. The web client is written for real deltas, so this is a latency bug, not a parse mismatch.

**AUD-P2-18 — Default display name is a real person’s name.** `app.js` sets `zarvis.userName` to `"Jitendra Kumar"` when unset and sends it on every turn. The backend treats it as a display name, not an auth claim. Every new browser is personalized as that name until changed.

**AUD-P2-19 — Workflow steps never run.** `automation.create_workflow` inserts PENDING steps. `TaskService` only changes status. The Activity header says “Live task activity.” Pause/Resume do not execute work. The skill comment discloses this; the UI does not.

### P2 — Likely

**AUD-P2-20 — A bad SSE `data:` line aborts the turn.** `processBuffer` (`app.js` 1512, 1520) calls `JSON.parse` with no try/catch. One malformed event hits the generic error bubble.

**AUD-P2-21 — Parallel 401s mint multiple guests.** `apiFetch` (lines 439–447) has no single-flight lock around refresh and `createGuestSession`.

**AUD-P2-22 — Implement can leave an orphan branch.** `developerImplement.ts` creates the branch, then writes files, then opens the PR. A failure after the branch exists is not rolled back. The PR body uses `\\n` inside a template string, so GitHub shows the two characters `\` and `n` instead of newlines (that part is confirmed, P3 below).

### P3 — Confirmed

**AUD-P3-01 —** PR description newlines are double-escaped (`developerImplement.ts` line 66).

**AUD-P3-02 —** `githubClient.ts` line 107 uses `.replace(/\\s/g, "")`, which matches a literal `\s`, not whitespace. Node’s base64 decoder already ignores whitespace, so decode still works.

**AUD-P3-03 —** Unknown task ids on action routes return 409 `TaskError`, not 404.

**AUD-P3-04 —** Metrics and developer DOM ids are still queried (`view-metrics`, `task-list`, `developer-*`, `settings-btn`, and others). Most uses are optional. `refreshTasks` is the exception (AUD-P1-01).

**AUD-P3-05 —** `api/routes/voice.js` and `web/hooks/useVoiceAssistant.ts` (`POST /api/voice`) are unwired. That path 404s. Live app does not call it.

**AUD-P3-06 —** Confirm modal has no Escape handler, focus trap, or focus restore (`showConfirmModal`).

**AUD-P3-07 —** Both navs use `aria-label="Main"`. Several labels are 8.5–10px. `theme-color` is `#f4f7ff` while the manifest is `#0a0b12`. Mic and Send rely on `title`, not `aria-label`.

**AUD-P3-08 —** Dead call graph in `app.js`: `speak`, `speakWithGemini`, `attachWaveform`, `detectSpeechLanguage`, `renderAssistantResult`. `stopSpeaking()` aborts `activeTtsController`, but `speakGeminiStream` passes the turn signal to `fetch`, not that controller. Composer Stop also aborts the turn signal, so the shipped Stop button does cancel the stream. A waveform Stop would not, and that button is only attached from unused `speak()`.

## 5. Security Audit

### Confirmed

| ID | Issue |
|---|---|
| AUD-P0-01 | Task IDOR on get/pause/resume/cancel/retry |
| AUD-P0-02 | Mock Play verifier fail-open by default |
| AUD-P1-09 | Purchase token / order id not consumed |
| AUD-P1-10 | Shared `GITHUB_TOKEN` confused deputy |
| AUD-P1-12 | Unlimited guest trials and no rate limit |
| AUD-P2-10 | Signup email enumeration via 401 text |
| AUD-P2-15 | Postgres TLS verification disabled for remote hosts |
| AUD-P2-16 | Refresh tokens not revocable; access JWT valid after delete until expiry |
| AUD-P1-08 | Credit check/charge race |

Gemini and search put the API key in the query string (`geminiProvider.ts` line 44, `documents.ts` line 66, `webSearch.ts` line 26). TTS correctly uses `x-goog-api-key`. Proxy logs can capture the key. Passwords are scrypt with a random salt and `timingSafeEqual`. JWTs are HS256. Production refuses to start without `JWT_SECRET`. CORS is an allowlist, not `*`. SQL uses bound parameters. GitHub repo URLs are limited to `github.com`. Logs pass through `redact.ts`, but the Gemini error string includes the upstream body before the client response is sanitized. `scryptSync` on the login path can block the event loop.

No committed live API keys were found. Root `.gitignore` does not list `.env`; `backend/.gitignore` does.

### Potential

- Client-supplied `confirmed: true` is enough for any PRO user. That is an honor-system gate, not a second factor.
- `userName` is copied into the system prompt (capped at 60 characters). It is not an authorization claim.
- Image-analysis logs keep 200 characters of the Gemini error string.
- Guest passwords are random and never stored. Recovery is refresh-token-only. That matches the current guest design and is still a lockout if the token is cleared.
- Android `CALL_PHONE` is powerful once a future permission prompt grants it. The keyword matcher can select `phone.call` without a precise command.

## 6. Frontend ↔ Backend Contract Audit

| Client action | Call | Backend | Result |
|---|---|---|---|
| Web chat | `POST /api/v1/orchestrator/turn-stream` with `utterance`, `locale`, `userName`, `isFirstTurn`, `conversationId`, `history` | Same fields. SSE `meta` / `delta` / `done` | Match. `toolCalls` ignored by the UI (AUD-P2-05). `confirmed` never sent (AUD-P1-07). |
| Android chat | `POST /api/v1/orchestrator/turn` with `utterance`, optional `confirmed`, `locale` | Also accepts `conversationId`, `history`, `userName`, `isFirstTurn` | Works. Memory fields omitted (AUD-P1-04). |
| Web/Android skills | `GET /api/v1/skills` | `{ skills: [...] }` | Match. |
| Entitlements | `GET /api/v1/entitlements/me` | `accountId`, `plan`, `trialExpiresAt`, `creditBalance` | Match. |
| Tasks list | `GET /api/v1/tasks` | `{ tasks }` | Match. |
| Task action | `POST /api/v1/tasks/:id/:action` | 200 task or 409 | HTTP match. Web refresh crashes (AUD-P1-01). No ownership check (AUD-P0-01). |
| Documents | `POST /api/v1/documents/extract` field `file` | `{ text }` or `{ text, kind: "image" }` | Match. Image error codes not mapped (AUD-P2-07). |
| Web TTS | `POST /tts/synthesize-stream` `{ text }` → PCM | `audio/l16` 24 kHz, text capped at 1200 | Match. |
| Android TTS | `POST /tts/synthesize` `{ text }` → WAV | Capped at 2000 | Match. |
| Delete account | `DELETE /api/v1/account` → 204 | Cascades user, tasks, conversations | Match. Android does not re-bootstrap (AUD-P1-06). |
| Developer analyze | `POST /developer/analyze` `{ repoUrl }` | Full `ToolExecutionOutcome` | Android DTO only fits `success` (AUD-P2-13). Web analyze UI is unwired. |
| Developer implement | `POST /developer/implement` | Requires `confirmed: true` | Web helper exists and is not reachable. Chat cannot confirm. |
| Billing | `POST /billing/webhook` | Neither client calls it | Upgrade UI is explicitly “coming soon”. The route is still callable (AUD-P0-02). |
| On-device charge | Android `POST /usage/charge` | 400 unless `executesOnDevice` | No backend skill sets that flag, so the route rejects catalogue skills. |
| Voice hook | `POST /api/voice` | Not mounted | 404. Live app does not call it. |
| Auth errors | Clients treat non-OK signup as failure | Validation uses 401, not 400/409 | Status mismatch (AUD-P2-10). Token field names match. |

## 7. Voice / STT / TTS Audit

Web STT is one-shot (`continuous: false`), `hi-IN` or `en-US`, started only by the orb or mic. A voice turn forces spoken replies on. Recognition `error` always sets the orb to `IDLE`, including if a turn is still running. The SPEAKING guard drops a transcript so the mic does not hear the speaker; it does not stop an in-flight turn (AUD-P1-11).

Web TTS schedules 24 kHz PCM into one `AudioContext`, with a 2.3s prime and up to two concurrent segment fetches. Odd-byte chunks are carried to the next read, which is the right way to keep Int16 alignment. Composer Stop aborts the turn `AbortSignal`, which aborts those fetches. `stopSpeaking()` alone aborts a different controller than the one passed to `fetch` (AUD-P3-08). Browser `speechSynthesis` is not a fallback, despite older docs.

Android STT/TTS ignore the language setting and always use `en-IN` (AUD-P2-14). There is no on-device TTS fallback. A speak failure deletes the text answer (AUD-P1-05). Mic permission is never requested (AUD-P1-02).

`/turn-stream` is not model streaming (AUD-P2-17), so speech cannot start until the full reply exists, then the client chunks it again for TTS.

## 8. AI / Gemini / Orchestrator Audit

The loop is real: tools, pipeline, tool results back into the model, hard stop at 5 steps. Greetings and a few “who made you / what is Zarvis” patterns return canned text and do not call the model. That path is provider-independent and does not spend credits.

`developer.analyze_repo` is filtered out unless the current utterance has a GitHub URL or both a repo noun and an analysis verb. That prevents a follow-up like “any errors?” from re-running analysis. It also means vague implement requests may never see the analyze tool.

Tool rows are not stored. The next turn sees user and assistant text only. Assistant text is the model’s final message, or `explainOutcome` if the model returns an empty message. Confirmation denial becomes “please confirm” with no web button (AUD-P1-07).

Gemini retries 408/429/500/502/503/504, then `gemini-3.8-flash`. The API key is in the URL. Image analysis uses the same pattern and can log upstream error text. `gemini-2.5-flash` is remapped to `gemini-3.6-flash`. Mock provider and mock search are used when the key is missing; TTS routes then return 503. Docs that still describe a browser or Android TTS fallback are wrong.

Entitlement rank is `FREE < TRIAL < PLUS < PRO < BUSINESS < ENTERPRISE`. Trial users can run every current skill except `developer.implement`. Credits are not reserved before the model call (AUD-P1-08).

## 9. File & Image Analysis Audit

Limits match on purpose: 4MB upload, 60,000 extracted characters, Vercel’s body ceiling called out in comments. Multer `LIMIT_FILE_SIZE` returns 400 `file_too_large`. Over-long extracted text returns 413 `document_too_long`. Empty text returns 422. Unsupported non-images return 415. The documents router is lazy-imported; a missing parser dependency returns 503 and does not kill `/health`.

Images (`png`, `jpeg`, `webp`, `heic`, `heif`) go to Gemini, not a local OCR parser. Without `GEMINI_API_KEY` the client still gets 422 `extraction_failed`. The web image branch does not distinguish that from a corrupt file (AUD-P2-07). HEIC depends on Gemini accepting that MIME type.

Plain text is not uploaded. It is inlined into the next utterance. Persistence keeps 12,000 characters (AUD-P2-08). The bubble shows the filename, not the file body. Android has no upload path.

## 10. Developer Agent / GitHub Audit

Analyze (`developer.analyze_repo`) is free, 3 credits, read-only, and available to trial users through chat when the utterance matches `shouldAnalyzeRepository`. The Android Developer screen calls `POST /developer/analyze` and mis-parses failures (AUD-P2-13).

Implement is PRO, 10 credits, confirmation required. It asks the model for JSON, keeps at most 6 text files, rejects `..`, absolute paths, `node_modules`, binaries, and payloads over 60,000 bytes, then commits and opens a PR. It does not merge. File content is generated by the model and pushed with the server token (AUD-P1-10). There is no per-user GitHub identity. A mid-flight failure can leave a branch (AUD-P2-22). The public web has no screen that completes confirmation (AUD-P1-07). Home copy still describes that workflow.

`GITHUB_APP_*` is unused. Public unauthenticated GitHub access still works for public analyze when `GITHUB_TOKEN` is unset. Writes throw if the token is missing.

## 11. Mobile & Responsive UI Audit

The web shell uses a bottom nav under 1024px and a sidebar above it. Plans is desktop-only in the nav (AUD-P2-03). `body` is `position: fixed; overflow: hidden`, so the document itself does not scroll; long pages scroll inside `.views`. Send’s text label is hidden at ≤420px; the control keeps a `title`.

Settings back is easy to miss (AUD-P2-02). Duplicate “Main” landmarks and sub-12px type are in section 4. `prefers-reduced-motion` is handled. Gradient-clipped titles can disappear in forced-colors mode.

Android navigation includes Home, conversation, tasks, developer, subscription, and settings. `Routes.METRICS` is registered and not linked from the main tabs. Subscription purchase is a stated “coming soon” stub: no BillingClient and no call to `/billing/webhook`. Task lists can double-apply bottom padding (scaffold plus screen). That last item is a likely layout issue, not remeasured on a device in this pass.

## 12. Performance Audit

- Orchestrator work is fully blocking before any SSE byte (AUD-P2-17). Up to 5 sequential Gemini calls per turn, each with up to 3 attempts and a 90s timeout.
- TTS can hold two segment requests plus a 1.2s PCM preroll. That is reasonable. The 2.3s text prime delays the first spoken word.
- `scryptSync` on signup/login blocks the Node thread.
- Credit and billing writes are not transactional with the work they authorize.
- Document extraction holds the file in memory (multer memory storage, 4MB).
- Service worker is network-first for the shell and does not intercept `/api/*` or `/health`. That part is correct. `cache.addAll` fails the whole install if any shell URL 404s. Icons exist in `web/icons/`.
- Android release minify is off.

## 13. Build & Deployment Audit

- Vercel and the local server share one Express app. Static files are mapped in `vercel.json`. SPA fallback can mask a missing asset as `index.html`.
- No `maxDuration` is set. A long Gemini or document call can hit the platform limit and surface as a generic failure.
- Root `package.json` exists so the Vercel Node builder can resolve `api/index.ts`. It can drift from `backend/package.json`. Backend requires Node `>= 22`. The root package does not set `engines`.
- `JWT_SECRET` missing in production throws during container init. `api/index.ts` catches that and serves a fallback 500. Missing database URL does not throw (AUD-P0-03).
- CI (`.github/workflows/android-build.yml`) builds the Android debug and unsigned release APKs, typechecks the backend, and runs `node --check web/app.js` plus a local `/health` probe. It does not run `npm test`. Backend regressions can merge green.
- `DEVELOPMENT.md` still says CI is not configured. `HANDOFF.md` and the workflow disagree. Several docs still describe browser or Android TTS fallback. `SKILLS.md` / `MASTER_SPEC.md` test counts do not match `HANDOFF.md`.
- Release APKs in CI are unsigned by design.
- `PRIVACY.md` describes memory controls. Delete account is real. Export and “clear all memory” as a separate product control are not a distinct API beyond delete and clear-session.

## 14. Dead / Duplicate / Suspicious Code

Do not delete these until a later change explicitly removes them.

- `web/app.js` metrics and developer element cache, `refreshTasks`, `setupDeveloper`, `implementRepo`, `analyzeRepo`, `speak`, `speakWithGemini`, `attachWaveform`, `renderAssistantResult`, `detectSpeechLanguage`.
- `web/hooks/useVoiceAssistant.ts` and `api/routes/voice.js` (CommonJS, unmounted).
- Android `ZarvisApi.login`, Retrofit `refresh`, and `createTask` have no callers.
- `Routes.METRICS` is registered and not linked from primary navigation.
- Env vars loaded and unused: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`.
- `GeminiProvider.streamGenerate` is unused by the HTTP route that claims to stream.
- `POST /api/v1/usage/charge` rejects every current backend skill because none set `executesOnDevice: true`.

## 15. Recommended Fix Order

1. **Critical.** Enforce `task.accountId === auth.accountId` on every task id route. Refuse billing, or refuse to boot, when Play verification is not the real verifier. Require Postgres in production and fail startup if it is missing.
2. **Startup/runtime.** Keep the JWT production guard. Add a single-flight guest bootstrap. Stop using `scryptSync` on the request thread once the auth path is touched.
3. **Backend/API contracts.** Atomic credit debit. Persist and reject reused purchase tokens. Map auth validation to 400/409 without changing the invalid-login message. Fix the error-middleware status regex so Gemini 503/429 become 503. Return 404 for unknown tasks.
4. **Voice/AI.** Point Activity buttons at `refreshActivity`. Abort TTS with the same signal the fetch uses. Do not set `LISTENING` over an in-flight turn unless that turn is cancelled. On Android, request permissions, stop keyword matches from hijacking ordinary sentences, round-trip `conversationId`, and do not replace a successful reply when TTS throws. Re-run `ensureSession` after clear/delete.
5. **File/image.** Map image error codes the same way as PDF. Decide whether follow-up turns keep the extracted document (the 12,000-character store cap).
6. **Navigation/state.** Close settings panels in `setActiveView`. Put a visible back icon on the panel back button. Add Plans to the bottom nav or an equivalent mobile entry.
7. **UI/UX.** Web confirmation dialog for `confirmation_declined`, then retry with `confirmed: true`. Wire or stop advertising developer implement. Make the voice picker match Gemini or hide it. Replace the hardcoded default name. Say in Activity that workflows are tracked, not executed, until a runner exists.
8. **Cleanup.** Remove or isolate dead metrics/developer/voice-hook code only after the live paths above work. Move GitHub writes to per-user credentials. Revoke refresh tokens. Turn certificate verification back on for Postgres. Run backend tests in CI. Set a Vercel function duration. Update docs that still describe TTS fallback and “no CI”.

## 16. Final Audit Statistics

| Metric | Count |
|---|---|
| Files in the git tree | 257 |
| Areas line-reviewed | Web client, backend API/orchestrator/skills/auth/billing/store, Android app/data/domain/agents, Vercel entry, CI, root docs |
| Confirmed bugs | 43 |
| Likely bugs | 3 (AUD-P2-20, AUD-P2-21, AUD-P2-22) |
| Potential risks | 6 (Gemini key in query logs, `confirmed` honor system, `userName` in the prompt, image error logging, guest password not stored, `CALL_PHONE` once granted) |
| P0 | 3 |
| P1 | 12 |
| P2 | 22 (19 confirmed, 3 likely) |
| P3 | 8 |
| Security findings | 9 confirmed, plus the 6 potential risks above |
| Build/deployment findings | 6 (in-memory serverless default, no function timeout, package/engine drift, CI does not run backend tests, unsigned release artifacts, stale CI/TTS docs) |

Audit only. Product source was not modified when this report was written.
