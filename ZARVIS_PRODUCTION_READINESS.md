# ZARVIS production readiness

- **Date:** 2026-10-02
- **Branch:** `claude/optimistic-lovelace-y9w9q6`, stacked on PR #78 (`claude/laughing-shannon-m3zu32`,
  head `5cc165f`). Nothing was merged. PR #78 was not modified.
- **Verdict: NOT READY.** The automated gates pass. The required physical-device run, live
  email sign-up and a verified live Gemini answer on the preview are still open (§6).

Status values: PASS, FAIL, PARTIAL, NOT TESTED, BLOCKED (cannot be run from where it was
attempted; the reason is given).

## 1. Starting point and the PR #78 decision

| Fact | Evidence |
|---|---|
| `main` (`e010c12`) is 86 commits / +21.9k lines behind PR #78 | `git diff --stat main origin/claude/laughing-shannon-m3zu32`: 234 files |
| Three requested source-of-truth files exist **only** on PR #78: `DEEP_AUDIT_2026-10-02.md`, `FINAL_PHASE1_VERIFICATION.md`, `PHASE1_HANDOFF_REPORT.md`; so do `/shared` and the test suites | `git ls-tree` of both branches |
| PR #78 already fixed most of `DEEP_SCAN_REPORT.md` (written against `main`): server-issued confirmations, refresh rotation, per-user GitHub, capability registry, Permission Center, quota policy, turn cancellation, Android rotation duplicates | its commits and tests |
| PR #78 head: every check green (CI, emulators API 26/30/34, Windows, CodeQL, live smoke) | check runs on `5cc165f` |

**Decision:** work on top of PR #78, not on `main`. Re-fixing `main` would duplicate PR #78
and conflict with it. This branch is a separate draft PR whose base is PR #78's branch, so
merging it changes only PR #78's branch. It does not merge PR #78 into `main`.

## 2. Bugs found and fixed in this pass

Each was reproduced on `5cc165f` before the fix, has a regression test, and the test was shown
to fail without the fix.

| # | Severity | Bug | Root cause | Fix (commit) | Test |
|---|---|---|---|---|---|
| 1 | **High** | Retry of a turn whose stream dropped after the server finished ran it again: `web.search` executed twice, charged twice, user message stored twice | no idempotency key; every POST was a new turn | `clientTurnId`: completed → replayed, running → 409 `turn_in_progress`, failed → re-run in the same conversation (`883c5ee`, web `7bb6f54`) | `test/agents/turnIdempotency.test.ts` (14, both stores); E2E "Retry after a stream cut off…" |
| 2 | Medium | Retry after a failed turn stored the user's message twice; reloaded history and the model's context showed it twice | user message persisted before the model call; Retry re-sent it as a new turn | same as #1 (a retry of a failed attempt does not store it again, and the model sees it once) | same |
| 3 | **High** | Upload a Hindi PDF/DOCX, then ask about it → "can't connect" (500) | `express.json()` 100 kB default; 60,000 Devanagari characters ≈ 180 kB | 1 MB JSON limit (`6ff0148`) | `test/api/requestBody.test.ts` |
| 4 | Medium | Malformed JSON → 500 `internal_error` (also on Vercel's own parser) | error handler ignored body-parser 4xx | 400 `invalid_json`, 413 `payload_too_large`; web says "too long to send" (`6ff0148`, `7bb6f54`) | same + `web/tests/logic.test.js` |
| 5 | **High** (production only) | A non-UUID id (stale/corrupt conversation id, bad confirmation/task id) → 500 on Postgres; a browser holding one failed **every** turn | Postgres UUID columns reject the value (22P02); in-memory store (most tests) returned not-found, hiding it | non-UUID = not found (`e3b688b`) | `test/api/nonUuidIds.test.ts` (both stores) |
| 6 | Medium (misconfiguration) | Production without `GEMINI_API_KEY` answered with the dev mock's canned text as if the AI replied | planner always fell back to `MockAIProvider`; skills already failed closed | `UnavailableAIProvider` in production: `AI_UNAVAILABLE`, `/health` `provider: none` (`9de865e`) | `test/ai/unavailableProvider.test.ts` |
| 7 | Medium (verification gap) | Live smoke "chat PASS" never exercised Gemini | its only turn, "Hi", is a deterministic fast path | one model-backed smoke turn; a mock answer can never pass (`a216d9d`) | every branch run locally |
| 8 | Low (observability) | A Gemini fallback-model answer (404/5xx) was silent | no log, not in the trace | warning + `servedModels` in the turn log, chat and TTS (`30be003`) | `test/ai/geminiProvider.test.ts` |
| 9 | Low (defence in depth) | `?api=` could aim the client's tokens at any host | no origin check; CSP `connect-src 'self'` was the only barrier | same-origin only (`17ced73`) | `web/tests/logic.test.js` |

## 3. Found and NOT fixed (reported, with reason)

| # | Area | Finding | Why not fixed here |
|---|---|---|---|
| R1 | Tasks (P2) | No task executor: "Resume"/"Retry" set `RUNNING` while nothing runs, which is a fake state in the UI | a real executor or a status change is P2 work; the order you gave puts it after Phase 1 |
| R2 | AI policy | **Doc/requirement conflict:** `AI_ARCHITECTURE.md` documents a fallback to `gemini-3.8-flash` on 5xx/404; your rule says "never silently switch provider/model" | now logged and traced (not silent). Removing the fallback lowers availability: **your decision** |
| R3 | Idempotency | A `clientTurnId` reused with a *different* utterance replays the earlier result | the shipped client never does this; binding the key to an utterance hash is a small follow-up |
| R4 | Android | Sends no `clientTurnId` | Android has no Retry button; every send is a new message by the user. Add it together with Retry |
| R5 | Partial retries | A retried *failed* turn re-runs tools that succeeded before the failure (e.g. search OK, then quota on the final model call) | per-step resumption is a larger change; the retry is always an explicit user action |
| R6 | Rate limits | Per-route limits are in-memory, per serverless instance | needs a shared store (known, from PR #78) |
| R7 | Streaming states | No distinct PLANNING, WAITING, VERIFYING, PERMISSION_REQUIRED (web), CANCELLED, DISCONNECTED UI states | not faked; adding them needs real backend stages first |
| R8 | Config | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PUBLIC_APP_URL` are read but unused; `.env.example` implies the first two work | cosmetic; removal can break nobody but was outside this pass |
| R9 | Model calls | Generation skills cost 3 Gemini requests (plan, generate, final restatement) | architectural, not an accidental duplicate (PR #78 §2) |
| R10 | SSE | No heartbeat during a long model call | not observed to fail; watch Vercel logs |
| R11 | Web IA | Blueprint pages Work, Tasks, Files, Research, Creative, Business are not separate web pages | correct per your rule: no page without a backend behind it |

## 4. Documentation compared with implementation

| Document says | Code does | Status |
|---|---|---|
| Requested docs `DEEP_AUDIT_2026-10-02.md`, `FINAL_PHASE1_VERIFICATION.md`, `PHASE1_HANDOFF_REPORT.md`, and `/shared`, `/tests` exist | only on PR #78's branch | CONFLICT (branch) |
| `DEEP_SCAN_REPORT.md` findings (e.g. Android conversation id in memory only, client `confirmed` flag) | fixed on PR #78 (DataStore-persisted id; server-issued confirmations) | report is stale for PR #78 |
| `AI_ARCHITECTURE.md`: fallback model on 5xx/404 | as documented | CONFLICT with your "never silently switch" rule (R2) |
| `FINAL_PHASE1_VERIFICATION.md` 8c "Live 'Hi' chat PASS" | that turn never calls Gemini | overstated: it proves auth, database and streaming, not the AI |
| `.env.example`: "ANTHROPIC/OPENAI … leave unset to use the mock" | neither is used at all | misleading (R8) |
| Blueprint §3.3 real states list | see R7 | PARTIAL |
| "No fake AI fallback answers" | was violated by the production mock planner when misconfigured | fixed (#6) |

## 5. Verification matrix (this branch)

| Area | Check | Result | Evidence |
|---|---|---|---|
| Backend | `tsc --noEmit` (backend src+tests) and root `tsc` (api + backend) | PASS | local |
| Backend | Unit + integration tests, in-memory **and** Postgres 16 | PASS: 333 passed, 2 skipped (live-credential tests) | local `npx vitest run` with `TEST_DATABASE_URL` |
| Backend | Security tests (`phase1Security`, route auth coverage, rate limits, confirmation replay, cross-account) | PASS (part of the 333) | local |
| Web | Unit (`node --test`) | PASS 13/13 | local |
| Web | Playwright E2E, real backend + Postgres + GitHub stub, Chromium | PASS 19/19 (new: Retry replay) | local; fails 18/19 on the old client |
| Web | Responsive, keyboard, accessibility, voice UI, service worker | NOT TESTED in this pass (no layout change). PR #78: PASS | PR #78 §4 |
| Android | `./gradlew --version` | PASS: Gradle 8.14.3, Kotlin 2.0.21 | local |
| Android | `:domain:test` (pure Kotlin) | PASS 120/120 | local, JDK 17 |
| Android | `clean test lint check assembleDebug assembleRelease bundleRelease` | BLOCKED locally: `dl.google.com` (Google Maven, Android SDK) returns 403 through this sandbox's proxy. CI result for this branch: see the PR | CI `test-and-lint`, `assemble-debug` |
| Android | APK / AAB contents | NOT TESTED locally (no SDK). CI asserts package `com.zarvismobile.app`, versionCode 1, versionName 0.1.0, minSdk 26, targetSdk 34, launchable activity, dex present, base URLs | CI |
| Android | Emulators API 26/30/34 | not re-run here; no Android code changed. PR #78 head: PASS | PR #78 checks |
| Android | **Nothing Phone 2A** | **NOT TESTED**: no device is attached to this cloud session | — |
| Gemini | Request budget per turn type | PASS (mocked HTTP, real provider classes) | `turnEconomy.test.ts` |
| Gemini | Quota / retry policy | PASS (Gemini's real 429 body format) | `geminiErrors.test.ts`, `turnExecution.test.ts` |
| Gemini | Live answer on the preview | NOT TESTED until this branch's smoke runs on its deployment | §2 #7 |
| Web Search | One logical search, one execution; no re-run after a provider failure; no re-run on Retry | PASS | `turnExecution.test.ts`, `turnIdempotency.test.ts` |
| Web Search | Live grounded search | NOT TESTED | needs a working key |
| TTS | Ordered segments, Stop ends all, quota stops segments, TTS never starts a turn | PASS (code + PR #78 voice UI tests) | PR #78 |
| TTS | Real audio (web, Android) | NOT TESTED | needs a device and a key |
| Vercel | Preview `/health`, guest, `/auth/me`, "Hi" | PASS (PR #78 head, 2026-10-02 16:42 UTC) | smoke job 110933385063 |
| Vercel | Production `zarvismobile.com` | NOT TESTED | not reachable from this session |
| Database | Postgres store, schema, TLS, cascade (incl. new `turn_records`) | PASS | Postgres tests |
| Auth | Guest, sign-up, login, refresh rotation, replay revoke, logout, deleted account, cross-account | PASS (local); live email sign-up NOT TESTED | `phase1Security.test.ts`, E2E |
| Security | Confirmation replay, cross-account turn keys, GitHub per-user, CSP, token targeting | PASS | tests above |

## 6. Final acceptance gate

| Gate | State |
|---|---|
| Production Web can chat | NOT TESTED (preview PASS for the greeting path; a model answer is unverified) |
| API contract mismatch | none known (C1–C6 fixed; contract test PASS) |
| Authentication | PASS (local); live email NOT TESTED |
| Database | PASS |
| Duplicate execution | PASS (turn idempotency, per-turn guards, Android rotation from PR #78) |
| Gemini retry loop | PASS (no retry on a daily quota) |
| Web Search accidental duplicate | PASS |
| Stream replay | PASS (a replay executes nothing) |
| TTS duplicate request | PASS (code and tests); real audio NOT TESTED |
| Security vulnerability | none known open |
| Android build | PASS on CI for PR #78; this branch: see CI |
| Android runtime crash / permission failure | emulator PASS (PR #78); device NOT TESTED |
| **Physical device** | **NOT TESTED: blocker** |

**Remaining blockers before READY:**
1. Nothing Phone 2A run (`android/scripts/device/verify-device.sh`, steps in
   `FINAL_PHASE1_VERIFICATION.md`).
2. A live model-backed answer on the preview: the new smoke turn on this branch's deployment.
   With a free-tier key it may report the quota as a warning, which proves the key works but not
   a reply.
3. Live email sign-up and login on the preview.
4. Your decision on R2 (keep or drop the fallback model).
