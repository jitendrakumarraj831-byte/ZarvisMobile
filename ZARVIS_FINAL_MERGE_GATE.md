# ZARVIS final merge gate

- **Date:** 2026-10-03
- **FINAL MAIN SHA:** `a03cdfd` ("Merge pull request #78"). Its tree is identical to `820a0da`,
  the PR #78 head on which all 21 CI checks passed.
- **Previous `main`:** `e010c12`. It is still in history: every merge was a normal merge commit,
  with no force-push and no history rewrite.

Status values: PASS, FAIL, BLOCKED, NOT TESTED, NON-BLOCKING. Nothing below is PASS unless the
underlying check actually ran and passed.

## Merged PRs (dependency order)

| PR | What | Merged into | Merge commit |
|---|---|---|---|
| #79 | Reliability and production hardening (19 fixes, each with a regression test) | PR #78's branch | `4d0d497` |
| #80 | One bounded, conflict-free Android emulator harness (PR #78's emulator-hang fix + PR #80's) | PR #78's branch | `820a0da` |
| #78 | Phase 1 foundation (+ #79 + #80) | `main` | `a03cdfd` |

## Commits and files included

`e010c12..a03cdfd`: 124 commits (119 non-merge, 5 merges); 256 files, +25,020 / −2,922 lines.
Before the merge, the combined diff was scanned: no `.env`, keystore, APK/AAB, build output,
`node_modules` or secret. The only credential-shaped strings are local test database URLs and
the `postgres://u:p@db.example.com` test fixture.

## Bugs fixed

PR #79 fixed 19 bugs. Each was reproduced first and has a regression test that fails without the
fix. The full table, with root causes, is in
[ZARVIS_PRODUCTION_READINESS.md](./ZARVIS_PRODUCTION_READINESS.md) §2.

| Area | Fixed |
|---|---|
| Duplicate execution / charge | Retry of a finished turn is replayed; Retry after a late failure reuses the tool result; a key reused with other text gets 409; the message is no longer stored twice on Retry |
| API contract | malformed JSON → 400; oversized body → 413; Hindi document body no longer 500; non-UUID ids no longer 500 on Postgres; image-analysis outage → 503 (was "unreadable file"); upload over the cap → 413 |
| Database | schema-setup / account-deletion deadlock (advisory lock) |
| Honesty | no mock AI replies in production; no tasks shown RUNNING with nothing running |
| Web | double-click no longer cancels the message; attach control works from the keyboard; accessible names, contrast and focus ring fixed |
| Observability | `modelCallId` on every AI call; fallback-model switches logged |
| Security (defence in depth) | `?api=` is same-origin only; GitHub client refuses `.`/`..` path segments |
| CI / verification | racy APK checks (`pipefail`); smoke now reaches Gemini; committed browser quality suite |

Fixed after PR #79:

| Fix | Where |
|---|---|
| **API 26 emulator job hung 64 min.** The emulator stopped answering adb in phase D, then `adb logcat -d` waited forever. Now every adb call has a time limit, and EMULATOR LOST, TIMED OUT, PLATFORM-BLOCKED, FAILED and NOT RUN are separate results. A wedged emulator is caught at once, with one bounded reconnect. A harness self-test runs in CI | PR #78 (`ffb6401`) + PR #80 |
| **Production smoke misdiagnosis.** Any redirect was reported as "Deployment Protection", so the 308 from `zarvismobile.com` → `www.zarvismobile.com` was never tested. The script now follows a same-site canonical redirect once, and otherwise reports the real target | PR #81 (open) |

## Tests added

- **Backend:** `turnIdempotency` (21), `requestBody` (4), `nonUuidIds` (4), `schemaConcurrency` (3),
  `unavailableProvider` (2), `githubClientPaths` (6), `imageAnalysisErrors` (5), plus additions to
  `turnEconomy`, `geminiProvider`, `taskService` and `api`.
- **Web:** `quality.e2e.cjs` (14 browser checks), the Phase 1 E2E Retry replay, 3 unit tests.
- **Android harness:** `selftest-emulator-loss.sh` (CI matrix entry; 9 checks on a real emulator).
- **Live:** `scripts/live-smoke.mjs` (20 checks per deployment).

## Results

| Area | Result | Evidence |
|---|---|---|
| BACKEND | PASS | 358 passed, 2 skipped (need live credentials), in-memory + Postgres 16; typecheck; build; CI `backend` on `820a0da` |
| WEB | PASS | unit 13/13; Phase 1 E2E 19/19; quality E2E 14/14 (responsive, axe accessibility, keyboard, service worker, voice/TTS, duplicate submits); CI `web-e2e` on `820a0da` |
| ANDROID (unit, lint, check) | PASS | CI `test-and-lint` on `820a0da`; `:domain` 120/120 locally |
| GRADLE | PASS in CI; BLOCKED locally | locally the Android Gradle Plugin cannot be fetched (`dl.google.com` denied by this sandbox's network policy); no Gradle configuration was weakened |
| APK (debug, release) | PASS | CI `assemble-debug` on `820a0da` |
| AAB | PASS | CI `assemble-debug` on `820a0da` |
| Emulator API 26 | PASS | every runnable phase passed. The permission-dialog flow is PLATFORM-BLOCKED (Android 8.0 System UI crash, evidenced in each run) and not counted as a pass |
| Emulator API 30 / API 34 | PASS | all phases passed (CI on `dea6690` and `820a0da`) |
| Emulator harness self-test | PASS | emulator killed mid-phase D → EMULATOR LOST, E/F NOT RUN, exit 3, 529 s; no hang |
| GEMINI | PASS | real Gemini answers on production (`www.zarvismobile.com`) and on the production deployment; daily and per-minute quota failures return structured errors with no retry loop and nothing charged |
| WEB SEARCH (duplicates) | PASS | one execution per logical request (tests + live: "ran once") |
| WEB SEARCH (completed live search) | BLOCKED | Gemini search grounding answered "rate limited" on every live run, even after a 65 s wait. The key appears to be free-tier, at its limits. External, not a code defect |
| TTS | PASS | production returned `audio/wav` |
| DATABASE | PASS | Postgres tests incl. deadlock regression; production `database: ok`; sign-up / deletion work live |
| AUTH | PASS | production: guest, sign-up, login, wrong password 401, refresh rotation, replay refused, logout revokes, account deletion |
| SECURITY | PASS | security tests in the backend suite; CodeQL (JS/TS, Kotlin, Actions) on `820a0da`; no secrets in the diff |
| VERCEL PREVIEW | PASS | smoke on `820a0da`: green |
| VERCEL PRODUCTION | PASS | `main` `a03cdfd`: production deployment 19 PASS / 1 WARN / 0 FAIL (run 37113466822); `https://zarvismobile.com` → `www.zarvismobile.com` 19 PASS / 1 WARN / 0 FAIL (run 37113841686, with the PR #81 script). The WARN is web search (BLOCKED above) |
| NOTHING PHONE 2A | NOT TESTED | no device was connected in any session |

## Remaining external blockers

| Item | Status | What clears it |
|---|---|---|
| Nothing Phone 2A run (install, login, chat, Gemini, mic, TTS, camera, files, permissions, rotation, background, process death, network loss, duplicates) | NOT TESTED | the phone on USB: `android/scripts/device/verify-device.sh` |
| A completed live web search | BLOCKED | raise the Gemini API key's quota or billing tier (Google AI Studio) |
| PR #81 (smoke redirect fix) | open, draft | review and merge; production was already verified with it from its branch |
| Release signing, targetSdk 34 → current, before a Play release | NON-BLOCKING | release work |
| GitHub Actions Node.js 20 deprecation warnings | NON-BLOCKING | bump action versions |
