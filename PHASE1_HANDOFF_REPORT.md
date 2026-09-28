# ZARVIS — Phase 1 Handoff Report

Branch: `claude/laughing-shannon-m3zu32` · PR: jitendrakumarraj831-byte/ZarvisMobile#78 (draft)
Source of truth: `ZARVIS_MASTER_PRODUCT_BLUEPRINT.md` §10–§12 and §13 "Phase 1". Starting point: `DEEP_SCAN_REPORT.md`.

## Verdict: **FAIL — Phase 1 is NOT complete. Do not start Phase 2.**

The blueprint (§11) says each Android capability must be **implemented *and verified***. The code
foundation is in place and passes every automated check. But Phase 1 cannot pass for three reasons:

1. **No real-device verification has been done.** It could not be done from this environment:
   there was no Android device, no emulator, and no Android SDK download (dl.google.com is
   blocked). Every Android capability therefore stays `PARTIAL`, and nothing is marked `WORKING`.
2. **Six registry capabilities are not implemented at all** and are honestly `PLANNED`:
   `notification_read`, `notification_speak`, `accessibility`, `usage_stats`,
   `default_assistant`, `screen_interaction`. This also means the §12 Notification Privacy
   modes don't exist yet.
3. **Live integrations are unverified here:** Gemini and TTS with a real key, real GitHub
   write access, and Play Billing.

What *is* true: every Critical/High item from the deep scan is fixed and covered by tests. The
Phase 1 foundation below is built:

- capability registry;
- permission intelligence;
- risk/action policy;
- server-issued single-action confirmations;
- structured results;
- revocation detection and process-death recovery;
- account continuity.

It is verified on the backend, on Web (real browser), and in Android JVM tests and builds.

---

## 1. Critical / High issues from the deep scan — fixed

| Issue | Fix | Verified by |
|---|---|---|
| ToolPipeline: a throwing skill crashed the turn (500) | Handler and `prepare` run in try/catch. `SkillUserError` passes through its safe message; any other error returns a generic `handler_error`. Same on Android. | `backend/test/tooling/toolPipeline.test.ts`, Android `ToolPipelineTest` |
| Silent account replacement when refresh failed | Only a server `session_invalid` / `session_revoked` / `refresh_token_reused` code ends a session. Network, 5xx and captive-portal failures keep the same account. An ended session shows a sign-in / "new guest" choice and never auto-creates an account (Web and Android). | Web E2E steps 8–10; Android `TokenAuthenticatorTest` and `SessionRepositoryTest` (CI); backend `phase1Security` |
| Auth / account continuity | Server-side sessions (`auth_sessions`); rotating refresh tokens with reuse detection that revokes the session; server-side logout; guest → email linking; the same account on other devices. | `phase1Security.test.ts` (in-memory + Postgres); Web E2E steps 6–7 |
| GitHub Developer Agent used a shared server token (any user could write anywhere) | Each account uses its own GitHub token (AES-256-GCM encrypted, never returned). Implement requires GitHub-reported `permissions.push` on that repo, checked *before* a confirmation is issued. There is no server token. | `phase1Security` "per-user GitHub authorization"; Web E2E steps 11–12 (0 writes) |
| Client-controlled `confirmed: true` flag | Server-issued confirmations: bound to the account, the skill, the input hash, and (new in the regression scan) the exact approved action text. Single use, 10-minute expiry, atomic PENDING→APPROVED/DECLINED. Clients cannot skip them. | `toolPipeline.test.ts` confirmation suite; `phase1Security` confirmations (replay, other account, expiry, identity change) |
| Android 8–12 notification / reminder crash path | `POST_NOTIFICATIONS` is treated as a runtime permission only on API ≥ 33. Below that, `areNotificationsEnabled()` is the real state and Settings is the destination. | Android `AccessCoordinatorTest`; CI debug + release builds. **Not run on an API 26–32 device.** |
| 8 failing backend tests | Root causes fixed: tests no longer hit live GitHub; Hindi regex; model drift; TTS 4xx retry; image 503. | 219/219 |
| TTS / audio | Correct Gemini `prebuiltVoiceConfig` request shape and PCM→WAV wrapping. 404 falls back to the next model; 4xx stops. Web plays segments strictly in order; "Speaking" only shows while audio actually plays. Android `onPlaybackStarted` drives SPEAKING; auto-speak is off by default. | `geminiTts.test.ts`; `web/tests/logic.test.js` (ordered segments). **No live-key playback test.** |
| Postgres TLS verification disabled | Verification is on by default. `POSTGRES_CA_CERT` supported; `POSTGRES_SSL_MODE=no-verify` is an explicit opt-out. | `postgresTls.test.ts` |
| Missing security headers / CSP | Strict CSP plus nosniff, frame, referrer and permissions policies (server and `vercel.json`). | `phase1Security`; Web E2E "no CSP violations" |

## 2. Implemented Phase 1 features

**Capability Registry (§10):**
- All 16 capabilities, each with every §10 field: required access, API requirements, risk, data
  exposure, supported/unsupported actions, confirmation, denial behavior, fallback, revocation
  handling, settings destination, and rationale text.
- Authored once in `backend/src/capabilities/registry.ts` and exported to
  `shared/capability-registry.json`.
- Consumed by the backend (`GET /api/v1/capabilities`), Web, and Android (classpath resource).
- Parity tests run on both sides, and CI fails if the exported JSON drifts.

**Risk and action policy:**
- Risk levels are LOW / MEDIUM / HIGH / VERY_HIGH.
- The action classes EXTERNAL_COMMUNICATION, FINANCIAL, DESTRUCTIVE and SECURITY_SENSITIVE, or
  risk ≥ HIGH, always require per-action confirmation.
- Policy can only *add* a confirmation requirement.
- Permission ≠ authorization: e.g. contacts permission alone never sends; a phone call always
  confirms the resolved number.

**Permission Intelligence (Android domain `AccessCoordinator`):**
- Flow: rationale (why / what data / what is not automatic / how to revoke) → **Allow / Not Now /
  Learn More** → system dialog or exact Settings destination → **re-reads the real Android state**.
  A stored flag is never trusted.
- States: GRANTED, NOT_REQUESTED, DENIED, PERMANENTLY_DENIED, SYSTEM_DISABLED, NOT_REQUIRED.

**Permission Center:**
- Android: Settings → Permissions shows live state per capability and refreshes on resume.
- Web: the "Permissions & Device Access" page is driven by the same registry, with live browser
  microphone state.

**Revocation detection:**
- `RevocationDetector` compares a snapshot on every resume and shows a banner.
- The permission is re-checked after confirmation, immediately before execution.

**Process-death recovery:**
- `PendingActionStore` (DataStore): an interrupted action is *offered* for resume through the
  full flow, never auto-run. It expires after 30 minutes.
- The conversation is restored from server-persisted history (Web and Android).

**Structured tool results:**
- Fields: `success, status, capabilityId, skillId, userSafeMessage, retryable, verificationEvidence`.
- The seven blueprint statuses, on Android (`ToolResults`) and backend (`toStructuredResult`),
  shown in the Web and Android UI.

**Android device skills, all through the ToolPipeline:**

| Area | Skills / behavior |
|---|---|
| Reminders | English/Hindi/Hinglish time parsing; asks for a time if none was given |
| Contacts | Contact lookup |
| Calls | Confirmed call to a resolved number |
| Files, photos, camera | Document picker, photo picker, camera capture |
| Location | Coarse location |
| Settings flows | Bluetooth and system settings |
| Alarms, calendar | Alarm via the Clock app, calendar insert (both USER_ACTION_REQUIRED) |

**Shared Brain integration:**
- A backend action needing confirmation returns a server confirmation.
- Android and Web show the exact action and approve/decline *that id*. If the action changed
  before running (e.g. a different GitHub identity), a new confirmation is issued and nothing runs.

**Web UI:**
- Session gate; account panel (link / sign in / sign out).
- Permission Center and confirmation cards.
- GitHub connect/disconnect; real SSE progress.

## 3. Capability status (truthful; nothing is `WORKING`)

| Capability | Risk | Confirmation | Android | Web | Note |
|---|---|---|---|---|---|
| `microphone` | MEDIUM | NONE | PARTIAL | PARTIAL | SpeechRecognizer after a tap; not device-verified |
| `contacts` | MEDIUM | NONE | PARTIAL | UNSUPPORTED | ContactsContract lookup; not device-verified |
| `phone_call` | HIGH | PER_ACTION | PARTIAL | UNSUPPORTED | ACTION_CALL after confirming the resolved number; not device-verified |
| `notification_read` | HIGH | PER_ACTION | PLANNED | UNSUPPORTED | No NotificationListenerService |
| `notification_speak` | MEDIUM | NONE | PLANNED | UNSUPPORTED | Not implemented; §12 privacy modes absent |
| `camera` | MEDIUM | NONE | PARTIAL | PLANNED | System capture preview only |
| `files` | MEDIUM | NONE | PARTIAL | PARTIAL | Document picker, metadata only |
| `photos` | MEDIUM | NONE | PARTIAL | PARTIAL | Photo picker, metadata only |
| `location` | MEDIUM | NONE | PARTIAL | PLANNED | Coarse, on request |
| `bluetooth` | MEDIUM | NONE | PARTIAL | UNSUPPORTED | Settings flow only |
| `alarms` | LOW | NONE | PARTIAL | UNSUPPORTED | AlarmManager reminders + Clock app |
| `calendar` | MEDIUM | NONE | PARTIAL | PLANNED | Pre-filled insert flow |
| `accessibility` | VERY_HIGH | PER_ACTION | PLANNED | UNSUPPORTED | No accessibility service |
| `usage_stats` | HIGH | PER_ACTION | PLANNED | UNSUPPORTED | Not declared |
| `default_assistant` | HIGH | PER_ACTION | PLANNED | UNSUPPORTED | No VoiceInteractionService |
| `screen_interaction` | VERY_HIGH | PER_ACTION | PLANNED | UNSUPPORTED | Not implemented |

## 4. Verification results (this session)

| # | Check | Result |
|---|---|---|
| 1 | Backend tests (in-memory + real Postgres 16) | **219 / 219 pass**, locally and in CI |
| 2 | Typechecks (backend `tsc`, root/Vercel `tsc`) | clean |
| 3 | Web checks: `node --check`, logic unit tests, **Playwright E2E in Chromium against the real backend + Postgres + GitHub API stub** | 6/6 unit, **14/14 E2E**, no console/CSP errors, no horizontal overflow at 390 px. Also in CI (`web-e2e` job) |
| 4 | Android: `:domain` JVM tests | **91 / 91** (local + CI) |
| 4b | Android: `:data:data-remote` + `:data:data-repository` JVM tests (real OkHttp/Retrofit vs MockWebServer) | pass in CI |
| 4c | Android: `:app:assembleDebug`, `assembleRelease`, `bundleRelease` (all modules compile, manifest assertions) | pass in CI |
| 5 | Security tests | `phase1Security.test.ts`: sessions, rotation/replay, logout, guest/link rules, confirmations (replay, cross-account, expiry, decline, identity change), GitHub authz, encrypted tokens, rate limits, CSP. `postgresTls.test.ts`. |
| 6 | Denial / revoke tests | `AccessCoordinatorTest` (Allow / Not Now / Learn More, deny, permanent deny → Settings, API <33 notifications), `RevocationAndRecoveryTest`, pipeline permission-denied paths, Web E2E sign-out revocation |
| 7 | Failure / lifecycle tests | handler throws, prepare fails, refresh network failure / 5xx / captive portal, token replay, process-death offer/expiry, conversation restore, confirmation expiry |
| 8 | Deep regression scan | **1 High found and fixed:** a confirmation could run as a different GitHub identity if the account was reconnected between confirming and approving. The grant is now bound to the exact action text (§6). Route auth audit: only auth endpoints and the public registry are unauthenticated, by design. |
| 9–10 | Full re-verification after fixes | All rows above re-run green after the last change |

## 5. Real-device status

**Not done — this blocks PASS.** None of these has been run on a real phone or emulator:

- runtime permission dialogs;
- Settings round-trips;
- revocation on resume;
- process-death recovery;
- reminder notifications on API 26–32 and 33+;
- calling, pickers, camera, location, alarms and calendar intents;
- SpeechRecognizer and TTS playback.

Required device matrix: at least one API 26–28 device, one API 31/32 device, and one API 33+
device. Run every capability through Allow, Not Now, Deny, Deny-twice → Settings,
revoke-while-backgrounded, and kill-while-confirming.

## 6. Bugs fixed (beyond the Critical/High table)

**Web:**
- Every chat turn threw in `finally` because the TTS variables were block-scoped.
- The Send button stayed stuck in Stop mode.
- `GEMINI_VOICES` / session-gate temporal-dead-zone errors on load.
- Primary buttons had no fill (CSS order).
- `/feature-pages.js` was served as `index.html` on Vercel.
- A hard-coded personal display name was sent for every user.
- The token drip was simulated; it is now real SSE progress.

**Backend:**
- The mock provider invented repo URLs.
- API keys were sent in URLs; they are now in headers.
- Base64 whitespace regex.
- PR body contained literal `\n`.
- `.github/` paths could be written by the agent.

**Android:**
- Reminders with no time silently defaulted; the app now asks.
- Calls could run without a resolved number.
- The zero-cost skills made an entitlement network call.

## 7. Known limitations

- Real-device verification is missing (§5).
- `notification_read` / `notification_speak` / §12 privacy modes, `accessibility`,
  `usage_stats`, `default_assistant` and `screen_interaction` are `PLANNED`.
- The rate limiter is in-memory per instance; serverless instances do not share limits.
- There are no Android instrumented/UI tests (Compose screens, dialogs, `ActivityBridge`).
  Only domain and data-layer JVM tests exist.
- Gemini, TTS, GitHub and Play Billing are tested against stubs/mocks only. The live paths need
  real credentials.
- Web Permission Center: only the microphone is a browser permission. Other capabilities are
  labelled per the registry (mostly UNSUPPORTED/PLANNED on the web).

## 8. Exact verification commands

```bash
# Backend (needs a local Postgres for the Postgres-backed suites)
cd backend
npm ci
npx tsc --noEmit -p .
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/zarvis_test npx vitest run
npm run capabilities:export && git diff --exit-code ../shared   # registry in sync
cd ..

# Root / Vercel typecheck
npm ci && npx tsc -p tsconfig.json --noEmit

# Web
node --check web/app.js && node --check web/logic.js && node --check web/sw.js
node --test web/tests/*.test.js
# Browser E2E (Playwright + Chromium; real backend + Postgres + GitHub stub)
node web/e2e/github-stub.cjs &
(cd backend && PORT=3100 POSTGRES_URL=postgres://postgres:postgres@localhost:5432/zarvis_e2e \
  CORS_ORIGINS=http://localhost:3100 GITHUB_API_BASE_URL=http://localhost:3200 npx tsx src/index.ts &)
ZARVIS_URL=http://localhost:3100 node web/e2e/phase1.e2e.cjs

# Android (JDK 17; data-layer tests and app builds need the Android SDK)
cd android
./gradlew :domain:test
./gradlew :data:data-remote:testDebugUnitTest :data:data-repository:testDebugUnitTest
./gradlew :app:assembleDebug -Pzarvis.devApiHost=10.0.2.2 :app:assembleRelease :app:bundleRelease
```

CI runs all of the above on every push to the PR: `.github/workflows/backend-tests.yml` (backend,
web, web-e2e) and `.github/workflows/android-build.yml`.

## 9. To reach Phase 1 PASS

1. Run the real-device matrix in §5 and record the evidence per capability. Promote a capability
   to `WORKING` only with that evidence.
2. Implement and verify, or formally re-scope with a blueprint change, the six `PLANNED`
   capabilities and §12 notification privacy.
3. Add Android instrumented tests for the rationale dialog, Permission Center, confirmation
   dialog and the session-expired screen.
4. Verify live TTS/Gemini and a real GitHub PR on a test repo.
