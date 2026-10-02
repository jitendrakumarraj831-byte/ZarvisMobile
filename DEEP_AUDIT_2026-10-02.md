# ZARVIS Mobile: deep audit and bug hunt, 2026-10-02

- **Branch:** `claude/laughing-shannon-m3zu32`, PR #78 (Draft, not merged).
- **Baseline:** `f89aaec`, clean working tree, `main` at `e010c12`.
- **Result head:** `231f962` plus this report (first audit); `5cc165f` after the final hardening pass (§6).

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
| 12 | Android lifecycle | **High** | Duplicate turn after Activity recreation or process death | Start request handled once per navigation entry, stored in `SavedStateHandle` (`ad0c167`) | emulator phase F `ConversationLifecycleTest` on API 26/30/34 (§6.7); NOT TESTED on a physical device |
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

- ~~**Lint warnings (4, not errors):** deprecated `Icons.Filled.Send` / `VolumeUp` / `List`.~~
  Fixed in the final hardening pass (`5cc165f`, §6.4).
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

## 5. CI on `e649bf8` (first audit head)

Every check run PASSED:
- Backend + Web checks.
- Android build: assemble-debug, test-and-lint, dev-backend-reachability.
- Android emulator API 26 / 30 / 34, phases A–E.
- Windows Git Bash build.
- CodeQL.
- Live preview smoke.

## 6. Final hardening pass, 2026-10-02

The rules were: no new features, no architecture change, and no change to working behaviour
unless it fixed a defect. Verified code head: `5cc165f` (the commit after it changes only these reports).

### 6.1 Toolchain

| Item | Value |
|---|---|
| Gradle (wrapper) | 8.14.3 |
| Android Gradle Plugin | 8.5.2 |
| Kotlin | 2.0.21 (KSP 2.0.21-1.0.25) |
| JDK | 17 (CI: Temurin 17.0.20); `jvmToolchain(17)` |
| compileSdk / minSdk / targetSdk | 34 / 26 / 34 |
| Modules | `:domain`, `:app`, `:core:core-ui/-common/-security/-tooling`, `:data:data-remote/-local/-repository`, `:skills`, `:agents`, `:features:feature-*` ×7 |

### 6.2 Where Gradle ran

| Command | Local (this container) | CI (GitHub Actions, Android SDK present) |
|---|---|---|
| `./gradlew --version` | PASS (output above) | PASS |
| `./gradlew :domain:build` (no SDK needed) | PASS | PASS |
| `./gradlew clean`, `assembleDebug`, `test`, `lint`, `check`, `assembleRelease`, `bundleRelease` | **BLOCKED**: the environment's network policy denies `dl.google.com`, which serves the Android Gradle Plugin and SDK (`Plugin com.android.application 8.5.2 was not found`) | `clean test lint` + `check`: PASS (`test-and-lint`, BUILD SUCCESSFUL); `assembleDebug`, `assembleRelease`, `bundleRelease`: PASS (`assemble-debug`, artifacts inspected below) |

### 6.3 Artifacts (inspected with aapt2 / bundletool in CI, not inferred from the exit code)

| Artifact | Size | Package | versionCode / versionName | compileSdk | minSdk / targetSdk | Notes |
|---|---|---|---|---|---|---|
| Debug APK `app-debug.apk` | 20,062,015 B | com.zarvismobile.app | 1 / 0.1.0 | 34 | 26 / 34 | debuggable; launchable `MainActivity`; 22 dex files |
| Release APK `app-release-unsigned.apk` | 13,411,773 B | com.zarvismobile.app | 1 / 0.1.0 | 34 | 26 / 34 | **not** debuggable; launchable `MainActivity`; 3 dex files; **unsigned** (no signing secrets in CI by design) |
| Release AAB `app-release.aab` | 13,034,666 B | com.zarvismobile.app | 1 / 0.1.0 | 34 | 26 / 34 | manifest dumped with bundletool 1.17.2 |

The figures above are from run 37035697216 on `5cc165f`. The workflow fails if any of the
package, version, SDK or debuggable assertions does not hold.

### 6.4 Lint

The full lint run found 60 raw findings, which are 24 unique ones once cross-module
duplicates are removed.

| Finding | Classification | Action |
|---|---|---|
| `DataExtractionRules` (allowBackup on Android 12+) | **Real issue**: device-to-device transfer was not disabled, and the Keystore-encrypted token store cannot be decrypted on another phone | `data_extraction_rules.xml` and `backup_rules.xml` exclude everything (`e653379`, `5a56ae1`) |
| `UnusedResources` `ic_launcher_round` | The asset exists but was not referenced | `android:roundIcon` |
| `ObsoleteSdkInt` (`mipmap-anydpi-v26`, `ReminderAlarmReceiver` SDK check) | Harmless leftovers (minSdk is 26) | Folder renamed; dead check removed |
| `InlinedApi` `POST_NOTIFICATIONS` | False positive: the code is guarded by `sdkInt >= 33`, but lint cannot follow a parameter guard | `@SuppressLint` on that one function, with the reason written next to it |
| `OldTargetApi` (targetSdk 34) | Deprecated target; **Play-release blocker** (Play requires a newer target for updates) | Not changed: it changes runtime behaviour (edge-to-edge etc.) and needs its own PR and testing |
| `GradleDependency` ×16, `AndroidGradlePluginVersion` ×2 | Informational: a newer version is available | Deferred: dependency upgrades need their own PR and regression |
| Kotlin compiler `w:` deprecated `Icons.Filled.Send` / `List` / `VolumeUp` (the only 3 code warnings in the release compile of all modules) | Deprecated API, no behaviour impact in left-to-right languages | `Icons.AutoMirrored.*` replacements (`5cc165f`) |

CI now **fails** on any lint finding outside {GradleDependency, AndroidGradlePluginVersion,
OldTargetApi}. That gate caught the follow-up `fullBackupContent` finding immediately.
Result on `5cc165f`: **19 unique findings, 0 outside the deferred set** (16 `GradleDependency`,
2 `AndroidGradlePluginVersion`, 1 `OldTargetApi`). Kotlin compiler: **0 code warnings** in the debug
and release compiles; the only `w:` line left is Gradle's "multiple Kotlin daemon sessions" note.

### 6.5 New defects found and fixed in this pass

| # | Severity | Finding | Fix | Proof |
|---|---|---|---|---|
| 17 | **High** | OkHttp's `retryOnConnectionFailure` silently **re-sent a POST that had already reached the server** (a second agent turn and AI call; for `/auth/guest`, a second account) | Retry turned off; `SafeRetryInterceptor` retries only GET/HEAD or a connect failure that proves nothing was sent; a 401 is still replayed after the token refresh (`89314af`) | Reproduced locally with OkHttp 4.12 + MockWebServer: plain client sent the POST 2× (3 requests), ours 1× (2 requests). `SafeRetryInterceptorTest` (4) passes in CI |
| 18 | **High** | `TokenAuthenticator`'s own client could **re-send a refresh**. The server treats a rotated refresh token presented twice as reuse and **revokes the session**: logout on a dropped connection | Retry turned off on the refresh client (`89314af`) | `TokenAuthenticatorTest`: "a refresh that reached the server is never silently re-sent" |
| 19 | Medium | Device-to-device transfer copied app data on Android 12+ (lint `DataExtractionRules`) | Extraction and backup rules (`e653379`, `5a56ae1`) | lint gate |
| 20 | **High** | Android: **ordinary typed or chip requests opened the system document picker** instead of reaching the AI. `KeywordSkillMatcher` counted a skill name as matched when ANY of its words appeared as a substring, so "Pick a document", "Pick a photo" and "Take a photo" matched nearly every sentence through "a", and those skills' gates accept any non-question. Home's Creative chip ("Write a short product description") opened the file picker. Found by the new emulator lifecycle test (phase F failed with "No compose hierarchies found": the picker covered the app) | A skill name counts only when every name word of 3+ letters is present as a whole word (`de1ac8d`) | `DeviceCommandRoutingTest` (3) builds the real on-device catalogue; it fails on the old matcher (`got files.pick_document`). All 18 commands the emulator suite sends route to the same skill as before (old vs new compared). Emulator phase F |

### 6.6 Gemini request economy (measured, not estimated)

`backend/test/agents/turnEconomy.test.ts` wires the production provider, search provider and
content generator, stubs only `fetch`, and counts Gemini HTTP requests per turn.

| Turn kind | Gemini requests | Calls | Necessary? |
|---|---|---|---|
| Greeting ("Hi") | **0** | none (fast path) | n/a |
| Identity ("aapko kisne banaya") | **0** | none (trusted profile) | n/a |
| Plain question | **1** | planner answers directly | yes |
| Web search ("kal ka weather") | **3** | planner → grounded search → planner writes the answer from the sources | yes. The final call turns raw search output into an answer in the user's language |
| "Poem likho" / other generation skills | **3** | planner → skill's own generation → planner final reply | **The 3rd call is avoidable**: the skill's output already is the answer, and the final call restates it. Not changed: removing it means returning skill output directly, which is an orchestrator behaviour change |
| Daily quota on the first call | **1** | planner (429) → structured error | yes; it was 6 before the fix |
| Search hits the daily quota | **2** | planner, search (429) → turn ends | yes; before the fix: 2 searches + 3 planner calls, with retries on each |

**Bounds:**
- **Minimum** per turn: 0.
- **Typical:** 1 for a plain question, 3 with a tool.
- **Maximum (worst case):** 5 planner steps (`MAX_AGENT_STEPS`) plus one call per generation
  or search tool the planner requests in those steps. Each logical call adds at most 1
  retry for a per-minute 429, or 2 retries (then the fallback model) for 5xx.
- **Voice replies** add 1 TTS request per 220–320-character segment.
- An **image upload** adds 1 analysis request.

**Unnecessary duplicates removed in this audit:**
- retries of a daily quota;
- re-runs of a failed skill;
- work for abandoned turns;
- OkHttp re-sends;
- re-submits after rotation.

### 6.7 One user turn = one logical execution, per path

| Path | Mechanism | Evidence | Status |
|---|---|---|---|
| Web: Enter, Enter, click | input cleared synchronously, busy guard | E2E: 1 request | PASS |
| Web: automatic retry / stream reconnect | none exist (fetch stream, no EventSource; Retry is user-initiated) | code audit | PASS |
| Web/Android: client cancels or goes away | server aborts the turn before the next model/tool call | `turnExecution.test.ts` | PASS |
| Server timeout mid-turn | the platform kills the function; client shows Retry (web E2E "stream ends without done") | E2E | PASS |
| Android network timeout | 150 s read timeout (was 10 s) | `ApiClientFactoryTest` | PASS |
| Android connection drop after send | no silent re-send | `SafeRetryInterceptorTest` | PASS |
| Android token refresh drop | no silent re-send | `TokenAuthenticatorTest` | PASS |
| Android rotation / Activity recreation / background→foreground | start request handled once (SavedStateHandle) | emulator phase F `ConversationLifecycleTest`: user bubbles = 1 after submit, recreate, rotation and background→foreground | PASS (API 26, 30, 34 on `5cc165f`) |
| Android process death | start request flag survives in SavedStateHandle | code + phase B (process death) | PARTIAL (no dedicated recreation-after-death assertion for the start text) |
| Agent re-running a failed skill | blocked per turn | `turnExecution.test.ts`, `turnEconomy.test.ts` | PASS |
| Correlation | `turnId` (meta/done), `toolCallId` (progress/results), Gemini `responseId`, one `Turn finished` log line | `aiQuotaErrors.test.ts`, `turnExecution.test.ts` | PASS |

### 6.8 Android main thread and ANR

- **Code audit:** no network on the main thread remains.
  - The only `@Streaming` body (TTS) is now read on `Dispatchers.IO`.
  - Retrofit suspend calls run on OkHttp threads.
  - Error bodies are buffered in memory.
  - `TokenAuthenticator` runs on an OkHttp thread.
  - No `runBlocking` in production code.
- **Debug builds** run StrictMode (network + custom slow calls on the main thread, logged).
- **Emulator run fails** on any app ANR or on a network violation whose stack includes
  ZARVIS code. Result on `5cc165f`: StrictMode network violations = 0 and ANRs = 0 on API 26, 30 and 34. The only crashes during the run are 5 in `com.android.systemui` on API 26 (the known Android 8 image defect); 0 in ZARVIS.
- **TTS cancellation:** `invokeOnCancellation` stops and releases the `MediaPlayer`, and a new
  turn or Stop cancels the turn job first.

### 6.9 Final status

| Area | Status |
|---|---|
| Backend tests (308, Postgres 16 + in-memory) | PASS |
| Backend typecheck / build | PASS |
| Web unit 10/10, E2E 18/18 | PASS |
| Web responsive / keyboard / a11y / voice / SW | PASS (341 / 12 / 0 issues / 12 / v12), run on `231f962`; no web app or `backend/src` file changed after it (only `web/e2e/phase1.e2e.cjs`) |
| Android unit tests, all modules (CI) | PASS (`:domain` 120 locally, incl. `DeviceCommandRoutingTest` 3) |
| Android lint (0 findings outside the deferred set) / Kotlin warnings | PASS (19 deferred, 0 other) / PASS (0) |
| Android `check` | PASS |
| Debug APK / Release APK / AAB | PASS / PASS (unsigned) / PASS |
| Android emulator API 26 / 30 / 34, phases A–F | PASS / PASS / PASS. API 26 permission-dialog tests are **BLOCKED** by the platform (System UI crashes when the dialog is shown) and not counted |
| Windows build | PASS |
| CodeQL (actions, JS/TS, Java/Kotlin) | PASS |
| Live preview smoke | PASS |
| Gemini 429 (daily vs per-minute vs transient vs network) | PASS (tests with Gemini's real error bodies) |
| Gemini quota against the real API | NOT TESTED |
| Web Search duplicate execution | PASS |
| Streaming / stream-error UX | PASS |
| TTS (backend 429, web voice UI with stubbed TTS, Android off main thread) | PARTIAL: automated checks PASS; the web "Stop cancels all" fix is code-reviewed only; real-device audio NOT TESTED |
| Failed AI request → no usage charge | PASS (`turnExecution.test.ts`: charge not called) |
| Nothing Phone 2A | **PHYSICAL DEVICE NOT AVAILABLE — NOT TESTED** (no `adb`, no USB device in this cloud container) |
| Local Android Gradle (this container) | BLOCKED (`dl.google.com` denied by network policy) |

**Remaining blockers:**
1. Nothing Phone 2A physical-device run (`android/scripts/device/verify-device.sh`).
2. targetSdk 34 → a current target before any Play release (separate PR).
3. Release signing credentials (release artifacts are unsigned by design).
4. Live email sign-up/login on the preview.

**Verdict: AUTOMATED VERIFICATION PASS / PHYSICAL DEVICE VERIFICATION PENDING**

This is not a claim that the app is bug-free: the physical-device run, a live Gemini quota event and real-device audio are still untested.
