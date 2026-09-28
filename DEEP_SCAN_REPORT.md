# ZARVIS Mobile — Deep-Scan Report

> Scan date: 2026-09-28 · Base commit: `a8b1a35`
>
> Scope: Web + Android + backend, shared Brain, orchestration, ToolPipeline, permissions, auth, voice/TTS, notifications, tasks, memory, APIs, tests and UI.
> Reference: [ZARVIS_MASTER_PRODUCT_BLUEPRINT.md](./ZARVIS_MASTER_PRODUCT_BLUEPRINT.md) (authoritative). This report does not change the blueprint; it records the verified state of the code at the commit above.
>
> Every finding was checked against the actual code. No code was changed as part of this scan.

## Verification commands

| Check | Result |
|---|---|
| Backend tests (`cd backend && npx vitest run`) | **8 failed, 127 passed, 4 skipped** (Postgres tests skip without a database) |
| Backend typecheck (`npx tsc --noEmit`) | Passes |
| Web syntax check (`node --check web/app.js web/feature-pages.js`) | Passes |
| Android domain tests (`./gradlew :domain:test`) | **Not run** — Maven Central returned HTTP 429 while downloading the Kotlin plugin. Android test status is unknown |
| CI (`.github/workflows/android-build.yml`) | Does not run the backend tests, which is why the 8 failures went unnoticed |

---

## 1. Current phase

**Phase 1 — Android Access + Permission Intelligence is the declared gate, and it is FAILING.**

- The Phase 1 foundation is mostly missing:
  - No capability registry.
  - No permission rationale screen (Allow / Not Now / Learn More).
  - No Permission Center, revocation detection or process-death recovery.
  - The structured result statuses (`COMPLETED`, `DENIED`, `PERMISSION_REQUIRED`, …) don't exist.
  - No `VERY_HIGH` risk level.
  - Only 8 `PermissionType` values exist; the blueprint lists 16 capabilities.
- Later phases were partly built early: Phase 2 memory (conversations), Phase 3 voice, Phase 4 research, Phase 6 documents, Phase 7/8 writing and creative skills, Phase 10 tasks, Phase 13 business skills and Phase 20 developer agent (GitHub writes). This breaks blueprint §22 rule 8.
- Documentation drift: several files cite sections that no longer exist (`MASTER_SPEC.md §12a/§25/§32`, `DEVELOPMENT.md "Deploying to Vercel"`); `MASTER_SPEC.md` is now a 24-line stub.

## 2. WORKING (verified in code and tests)

**Backend**
- Auth: signup, login, refresh with scrypt password hashing and HS256 JWTs. Production refuses to start without `JWT_SECRET`.
- Backend ToolPipeline (`backend/src/tooling/toolPipeline.ts`): registry → validation → permission → entitlement → confirmation → execute → non-empty-summary check → charge only after success.
- Credit ledger: atomic Postgres deduction (`UPDATE … WHERE balance >= cost`); single-use purchase tokens.
- Durable, per-account conversations in Postgres; orchestrator loop bounded to 5 steps.
- Cascading account deletion.
- Document extraction (PDF via `unpdf`, DOCX via `mammoth`), tested against real generated files.
- Deterministic skills: `business.draft_invoice` parser; `automation.*` task create/list/cancel.
- CORS allow-list; error responses return safe categories, not raw error text.

**Android**
- On-device ToolPipeline mirroring the backend.
- Real ports for contact lookup, calls (`ACTION_CALL`), app launch, and reminders (Room + AlarmManager + notification + re-arm after reboot).
- Tokens stored in Keystore-backed `EncryptedSharedPreferences`.

## 3. PARTIAL

| Area | Real | Missing |
|---|---|---|
| Shared Brain | Backend orchestrator used by Web and Android | Android keyword-matches phone/reminder commands **before** the Brain (two routing paths). No planner, intent layer, or capability/policy layer |
| Chat | Conversations persisted per account | Android keeps `conversationId` in memory only (lost on process death) and never loads history |
| Web "streaming" | SSE endpoint | Backend builds the **full** reply, then drips chunks every 12 ms (`backend/src/api/routes/orchestrator.ts`) — simulated progress |
| Web search | Gemini grounding returns source URLs | Model receives only titles/URLs, not the grounded answer (`backend/src/skills/webSearch.ts`, via `explainOutcome`) — risk of invented content |
| Voice (Web) | Browser STT + Gemini PCM streaming | See bugs #10, #11 |
| Voice (Android) | `SpeechRecognizer` STT + Gemini TTS | No on-device TTS fallback; replies always spoken although in-app copy says spoken replies are off by default |
| Tasks | Durable records, pause/resume/cancel/retry | **No step executor.** "Resume" sets `RUNNING` with nothing running |
| Developer agent | Read-only analysis; implement opens branch + PR | See S1, S2 |
| Billing | Server Play verifier (fails closed in production) | No Play Billing client on Android; Plans display-only on both platforms |
| Image analysis | Gemini vision in `/documents/extract` | Bypasses ToolPipeline, no credits charged, no third-party disclosure to the user |

## 4. PLANNED (not present in code)

- Phase 1: capability registry, permission explanation screens, Permission Center, revocation handling, structured Android results; camera, photos, files, location, calendar, Bluetooth and system-settings capabilities.
- Explicit remember/forget memory; projects/workspaces (Web "Work" is a page of links).
- A shared login enabling cross-device continuity.
- Notification reading/speaking and notification privacy modes.
- Research citation UI, Study, automation executor, and every agent from Finance onward.
- Integrations Hub, family workspace, data export, sessions/security center.

## 5. Broken or fake functionality

1. **Reminders ignore the time** — always ~1 hour later (`ReminderSkillFactory.kt:61`). `OnDeviceInputBuilder` never passes `dueAt`; title is the whole sentence.
2. **Fake UI states** — Android sets `PLANNING` then `EXECUTING` instantly (`ConversationViewModel.kt:127`); Web shows `SPEAKING` on first text even with speech off (`web/app.js:1817`); metrics record `success = true` for failure replies (`ConversationViewModel.kt:131`).
3. **Mock AI provider invents a repo URL** (`https://github.com/example/demo-repo`).
4. **Hard-coded identity on Web** — every user's display name defaults to "Jitendra Kumar" (`web/app.js:35`) and is sent to the model.
5. **Onboarding promises data export** that doesn't exist (and no memory layer exists).
6. **Broken PR body** — `developer.implement` writes literal `\n` (`developerImplement.ts:66`).
7. **Dead code** — `api/routes/voice.js` (CommonJS in ESM, never mounted), `web/hooks/useVoiceAssistant.ts` (React hook, no React), `preview/jarvis-mobile-ui.html`.
8. **Workflow cancel** matches tasks by goal text only; steps never execute anyway.

## 6. Critical / high-priority bugs

| # | Severity | Bug |
|---|---|---|
| 1 | **Critical** | Skill handler exceptions aren't caught (`toolPipeline.ts:70`); a GitHub 404 or search failure becomes HTTP 500 instead of `execution_failed`. Causes 4 failing tests |
| 2 | **Critical** | Silent account replacement: any refresh failure (network blip, 500) creates a new guest and wipes local state — Android `TokenAuthenticator.kt:79`, Web `app.js:461`. Loses credits, plan, history |
| 3 | **Critical** | No real login on either platform (guest only) → cross-device continuity impossible |
| 4 | High | Reminders fail on Android 8–12: `POST_NOTIFICATIONS` is API 33+, minSdk is 26, check isn't version-gated → always `PermissionDenied` |
| 5 | High | Confirmation not bound to a specific action (see S3) |
| 6 | High | Confirmation dialog shows generic skill description / "ZARVIS wants to perform a higher-risk action", not the actual target or change |
| 7 | High | `AndroidOrchestrator` ignores `permissionBroker.ensure()` result; no rationale, no permanently-denied handling, no Settings deep link |
| 8 | High | Profile question "ZARVIS क्या कर सकता है?" not recognised (test fails) |
| 9 | High | PNG upload goes to Gemini; without a key returns 422 `extraction_failed` instead of honest "not configured" (test fails) |
| 10 | High | Web TTS runs 2 concurrent streams, each with its own copy of the playback timeline → overlapping/garbled audio (`web/app.js` ~2703) |
| 11 | Medium (needs live check) | Gemini TTS uses `voiceConfig.voice`; documented shape is `voiceConfig.prebuiltVoiceConfig.voiceName`. Android plays unary TTS via `MediaPlayer` assuming WAV; fails if raw PCM is returned |
| 12 | Medium | TTS retries next model after a permanent 400 (test fails) |
| 13 | Medium | Test drift (model name 3.7 vs 3.8; catalogue now includes a PRO skill); two tests make live GitHub calls with no way to inject a mock client |
| 14 | Medium | `developer.analyze_repo` exposed to the model whenever "code" + "check" appear |

## 7. Security / permission issues

| # | Severity | Issue |
|---|---|---|
| S1 | **Critical** | Any PRO user can write branches/PRs to any repo the server's single `GITHUB_TOKEN` can reach — no per-user GitHub auth or ownership check |
| S2 | **Critical** | Any user can read private repos via `developer.analyze_repo` using the same token |
| S3 | **Critical** | Confirmation is a client-supplied `confirmed: true` flag (`confirmationPort.ts:13`), not bound to skill/arguments/one-time token; applies to every tool call in the turn; model re-plans after confirm. Web developer screen sends `confirmed: true` directly (`web/app.js:1165`) |
| S4 | High | Postgres TLS certificate verification disabled (`rejectUnauthorized: false`, `postgresStore.ts:530`) |
| S5 | High | No rate limiting (signup, login, turns, TTS, image analysis). Unlimited guest signups each get 50 credits; TTS and image analysis are uncharged |
| S6 | High | 30-day refresh tokens with no rotation tracking, revocation or logout |
| S7 | High | Web stores tokens in `localStorage`; no Content-Security-Policy |
| S8 | Medium | Backend permission gate is inert (`grantPermission` never called; no server skill declares permissions) |
| S9 | Medium | Gemini API key in URL query strings in several places |
| S10 | Medium | Billing endpoint client-called, no Play RTDN, plans never expire |
| S11 | Medium | User utterances kept in Android metrics store and Web latency log |
| S12 | Low | Mock billing verifier accepts any token when `NODE_ENV !== "production"` |

## 8. Missing A→Z UI

**Android:** Permission Center, rationale screens, revoked states; login/account linking; conversation list/history; action details in confirmation dialog; auto-speak toggle; notification privacy settings; Memory/Privacy/Security pages; Play Billing checkout; blueprint "Work" tab.

**Web:** login; conversation list/history on reload; real Work/Projects; research sources/citations panel; persisted Files library; tool-run Activity history; Memory settings; sessions/security; checkout.

**Both:** task states `WAITING`, `CONFIRMATION_REQUIRED`, `VERIFYING`, `BLOCKED`; real planning/verifying states.

## 9. Missing backend / integration pieces

- Capability registry and policy engine; action classes; `VERY_HIGH` risk; structured tool result with `capabilityId` and `verificationEvidence`; server-issued single-action confirmation tokens; real verification (today only "summary not empty").
- Task executor/scheduler, idempotency, dependencies, restart recovery.
- Explicit memory and projects/workspaces APIs.
- Account linking (email/OAuth); per-user GitHub OAuth with scopes and revocation.
- Endpoints: conversation list/history (`listConversations` exists in the store but has no route), usage history, data export.
- Play RTDN and plan expiry.
- Rate limiting; DB migrations (`tasks` table has no FK to accounts and isn't cascade-deleted by the database).

## 10. Missing tests

- Backend tests in CI; fix the 8 current failures.
- Android: nothing beyond the pure-Kotlin domain module (no ViewModel, instrumentation, permission-flow, process-death or revocation tests).
- Security: cross-account access, confirmation replay/scope, GitHub ownership, refresh-token misuse, rate limits.
- Failure handling: skill throws → honest outcome; search/GitHub provider failures.
- Voice: TTS request shape vs Gemini contract; Web audio ordering.
- Reminders: due-time parsing; Android 8–12 notification path.
- Web UI tests (none); Web ↔ Android continuity tests (blocked by lack of shared login); Postgres store tests in CI.

---

## Recommended fix order (before any later-phase work)

1. Catch skill handler errors in both pipelines (#1).
2. Stop silent account replacement on refresh failure (#2).
3. Lock down Developer Agent GitHub access (S1, S2).
4. Bind confirmation to a single server-issued action (S3).
5. Fix reminder due-time parsing and Android 8–12 notifications (#4, broken #1).
6. Run backend tests in CI and fix the 8 failures.

Then implement the Phase 1 capability registry and Permission Center end to end.

**Phase 1 status: FAIL.**
