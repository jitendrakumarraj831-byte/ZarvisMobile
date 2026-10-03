# ZARVIS production readiness

- **Date:** 2026-10-02
- **Branch:** `claude/optimistic-lovelace-y9w9q6` (PR #79), stacked on PR #78
  (`claude/laughing-shannon-m3zu32`). Nothing has been merged into `main`.
- **Verdict: NOT READY for `main`.** Every automated gate this session could run passes. What
  blocks is listed in §6 and in [ZARVIS_FINAL_MERGE_GATE.md](./ZARVIS_FINAL_MERGE_GATE.md).

Status values: PASS, FAIL, BLOCKED (cannot run where it was attempted; reason given), NOT TESTED,
NON-BLOCKING. A WARN from the live smoke test is reported as NOT TESTED for that capability, never
as PASS.

## 1. Starting point and branch structure

| Fact | Evidence |
|---|---|
| `main` (`e010c12`) is 86 commits / +21.9k lines behind PR #78 | `git diff --stat main origin/claude/laughing-shannon-m3zu32` |
| `DEEP_AUDIT_2026-10-02.md`, `FINAL_PHASE1_VERIFICATION.md`, `PHASE1_HANDOFF_REPORT.md`, `/shared` and the test suites exist only on PR #78 | `git ls-tree` of both branches |
| PR #78 had already fixed most of `DEEP_SCAN_REPORT.md` (written against `main`) | its commits and tests |

PR #79 is based on PR #78's branch. Intended history:
`main` ← PR #78 (Phase 1 foundation) ← PR #79 (reliability and production hardening). PR #79 is
merged into PR #78's branch first; `main` receives PR #78 only after the gate is satisfied.

## 2. Bugs found and fixed (PR #79)

Every row was reproduced before the fix and has a regression test that fails without it.

| # | Severity | Bug | Root cause | Commit | Regression test |
|---|---|---|---|---|---|
| 1 | High | Retry after a stream dropped (server already finished): web search ran twice, charged twice, message stored twice | no idempotency key | `883c5ee`, web `7bb6f54` | `turnIdempotency.test.ts`; E2E "Retry after a stream cut off…" |
| 2 | Medium | Retry after a failed turn stored the user's message twice | message persisted before the model call; Retry was a new turn | `883c5ee` | same |
| 3 | High | Retry after a *late* failure ran and charged the tool that had already succeeded | failed attempts kept nothing | `ec92468` | `turnIdempotency.test.ts` "reuses the search…" |
| 4 | Medium | A `clientTurnId` reused with other text replayed the earlier answer | key not bound to the message | `7a6e221` | `turnIdempotency.test.ts`, 409 test |
| 5 | High | Hindi PDF/DOCX text then a question → 500 | 100 kB JSON default; 60k Devanagari chars ≈ 180 kB | `6ff0148` | `requestBody.test.ts` |
| 6 | Medium | Malformed JSON → 500 (also Vercel's parser error) | error handler ignored parser 4xx | `6ff0148` | same |
| 7 | High (production) | Non-UUID conversation/confirmation/task id → 500 on Postgres; a browser with one failed every turn | UUID columns reject it; the in-memory store hid it | `e3b688b` | `nonUuidIds.test.ts` (both stores) |
| 8 | Medium (production race) | Schema setup on a cold start deadlocked with account deletion (CI: guest sign-up 500) | opposite table lock order; schema script is one implicit transaction | `df8a2b2` | `schemaConcurrency.test.ts`: failed 5/5 before, passes after |
| 9 | Medium | Production without `GEMINI_API_KEY` answered with the dev mock's canned text | planner fell back to `MockAIProvider` | `9de865e` | `unavailableProvider.test.ts` |
| 10 | Medium | Tasks shown `RUNNING` with nothing running (Android "Start", web "Resume/Retry") | no executor; resume/retry set RUNNING | `a972f51` | `api.test.ts`, `taskService.test.ts` |
| 11 | Medium | Double-clicking Send cancelled the message just sent | Send turns into Stop under the pointer | `e93a66d` | quality E2E "double-clicking Send…" |
| 12 | Medium (a11y) | Attach control unusable from the keyboard; wordmark and attach control unnamed for screen readers; 2.3:1 text contrast on the Developer "Verify" stage; weak composer focus | `<label>` has no key activation; prohibited `aria-label`s; whole-row opacity | `e93a66d` | quality E2E (axe, keyboard) |
| 13 | Medium (verification) | Live smoke "chat PASS" never reached Gemini; no live auth lifecycle, search, upload or TTS check | greeting fast path only | `a216d9d`, `59a98b7`, `188eac9` | live runs on the preview |
| 14 | Low (observability) | Fallback-model answers silent; skills' Gemini calls missing from the turn log | no trace | `30be003`, `74ed73b` | `geminiProvider.test.ts`, `turnEconomy.test.ts` |
| 15 | Low (CI) | APK checks could fail at random, and the "release not debuggable" check could pass wrongly | `cmd \| grep -q` under pipefail (SIGPIPE) | `72adc51` | reproduced 20/20 → 0/20 |
| 16 | Low (defence in depth) | `?api=` could aim tokens at another host | no origin check (CSP blocked it) | `17ced73` | `web/tests/logic.test.js` |
| 17 | Low (defence in depth) | GitHub client accepted `.`/`..` path segments in writes | `encodeURIComponent` keeps them; URL parsing resolves them | `b1ef300` | `githubClientPaths.test.ts` |
| 18 | Low (config) | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PUBLIC_APP_URL` read, never used | dead config | `7d7dd47` | typecheck |
| 19 | Medium (honesty) | Image upload during a Gemini outage or with a rejected key said "couldn't read this document" (422); oversized upload answered 400 | every non-quota provider error was mapped to `extraction_failed` | `0d26b73` | `imageAnalysisErrors.test.ts` (5) |

## 3. Known and not fixed

| # | Classification | Item | Reason |
|---|---|---|---|
| N1 | NON-BLOCKING | Tasks have no executor (tracking only; nothing can be started) | P2 Tasks work; the UI no longer pretends otherwise |
| N2 | NON-BLOCKING | Android sends no `clientTurnId` | Android has no Retry; every send is a new message by the user |
| N3 | NON-BLOCKING | A model that rewords a request on Retry gets a new execution | a different request is not a duplicate; exact repeats are reused |
| N4 | NON-BLOCKING | Per-route rate limits are per serverless instance | needs a shared store |
| N5 | NON-BLOCKING | No PLANNING / VERIFYING / WAITING / CANCELLED UI states | not faked; need real backend stages first |
| N6 | NON-BLOCKING | Generation skills cost 3 Gemini requests (plan, generate, final restatement) | architectural, documented, not an accidental duplicate |
| N7 | NON-BLOCKING | SSE has no heartbeat | progress events at every real stage; no cut-off observed |
| N8 | NON-BLOCKING | Gemini fallback model on 5xx/404 kept | your rule is met: every switch is logged with its `modelCallId`, traced in `aiCallLog`, tested and documented (`AI_ARCHITECTURE.md`) |
| N9 | NON-BLOCKING (before Play release) | targetSdk 34; release signing not configured | separate release work (PR #78 report) |
| N10 | NON-BLOCKING | On Vercel the runtime parses JSON itself, so the 1 MB express limit does not apply there (Vercel's 4.5 MB limit does); the utterance is still capped at 70k characters | a platform difference, not a failure |

## 4. Documentation compared with implementation

| Claim | Reality | Status |
|---|---|---|
| Requested docs and `/shared`, `/tests` exist | only on PR #78's branch | resolved by the branch structure in §1 |
| `DEEP_SCAN_REPORT.md` | describes `main`; much of it is fixed on PR #78 | stale for PR #78 (kept as history) |
| "Live preview chat PASS" (`FINAL_PHASE1_VERIFICATION.md`, PR #78) | that turn never called Gemini | corrected there |
| Responsive / keyboard / accessibility "0 issues" / voice UI results (PR #78) | from scripts never committed; the committed suite found real violations | corrected there; superseded by `web/e2e/quality.e2e.cjs` |
| `.env.example` Anthropic/OpenAI keys | did nothing | removed |
| "No fake AI answers" / "no fake states" | violated by the production mock planner and by task RUNNING | fixed (#9, #10) |

## 5. Verification matrix

Exact CI numbers for the final head are in [ZARVIS_FINAL_MERGE_GATE.md](./ZARVIS_FINAL_MERGE_GATE.md).

| Area | Check | Result | Evidence |
|---|---|---|---|
| Backend | typecheck (backend, root), `npm run build` | PASS | local and CI `backend` |
| Backend | unit + integration, in-memory and Postgres 16 | PASS: 358 passed, 2 skipped (live credentials) | local; CI `backend` |
| Security | auth, sessions, refresh replay, cross-account, confirmation replay, route auth coverage, rate limits, CSP, GitHub per-user, path segments, SSRF host restriction | PASS | `phase1Security`, `routeAuthCoverage`, `githubClientPaths`, `turnIdempotency` (cross-account) |
| Web | unit | PASS 13/13 | `node --test` |
| Web | Phase 1 E2E (real backend + Postgres) | PASS 19/19 | local; CI `web-e2e` |
| Web | quality E2E: responsive 8 views × 6 widths, axe (2 widths × 2 appearances), keyboard, service worker offline, voice/TTS, duplicate submissions | PASS 14/14 | local twice; CI `web-e2e` |
| Android | `:domain:test` | PASS 120/120 | local, JDK 17 |
| Android | Gradle clean/test/lint/check/assembleDebug/assembleRelease/bundleRelease | BLOCKED locally (`dl.google.com` 403); see CI | CI `test-and-lint`, `assemble-debug` |
| Android | emulators API 26/30/34 | see CI | CI `emulator` |
| Gemini | per-turn request budget and logging | PASS | `turnEconomy.test.ts` |
| Gemini | quota policy (daily: no retry; per-minute: RetryInfo, ≤ 8 s, once; 5xx: bounded backoff + jitter) | PASS | `geminiErrors.test.ts`, `turnExecution.test.ts` |
| Gemini | live answer on the preview | PASS | smoke job 110967802275 |
| Web Search | one execution per logical request (normal, Retry, reload, double click, slow reply, rate limit) | PASS | `turnExecution`, `turnIdempotency`, quality E2E; live: ran exactly once |
| Web Search | a completed live search | see the merge gate | live smoke |
| TTS | ordered segments, one turn per voice result, no turn from playback | PASS | quality E2E voice check |
| TTS | live audio from the preview | PASS (`audio/wav`) | smoke job 110967802275 |
| TTS | real audio on a phone | NOT TESTED | needs the device |
| Database | Postgres store, deadlock regression, no open transactions, deletion cleanup | PASS | Postgres tests |
| Preview | health, guest, sign-up, login, refresh, logout, errors, streaming, replay, Gemini, upload, TTS, account deletion | PASS | smoke job 110967802275 (19 PASS, 1 WARN) |
| Production | anything | NOT TESTED | denied by this sandbox's network policy; it serves `main` until the merge |
| Nothing Phone 2A | anything | NOT TESTED | no device in this session |

## 6. What blocks `main`

1. **Nothing Phone 2A: NOT TESTED.** A critical capability (Android on a real device). Needs the
   phone on USB: `android/scripts/device/verify-device.sh` (steps in `FINAL_PHASE1_VERIFICATION.md`).
2. **Production: NOT TESTED.** The new code can only be checked on production after it is
   deployed there. Merging is what deploys it, so this needs your explicit decision: either accept a
   post-merge production smoke test (with rollback ready), or keep `main` until it is otherwise
   verified.
3. **A completed live web search**, if the live run still reports the per-minute limit (see the
   merge gate for the latest run).
