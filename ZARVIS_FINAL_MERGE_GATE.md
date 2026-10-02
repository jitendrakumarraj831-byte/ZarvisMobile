# ZARVIS final merge gate

- **Date:** 2026-10-02
- **Final branch:** `claude/optimistic-lovelace-y9w9q6` (PR #79)
- **Final code commit:** `ec92468`. `45c0ad8` and later change only documentation and the live
  smoke script's diagnostic output; CI is green on `45c0ad8`.
- **Base:** PR #78, `claude/laughing-shannon-m3zu32` at `def15c4` (merged into PR #79; no
  conflict left).
- **`main`:** `e010c12`, untouched.

Status values: PASS, FAIL, BLOCKED, NOT TESTED, NON-BLOCKING.

## Gate decision

**DO NOT MERGE INTO `main` YET.**

Your gate blocks on NOT TESTED for any critical production capability. These remain:

| Blocker | State | What clears it |
|---|---|---|
| Nothing Phone 2A (install, launch, login, chat, real Gemini, mic, TTS, camera, files, permissions, rotation, background, process death, network loss, duplicate prevention) | **NOT TESTED** | the phone on USB with `adb`: `android/scripts/device/verify-device.sh` (steps in `FINAL_PHASE1_VERIFICATION.md` → ANDROID REAL DEVICE) |
| Production (`zarvismobile.com`) with this code | **NOT TESTED** | the code reaches production only by merging. Needs your decision: merge, then run the smoke workflow on production at once with a rollback ready; or hold `main` |
| A completed live Web Search | **BLOCKED** (provider) | all three live runs: the search ran exactly once, then Gemini's Google Search grounding answered 429 (rate limited, no advised wait), even after the smoke waited out a 65 s window; the planner calls in the same run succeeded. Check this API key's grounding quota / billing tier in Google AI Studio |

There is no FAIL, no CRITICAL or HIGH security issue, no known duplicate execution, retry loop,
fake AI response, deadlock, broken API contract, or cross-account access.

## PR status

| PR | State | Head | CI |
|---|---|---|---|
| #78 Phase 1 foundation | open, draft, not merged | `def15c4` | green on `5cc165f` (its last code commit) |
| #79 reliability hardening | open, draft, not merged | see branch | see "CI result" below |

### Merge plan (not performed)

1. Merge PR #79 into PR #78's branch (a merge commit, no history rewrite on PR #78's branch).
2. Re-run the full CI on the resulting PR #78 head.
3. Review the PR #78 diff against `main` (done for this pass: 253 files; no `.env`, keystore,
   build output, `node_modules` or secret; the only credential-shaped string is the test fixture
   `postgres://u:p@db.example.com`).
4. Merge PR #78 into `main` with a merge commit, so both PRs' commits stay in history, only
   once every blocker above is cleared.

Commits that would reach `main`: PR #78's 87 commits (`e9126d1` … `def15c4` and earlier) plus
PR #79's commits listed in "Files and commits" below.

## Bugs found and fixed in PR #79

18 fixes, each with a regression test that fails without the fix. Full table with root causes:
[ZARVIS_PRODUCTION_READINESS.md](./ZARVIS_PRODUCTION_READINESS.md) §2.

| Area | Fixed |
|---|---|
| Duplicate execution / charge | Retry of a finished turn (replay); Retry after a late failure (tool reused); key reused with other text (409); message stored twice on Retry |
| API contract | malformed JSON 400; oversized body 413; Hindi document body 500; non-UUID ids 500 on Postgres |
| Database | schema-setup / account-deletion deadlock (advisory lock) |
| Honesty | production mock AI replies; tasks shown RUNNING with nothing running |
| Web | double-click cancelled the message; keyboard-inaccessible attach control; a11y names; contrast; focus ring |
| Observability | `modelCallId` per AI call incl. skills; fallback-model switches logged |
| Security (defence in depth) | `?api=` token target; GitHub client `.`/`..` path segments |
| CI / verification | racy APK checks (pipefail); smoke never reached Gemini; uncommitted QA scripts replaced by a committed suite |
| Config | three unused environment variables removed |

## Regression tests added

| File | Tests |
|---|---|
| `backend/test/agents/turnIdempotency.test.ts` | 21 (in-memory + Postgres): replay, failed-turn retry, late-failure reuse, in-progress 409, reuse with other text, cross-account keys, deletion, HTTP/SSE |
| `backend/test/api/requestBody.test.ts` | 4: malformed JSON (Express and Vercel), 60k-char Devanagari, 413 |
| `backend/test/api/nonUuidIds.test.ts` | 4 (both stores) |
| `backend/test/store/schemaConcurrency.test.ts` | 3: cold starts racing deletions, no open transaction, deletion cleanup |
| `backend/test/ai/unavailableProvider.test.ts` | 2 |
| `backend/test/github/githubClientPaths.test.ts` | 6 |
| `backend/test/agents/turnEconomy.test.ts` | +3: per-call log equals real requests |
| `backend/test/ai/geminiProvider.test.ts` | +1: fallback logged with `modelCallId` |
| `backend/test/tasks/taskService.test.ts`, `backend/test/api/api.test.ts` | task resume/retry refused |
| `web/e2e/quality.e2e.cjs` | 14 browser checks (new, in CI) |
| `web/e2e/phase1.e2e.cjs` | +1: Retry after a cut stream is replayed |
| `web/tests/logic.test.js` | +3 |
| `scripts/live-smoke.mjs` | 20 live checks per preview deployment (new) |

## Results

| Area | Result | Evidence |
|---|---|---|
| Backend tests | PASS | 353 passed, 2 skipped (they need live credentials); in-memory + Postgres 16; CI `backend` |
| Backend typecheck | PASS | backend `tsc --noEmit`, root `tsc` |
| Backend build | PASS | `npm run build` |
| Security tests | PASS | `phase1Security` (44), route auth coverage, cross-account turn keys, confirmation replay, GitHub path segments; CodeQL in CI |
| Web unit | PASS | 13/13 |
| Web E2E (Phase 1) | PASS | 19/19, local and CI `web-e2e` |
| Responsive | PASS | 8 views × 6 widths (360–1920 px), no horizontal overflow |
| Accessibility | PASS | axe: no serious/critical violation on any view, 412/1280 px, both appearances |
| Keyboard | PASS | composer reachable by Tab with a visible focus ring; Enter sends once; attach control opens with Enter/Space; every control named |
| Service worker | PASS | installs; offline shell opens |
| Voice / TTS (browser) | PASS | one recognition result = one turn; TTS playback starts no turn; a result while speaking is ignored |
| Web Search duplicates | PASS | normal, Retry, network failure + Retry, reload mid-turn, double click, slow reply, rate limit: one execution each |
| Android `:domain` tests | PASS | 120/120, local (JDK 17) |
| Android Gradle (clean, test, lint, check; all modules) | PASS | CI `test-and-lint` on `ec92468` and `45c0ad8` |
| Android APK (debug, release) | PASS | CI `assemble-debug` on `45c0ad8`: debug and unsigned release APK built; package, versions, SDK levels, launchable activity, not-debuggable release asserted with aapt2 |
| Android AAB | PASS | CI `assemble-debug` on `45c0ad8`: unsigned release AAB built, manifest checked with bundletool |
| Android emulators API 26/30/34 | PASS | CI `emulator` on `45c0ad8`: all three jobs green |
| Windows build | PASS | CI `windows-build` on `45c0ad8` |
| Android Gradle locally | BLOCKED | `dl.google.com` (Android Gradle plugin, SDK) is denied by this sandbox's proxy. Gradle configuration was not changed to work around it |
| Gemini | PASS | live answer on the preview (smoke); quota policy, retry bounds, no charge on failure, per-call logging (tests) |
| Web Search (live) | BLOCKED | ran once; Gemini search grounding answered 429 in both live runs (see blockers) |
| TTS (live) | PASS | preview `/tts/synthesize` returned `audio/wav` |
| Database | PASS | Postgres tests incl. deadlock regression; live sign-up / deletion |
| Auth | PASS | tests; live on the preview: guest, sign-up, login, wrong password 401, refresh rotation, replay refused, logout revokes, deletion |
| Preview | PASS | smoke: 19 PASS, 1 WARN (web search), 0 FAIL, in three runs |
| Production | NOT TESTED | denied by the sandbox network policy; serves `main` until the merge |
| Nothing Phone 2A | NOT TESTED | no device in this session |
| CI result | PASS | all 16 checks on `45c0ad8` green: backend, web-e2e (with the quality suite), test-and-lint, assemble-debug, dev-backend-reachability, emulators 26/30/34, windows-build, smoke, Vercel |

## Remaining warnings and non-blocking issues

| Item | Classification |
|---|---|
| Tasks have no executor (tracking only, honestly labelled) | NON-BLOCKING |
| Android has no Retry and sends no `clientTurnId` | NON-BLOCKING |
| Gemini fallback model kept: observable, logged with `modelCallId`, tested, documented | NON-BLOCKING |
| Per-instance rate limits; no SSE heartbeat; 3 Gemini requests per generation skill | NON-BLOCKING |
| targetSdk 34 and release signing before a Play release | NON-BLOCKING for this merge; required before Play |
| GitHub Actions: Node.js 20 deprecation warnings | NON-BLOCKING |

## Files and commits (PR #79 vs PR #78)

49 files: 3 workflows; `scripts/live-smoke.mjs`; 17 backend source files and
`backend/.env.example`; 10 backend test files; 2 Android Kotlin files (Tasks screen and view
model); 8 web files; 7 documents (this one included). Full list:
`git diff --name-status origin/claude/laughing-shannon-m3zu32 origin/claude/optimistic-lovelace-y9w9q6`.
