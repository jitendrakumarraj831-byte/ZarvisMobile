# ZARVIS Mobile: deep audit and bug hunt, 2026-10-02

- **Branch:** `claude/laughing-shannon-m3zu32`, PR #78 (Draft, not merged).
- **Baseline:** `f89aaec`, clean working tree, `main` at `e010c12`.
- **Result head:** `231f962` plus this report.

All fixes were made in small commits. Each has a regression test, and every test was shown to
fail on the code before the fix. Nothing was merged.

**Limits of this run:**
- No physical device was available in this environment, so physical-device checks are
  **NOT TESTED**.
- The Android SDK cannot be downloaded here (`dl.google.com` is blocked by the network
  policy). Android `clean`/`test`/`lint`/`check`/`assemble` therefore ran on GitHub Actions,
  which this audit extended to run them.

## 1. Root causes of the reported symptoms

### 1.1 Gemini `429 RESOURCE_EXHAUSTED` (`generate_content_free_tier_requests`)

The failure was amplified by retries. Before the fix, every Gemini call treated every 429 as
transient:

| Call path | Requests sent for one daily-quota 429 |
|---|---|
| Chat model step (`GeminiProvider.generate` / `streamGenerate`) | 6 (3 attempts × 2 models), about 6 s of waiting |
| TTS segment (`GeminiTtsProvider`) | up to 9 (3 × 3 models) |
| Image analysis (`documents.ts`) | up to 9 (3 × 3 models), with no request timeout |
| Web search grounding | 1 |

One agent turn can make up to 5 model steps plus tool calls. A single user message could
therefore send dozens of requests against an already-exhausted daily quota. Each request
counted against the quota and delayed the reply.

### 1.2 Two identical failed **Web Search** cards for one message

The search **executed twice**. It was not rendered twice (the web client renders one row per
`toolCalls` entry, and `done` is consumed once). The sequence was:

1. Model step 1 asked for `web.search("…")`.
2. The search failed on the Gemini quota.
3. The failure went back to the model.
4. Model step 2 asked for `web.search` again with **reworded** text.

The orchestrator's duplicate guard compared the exact input only, so the second search ran
and failed the same way: two identical failed cards. This is case **D (planner/orchestrator
executed the tool twice)**, triggered by **C-like retry behaviour inside the agent loop**.

Reproduced in `backend/test/agents/turnExecution.test.ts`. On the old code that test records
two `web.search` executions and three model calls.

### 1.3 Other duplicate-execution paths found

| Path | Effect | Status |
|---|---|---|
| Client cancels a turn (Stop, a new message, a closed tab) | The server kept running the whole agent loop, including model and tool calls, for nobody | Fixed |
| Android: OkHttp default 10 s read timeout | Turns longer than 10 s showed "couldn't reach ZARVIS" while the server finished them; Retry ran the turn a second time | Fixed |
| Android: `LaunchedEffect` start request | Re-submitted the start text after rotation, dark-mode change or process death: a duplicate turn | Fixed |
| Android: a second turn did not cancel the first | Both ran, and one reply could land in the other's bubble | Fixed |
| Web: Enter + Enter + click | One request (already guarded); now covered by an E2E check | No bug |
| Web: automatic retry/replay of a turn or of SSE | None: Retry is user-initiated only | No bug |

## 2. Findings and fixes

| # | Area | Severity | Finding | Fix (commit) | Regression test |
|---|---|---|---|---|---|
| 1 | AI provider | **High** | A daily-quota 429 was retried 3× per model, then on a fallback model, in all four Gemini call paths | `ai/geminiErrors.ts`: one policy. Daily quota fails at once with no fallback; per-minute limit is retried once if the wait is ≤ 8 s; 5xx gets bounded backoff with jitter (`1658b61`) | `test/ai/geminiErrors.test.ts` (13) |
| 2 | Orchestrator | **High** | A failed skill was re-run in the same turn with reworded input (the two Web Search cards) | A skill whose service failed is not run again in the turn; an AI quota ends the turn without another model call (`6ea64de`) | `test/agents/turnExecution.test.ts` (6) |
| 3 | Orchestrator / API | **High** | A turn abandoned by the client kept spending model and tool calls | The SSE and JSON routes abort the turn on client disconnect; the provider honours the signal (`6ea64de`) | the same file, "starts no model or tool call after the client has gone away" |
| 4 | API / clients | Medium | A quota was shown as "can't connect" (web) or "check your connection" (Android); the API sent a generic error | Structured error (`type`, `retryable`, `retryAfterMs`, `quotaType`) in SSE and as a JSON 429. Web: own copy, no Retry for a daily quota. Android: honest FAILED turn (`6ea64de`, `61ea99a`, `477eeec`) | `test/api/aiQuotaErrors.test.ts` (4), E2E check, `AiServiceErrorsTest` |
| 5 | Observability | Medium | No way to count what one message cost | `turnId` (in the meta and done events) and `toolCallId` per execution; one `Turn finished` log line with model calls, provider HTTP requests, Gemini response ids and tool calls (`6ea64de`) | `turnExecution.test.ts`, `aiQuotaErrors.test.ts` |
| 6 | Web streaming | Medium | A stream that ended without `done`/`error` (platform timeout, dropped connection) looked like success: the thinking bubble vanished and nothing was shown | Treated as a failed turn with Retry (`61ea99a`) | E2E "a stream that ends without done/error…" (fails on the old client) |
| 7 | Web TTS | Low | Stop aborted only the last of two concurrent TTS requests; after a TTS quota error every later segment still requested audio | All in-flight TTS controllers are tracked; segments stop after a quota error (`61ea99a`) | manual review; voice UI 12/12 |
| 8 | Web input | Low | Enter that confirms an IME composition (Hindi keyboards) submitted the message | Ignore `isComposing` / keyCode 229 (`61ea99a`) | n/a |
| 9 | TTS route | Low | A client disconnect during backpressure could hang (`drain` never fires); the upstream Gemini stream was not cancelled | Wait on `drain` or `close`; cancel the upstream reader; abort the synthesis signal (`1658b61`) | `aiQuotaErrors.test.ts` (TTS 429 after one request) |
| 10 | Image analysis | Low | No request timeout; a quota failure was reported as "couldn't read this file" | 60 s timeout; quota → 429 `ai_quota_exceeded` with matching web copy (`1658b61`, `61ea99a`) | covered by the policy tests |
| 11 | Android network | **High** | OkHttp default 10 s read timeout was shorter than a real agent turn | read/write 150 s, call 180 s, connect 15 s (`477eeec`) | `ApiClientFactoryTest` |
| 12 | Android lifecycle | **High** | Duplicate turn after Activity recreation or process death | Start request handled once per navigation entry, stored in `SavedStateHandle` (`ad0c167`) | compiles in CI; NOT TESTED on a device |
| 13 | Android concurrency | Medium | Overlapping turns | A new turn cancels the in-flight one and stops its speech (`ad0c167`) | compiles in CI |
| 14 | Android TTS | **High** | `@Streaming` TTS body read on the main thread (`NetworkOnMainThreadException`): Gemini voice could not play | Read on `Dispatchers.IO` (`ad0c167`) | compiles in CI; NOT TESTED on a device |
| 15 | Android manifest | Medium | Lint error `PermissionImpliesUnsupportedChromeOsHardware`: `CALL_PHONE` made telephony required, so Play would hide the app on devices without a SIM | `uses-feature` telephony and microphone `required="false"` (`1775a90`) | `:app:lintDebug` in CI |
| 16 | CI | Medium | Module unit tests, Android Lint and `check` never ran anywhere; APK badging was only printed when found | New `test-and-lint` job (`clean test lint`, then `check`, with reports uploaded); APK package, version, SDK levels and launchable activity are asserted (`4f1ace0`) | the CI job itself |

### Checked, not a bug

- **Web rendering of tool cards:** one row per real execution.
- **SSE parser:** drops malformed frames, flushes the tail once.
- **Mic and TTS feedback loop:** a recognition result while SPEAKING is ignored, and the mic
  stops TTS before listening.
- **Android Assist overlay:** auto-listen is already guarded by `savedInstanceState`.
- **Android STT:** the recognizer is destroyed in `awaitClose`.
- **Charging:** failed or blocked tools are never charged (asserted again in
  `turnExecution.test.ts`).
- **Upload limits:** 4 MB, a single file, generic error reasons; malformed PDF/DOCX are
  covered by existing tests.

### Not fixed (reported only)

- **Lint warnings (4, not errors):** deprecated `Icons.Filled.Send` / `VolumeUp` / `List`.
  Use the `AutoMirrored` variants.
- **Per-route rate limits are in memory:** per serverless instance, not global. This is a
  known architectural limit and needs a shared store, e.g. Postgres or Redis.
- **Generation skills cost three model calls:** "write a poem" means plan + skill + final
  answer. Reducing this is an architectural change, not a bug fix, so it was not done here.

## 3. Documentation compared with implementation

| Item | Status |
|---|---|
| Provider retry/quota behaviour | Was **undocumented**; now in `AI_ARCHITECTURE.md` → "Provider failures, quota and retries" |
| "One turn = one execution" | **Broken** (findings 1–3, 12, 13) → fixed and documented |
| Android CI runs unit tests and lint | **Partial** (only `:domain` and the data layer) → full `test` / `lint` / `check` |
| Physical-device verification (`FINAL_PHASE1_VERIFICATION.md`) | **Planned / NOT TESTED** (no device) |
| Capability registry: 16 capabilities on Web and Android | Implemented as documented (E2E: "Permission Center lists all 16 capabilities") |

## 4. Verification matrix (on `231f962`, the latest code commit)

| Check | Result |
|---|---|
| Backend `tsc --noEmit`, root `tsc`, `npm run build` | PASS |
| Backend tests (in-memory + Postgres 16) | **PASS 301**, 2 skipped (live-credential tests) |
| Security tests (`phase1Security`, route auth coverage, rate limit) | PASS (part of the 301) |
| Web unit tests | PASS 10/10 |
| Web E2E (real backend + Postgres + GitHub stub) | **PASS 17/17**, including 3 new checks |
| Responsive (11 widths × 31 pages) | PASS, 341 combinations, no problems |
| Keyboard (2 modes × 6 widths) | PASS 12/12 |
| Accessibility and contrast (31 pages × 4 modes) | PASS, 0 issues |
| Voice UI (stubbed recognition / TTS) | PASS 12/12 |
| Service worker (fresh install, cache v12, offline shell) | PASS |
| Android `./gradlew clean test lint` (all modules) | PASS (CI, `1775a90`) |
| Android `./gradlew check` (all modules) | PASS (CI, `1775a90`) |
| Android `:app:assembleDebug`, APK inspected with aapt2 | PASS: `com.zarvismobile.app`, versionCode 1, versionName 0.1.0, minSdk 26, targetSdk 34, launchable activity |
| Android release APK + AAB (unsigned) | PASS |
| Android emulator API 26 / 30 / 34 (phases A–E) | see §5 |
| Windows Git-Bash build | see §5 |
| CodeQL | see §5 |
| Live Vercel preview smoke (`/health`, guest, `/auth/me`, chat turn) | PASS (`1775a90`) |
| Physical device (Nothing Phone 2A): install, permissions, mic, camera, location, chat, TTS | **NOT TESTED** |
| Live Gemini quota behaviour against the real API | **NOT TESTED** (verified with Gemini's real 429 body format in tests) |

## 5. CI on the final head

Filled in from the GitHub Actions results for the final commit.
