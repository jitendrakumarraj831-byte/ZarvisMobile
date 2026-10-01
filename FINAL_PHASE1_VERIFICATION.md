# Final Phase 1 Verification — PR #78

Commit under test: `95d34a7` (branch `claude/laughing-shannon-m3zu32`). Last updated: 2026-10-01.

**PR #78 gate: NOT READY TO MERGE.** Two gate items are open:

1. The live Vercel preview cannot complete a chat.
2. The Nothing Phone 2A real-device run has not been done.

Status values:

| Value | Meaning |
|---|---|
| PASS | Verified, with evidence |
| FAIL | Verified broken |
| BLOCKED | Cannot be verified from where the check was run; the reason is given |
| NOT TESTED | Not run yet |

Who verifies what:

- Automated results come from GitHub Actions CI on `95d34a7` and from the cloud development container.
- That container has no USB device attached, so nothing in it can drive a physical phone.
- No emulator result is counted as a real-device result.

## Gate summary

| Gate item | Status | Evidence / blocker |
|---|---|---|
| Web verified | PASS (local + CI) / FAIL (live preview) | See [WEB](#web) |
| Backend and database healthy on the live preview | FAIL | `/health` returns 500 `jwt_secret_missing_or_invalid`, stage `container_import`. See [BACKEND](#backend) |
| First-time email sign-up and login works (live) | FAIL | Every route returns 500 until the backend starts |
| Existing auth works (local) | PASS | Backend 232/232 tests; E2E 14/14 |
| CI green | FAIL (1 check) | Every check is green except `smoke`. `smoke` gets HTTP 302 to the Vercel login, because the repository secret `VERCEL_AUTOMATION_BYPASS_SECRET` is not set |
| Android automated tests pass | PASS | `assemble-debug`; emulators API 26/30/34, phases A–E; `windows-build`; `:domain` 117/117 |
| Nothing Phone 2A real-device tests | NOT TESTED | Requires the physical phone. See [ANDROID REAL DEVICE](#android-real-device) |
| No critical/high unresolved issue | FAIL | Live backend startup (BACKEND-1) |
| Logcat has no relevant runtime errors | NOT TESTED | Requires the device |
| Voice/TTS works without stuttering | NOT TESTED | Requires the device, a real microphone and a working Gemini key |
| Camera/microphone permissions work | PASS on emulator / NOT TESTED on device | Emulator phases A and D |
| Chat works repeatedly (live) | FAIL | BACKEND-1 |
| App survives background and process restart | PASS on emulator / NOT TESTED on device | Emulator phases B and C |
| Security checks pass | PASS (source-level) / NOT TESTED (APK on device) | See [SECURITY](#security) |

## WEB

| Item | Status | Evidence |
|---|---|---|
| Responsive layout, 11 widths × 31 pages | PASS | 341/341, local Playwright |
| Keyboard and composer (`visualViewport`) | PASS (emulated) | 12/12 |
| Accessibility and contrast | PASS | 0 issues |
| Web unit tests | PASS | 8/8 |
| Playwright E2E | PASS | 14/14; CI `web-e2e` green |
| Service worker offline | PASS | Cache v10, offline reload |
| Live Vercel preview chat | FAIL | See BACKEND-1. Deployments of `95d34a7` at 15:34, 16:08 and 16:18 UTC on 2026-10-01 have not yet been checked with `/health` |
| Real phone browser (keyboard, orb, microphone) | NOT TESTED | Requires the phone |

## ANDROID AUTOMATED

| Item | Status | Evidence |
|---|---|---|
| `assembleDebug` | PASS | CI `assemble-debug` on `95d34a7` (both workflow runs) |
| Windows build | PASS | CI `windows-build` |
| Emulator API 26: phases A–E | PASS | A: 3/3, with 4 dialog tests UNVERIFIED (blocked by the platform on API 26). D: 15/16, with camera UNVERIFIED (blocked by the platform). Phase E passed on its single re-run, after a System UI crash on the first run |
| Emulator API 30: phases A–E | PASS | A: 7/7; D: 16/16 |
| Emulator API 34: phases A–E | PASS | A: 7/7; D: 16/16 |
| `:domain` JVM unit tests | PASS | 117/117, 0 failures (`./gradlew :domain:test`, re-run 2026-10-01) |
| Local `assembleDebug` in the cloud container | BLOCKED | No Android SDK; `dl.google.com` is blocked by the sandbox proxy. CI is the build gate |

## ANDROID REAL DEVICE

**Every item below is NOT TESTED.** These checks need the physical Nothing Phone 2A on USB with `adb`, operated by a person. Emulator results do not substitute.

How to run, on a computer with the Android SDK and the phone connected (`adb devices` must list it):

```
cd backend && PORT=3000 npm run dev                                          # terminal 1
cd android && ZARVIS_BUILD_ONLY=1 bash scripts/device/verify-device.sh       # build + install
cd android && ZARVIS_DEVICE_RESET_OK=1 bash scripts/device/verify-device.sh  # automated device phases
adb logcat -v time > nothing2a-logcat.txt                                    # keep running during manual checks
```

**Important (ANDROID-1):** the app cannot currently be pointed at a Vercel preview.

- The **debug** APK talks to `http://<dev-host>:3000/`, the local backend (`android/app/build.gradle.kts` line 248, cleartext is debug-only).
- The **release** APK talks to `https://zarvismobile.com/`, the production domain (line 258).
- There is no build switch for an HTTPS preview URL.
- The preview is also behind Vercel Deployment Protection, which the app cannot pass.

So item 16 (backend integration) can be verified on the device against the **local** backend, or against production after merge. It cannot be verified against the current preview without a code change, which has not been made.

| # | Area | Items | Status |
|---|---|---|---|
| 1 | Build | Clean build, `assembleDebug`, install on device, install warnings | NOT TESTED |
| 2 | First launch | Fresh install, splash, Home, orb, navigation, no crash / white screen / ANR, Logcat | NOT TESTED |
| 3 | First-time user | Guest, email sign-up, login, validation, persistence, restart, logout, re-login, expired/revoked session | NOT TESTED |
| 4 | Chat | "Hi", Hinglish/Hindi, long message, consecutive messages, Gemini, loading, retry, network loss and recovery, persistence, background during request, process death | NOT TESTED |
| 5 | Voice (real microphone) | Permission allow/deny, Hindi/Hinglish recognition, repeat, cancel, no stuck state or freeze | NOT TESTED |
| 6 | TTS | Playback, single playback, no stutter, stop, repeat, background, Bluetooth/headphones | NOT TESTED |
| 7 | Image/camera | Gallery, camera permission, capture, preview, analysis, large file, unsupported file, deny, cancel | NOT TESTED |
| 8 | File upload | PDF, supported/unsupported types, progress, cancel, size/type validation, errors | NOT TESTED |
| 9 | Permissions | Microphone, camera, location, notifications, media: first request, allow, deny, deny twice, permanent deny, re-enable in Settings | NOT TESTED (emulator PASS: phase A) |
| 10 | Background / process death | During chat, upload, TTS, voice; kill and reopen; no duplicated actions | NOT TESTED (emulator PASS: phases B and C) |
| 11 | Network | Wi-Fi, mobile data, offline, reconnect, retry | NOT TESTED |
| 12 | UI/UX | Screen size, keyboard, scrolling, navigation, safe areas, animations, dark mode, Hindi, long text | NOT TESTED |
| 13 | Performance | Startup, scrolling, memory, CPU, battery, network churn, leaks | NOT TESTED |
| 14 | Security on device | Logcat contains no tokens; logout clears storage | NOT TESTED (source checks PASS, see [SECURITY](#security)) |
| 15 | Every page and button | Home, Chat, Voice, Activity, Capabilities, Developer, Metrics, Plans, Settings and its sub-pages, Permission Center | NOT TESTED (emulator PASS: phase E covers Settings and the Permission Center) |
| 16 | Backend integration | Health, auth, chat, image, TTS, uploads, Developer Agent, authenticated APIs | BLOCKED against the preview (ANDROID-1 and BACKEND-1). NOT TESTED against the local backend |
| 17 | Logcat | Crashes, exceptions, network/permission/audio errors, ANR | NOT TESTED |

## BACKEND

| Item | Status | Evidence |
|---|---|---|
| Backend tests (in-memory + Postgres 16) | PASS | 232/232; CI `backend` green |
| `tsc` and build | PASS | Clean |
| Live preview startup | **FAIL (BACKEND-1)** | See below |

**BACKEND-1: live preview backend does not start.**

- **Reproduction:** open `/health` on the `95d34a7` preview deployed 2026-09-30 15:19 UTC. It returns:

  ```json
  {"status":"error","provider":"mock","reason":"jwt_secret_missing_or_invalid","stage":"container_import"}
  ```

  `/api/v1/auth/signup` and `/api/v1/orchestrator/turn` both return 500 "Server is misconfigured".
- **Root cause:** the runtime of that deployment has an empty or unset `JWT_SECRET`, and an empty `GEMINI_API_KEY`.
  - `backend/src/config/env.ts` `resolveJwtSecret()` throws when `NODE_ENV=production` and no `JWT_SECRET` is set.
  - `api/index.ts` catches the error and serves the fallback app.
  - The fallback reports `provider: "mock"`, which means `GEMINI_API_KEY` is also empty.
  - Reproduced byte-for-byte locally.
  - No code bug: the deployed commit is the branch head, no `.env` file is committed, and `process.loadEnvFile()` does not override variables the platform sets.
- **Affected configuration:** the Vercel project environment variables in the Preview scope. No code file is affected.
- **Fix:** the project owner sets `JWT_SECRET`, `GEMINI_API_KEY` and `POSTGRES_URL`/`DATABASE_URL` for **Preview**, then redeploys. It is not yet known whether the redeploys on 2026-10-01 already fixed this.
- **Verification:** NOT DONE. It needs `/health` from a logged-in browser on the newest deployment, or the `VERCEL_AUTOMATION_BYPASS_SECRET` repository secret so `smoke` can reach the API.

## DATABASE

| Item | Status | Evidence |
|---|---|---|
| Postgres store (local Postgres 16) | PASS | Backend suite |
| `/health` database codes | PASS | Unit tests for `classifyDatabaseError` |
| Neon TLS / URL handling | PASS (static) | `poolConfigFor` removes `sslmode` and verifies the certificate strictly, which suits Neon's publicly trusted certificate. `channel_binding` is ignored by `pg`. A pool builds from a Neon-style URL |
| Live Neon connection from the preview | BLOCKED | Startup fails before the database is used (BACKEND-1) |

## AUTH

| Item | Status | Evidence |
|---|---|---|
| Guest, sign-up, login, refresh rotation, logout, revoked session | PASS (local) | Backend tests and E2E |
| Android token refresh and session-ended handling | PASS (source + emulator) | `TokenAuthenticator`: `session_invalid`, `session_revoked` or `refresh_token_reused` clears tokens; a 5xx or network error clears nothing |
| Live preview auth | FAIL | BACKEND-1 |
| Android real-device auth | NOT TESTED | — |

## VOICE/TTS

| Item | Status | Evidence |
|---|---|---|
| Web voice UI error states | PASS (stubbed recognizer) | 12/12 |
| Real microphone (web or Android) | NOT TESTED | Requires the device |
| TTS audio output and stutter | NOT TESTED | Requires the device and a working `GEMINI_API_KEY` on the backend |

## UPLOAD/IMAGE

| Item | Status | Evidence |
|---|---|---|
| Upload UI: preview, progress, errors | PASS (local) | E2E and manual Playwright |
| Image analysis without `GEMINI_API_KEY` | PASS (fails closed by design) | 503 `image_analysis_unavailable` with an honest message in the UI |
| Image analysis with a real key | NOT TESTED | Needs a working key on the backend |
| Android camera capture | PASS on API 30/34 emulator; BLOCKED on API 26 emulator (platform) / NOT TESTED on device | — |

## SECURITY

Source-level checks of the Android code on `95d34a7`:

| Item | Status | Evidence |
|---|---|---|
| No API key, JWT secret, database URL or GitHub token in Android sources or Gradle files | PASS | Scanned for `AIza…`, `GEMINI_API_KEY`, `JWT_SECRET`, `POSTGRES_URL`, `ghp_…` and `sk-…`. The only match is a comment in `ZarvisApi.kt` saying the key is server-side |
| Secure token storage | PASS | `core-security/SecureStorage.kt`: Android Keystore `MasterKey` (AES256-GCM) + `EncryptedSharedPreferences` |
| HTTPS only in release | PASS | Release base URL is `https://zarvismobile.com/`. The cleartext network security config is generated for debug only, scoped to the dev host |
| No secrets in HTTP logs | PASS | `ApiClientFactory.kt`: `HttpLoggingInterceptor.Level.BASIC`; request and response bodies are never logged |
| Decompiled APK contains no secrets | NOT TESTED | Needs the built APK. Run `apkanalyzer` or `jadx` on the CI artifact |
| Logcat on device contains no tokens | NOT TESTED | Requires the device |

## PERFORMANCE

| Item | Status | Evidence |
|---|---|---|
| Web: orb pauses while the tab is hidden; no heavy loops found | PASS (code review + Playwright) | — |
| Android startup, memory, CPU, battery, leaks | NOT TESTED | Requires the device (`adb shell dumpsys meminfo`, Android Studio profiler) |

## Open items, in order

1. **Project owner:** check `/health` on the newest preview deployment. If it still shows `jwt_secret_missing_or_invalid`, set `JWT_SECRET`, `GEMINI_API_KEY` and `POSTGRES_URL` for **Preview** and redeploy.
2. **Project owner (optional):** add the repository secret `VERCEL_AUTOMATION_BYPASS_SECRET` so CI `smoke` can verify the live API.
3. **Decision needed (ANDROID-1):** should the Android debug build be able to point at an HTTPS backend (for example `-Pzarvis.apiBaseUrl=https://…`)? Not changed without approval.
4. **Tester with the phone:** run the [ANDROID REAL DEVICE](#android-real-device) checklist and attach `nothing2a-logcat.txt` plus the `verify-device.sh` output.
5. Re-evaluate the gate. Report READY TO MERGE only when every gate row is PASS.
