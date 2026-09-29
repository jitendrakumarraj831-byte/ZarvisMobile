# ZARVIS — Phase 1 Handoff Report

Branch: `claude/laughing-shannon-m3zu32` · PR: jitendrakumarraj831-byte/ZarvisMobile#78 (**draft — do not merge**)
Source of truth: `ZARVIS_MASTER_PRODUCT_BLUEPRINT.md` (§10–§12, §13 "Phase 1", §22A gate). Starting point: `DEEP_SCAN_REPORT.md`.

## Verdict: **FAIL — Phase 1 is NOT complete. Do not start Phase 2.**

Green CI is not the gate. The §22A gate requires, among other things, that *relevant
real-device tests pass*, that *capability status is truthful*, and that *documentation matches
implementation*. Status against the gate:

| §22A requirement | Status |
|---|---|
| All 16 capabilities implemented (or honestly UNSUPPORTED/PLANNED per platform) | Done — every Android capability is implemented; Web statuses are honest |
| Emulator verification on Android 8.0 / 11 / 14 | All three jobs green on 3c501d9, with the gaps listed in §4 (Android 8.0 permission dialog is platform-blocked and reported UNVERIFIED; location never produced a fix) |
| **Real-device verification** | **Not done — this cloud session cannot reach a phone (no adb, no USB). A safe device driver is ready (§5.1), audited for Windows + Git Bash (§5.4), with a Nothing Phone 2A checklist (§5.5); it must be run on a computer with a phone attached. Blocks PASS.** |
| Capability status truthful | Yes — every Android capability is `PARTIAL`; nothing is `WORKING` |
| Live integrations (Gemini TTS with a real key, real GitHub write, Play Billing) | **Not verified** — stubs/mocks only; opt-in live tests for Gemini TTS and GitHub are ready but need test credentials (§5.3); Play Billing has no Android client yet |
| Regression suites | Green (see §4.2) |

Nothing is promoted to `WORKING` until it passes on a real device.

---

## 1. Critical / High issues from the deep scan — fixed

| Issue | Fix | Verified by |
|---|---|---|
| ToolPipeline: a throwing skill crashed the turn (500) | Handler and `prepare` run in try/catch. `SkillUserError` passes through its safe message; any other error returns a generic `handler_error`. Same on Android. | `backend/test/tooling/toolPipeline.test.ts`, Android `ToolPipelineTest` |
| Silent account replacement when refresh failed | Only a server `session_invalid` / `session_revoked` / `refresh_token_reused` code ends a session. Network, 5xx and captive-portal failures keep the same account. An ended session shows a sign-in / "new guest" choice and never auto-creates an account (Web and Android). | Web E2E steps 8–10; Android `TokenAuthenticatorTest` and `SessionRepositoryTest` (CI); backend `phase1Security` |
| Auth / account continuity | Server-side sessions (`auth_sessions`); rotating refresh tokens with reuse detection that revokes the session; server-side logout; guest → email linking; the same account on other devices. | `phase1Security.test.ts` (in-memory + Postgres); Web E2E steps 6–7 |
| GitHub Developer Agent used a shared server token (any user could write anywhere) | Each account uses its own GitHub token (AES-256-GCM encrypted, never returned). Implement requires GitHub-reported `permissions.push` on that repo, checked *before* a confirmation is issued. There is no server token. | `phase1Security` "per-user GitHub authorization"; Web E2E steps 11–12 (0 writes) |
| Client-controlled `confirmed: true` flag | Server-issued confirmations: bound to the account, the skill, the input hash, and (new in the regression scan) the exact approved action text. Single use, 10-minute expiry, atomic PENDING→APPROVED/DECLINED. Clients cannot skip them. | `toolPipeline.test.ts` confirmation suite; `phase1Security` confirmations (replay, other account, expiry, identity change) |
| Android 8–12 notification / reminder crash path | `POST_NOTIFICATIONS` is treated as a runtime permission only on API ≥ 33. Below that, `areNotificationsEnabled()` is the real state and Settings is the destination. | Android `AccessCoordinatorTest`; emulator: API 26/30 read `areNotificationsEnabled` with no prompt, API 34 shows the POST_NOTIFICATIONS dialog. **Not run on a real device.** |
| 8 failing backend tests | Root causes fixed: tests no longer hit live GitHub; Hindi regex; model drift; TTS 4xx retry; image 503. | 221/221 |
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

**Android special access (all behind the same rationale → Settings → re-read flow):**

| Capability | Implementation |
|---|---|
| `notification_read` | `NotificationListenerService`; §12 modes (off / app + type / contact + app / contact + app + preview / available content); sensitive and OTP content hidden; excluded apps; per-action confirmation before reading |
| `notification_speak` | On-device `TextToSpeech` driven by the listener; skips excluded apps, security/banking alerts (unless included), quiet hours, locked phone and headphones-only rules; on/off by voice; honest "engine did not start" |
| `accessibility` | `AccessibilityService` global actions (Back, Home, Notifications, …), each verified by the window that appears afterwards; per-action confirmation |
| `screen_interaction` | Reads and taps nodes of the foreground app; skips password fields; refuses to read or tap security surfaces (Settings, permission controller, package installer, System UI, Play Store) and hides sensitive apps (banking, UPI, wallets, authenticators, password managers); verifies that a tap changed the screen |
| `usage_stats` | `UsageStatsManager` foreground time today, gated on the app-op |
| `default_assistant` | `ACTION_ASSIST` activity; role read back through `RoleManager` (API 29+) or the secure setting; only opens as the assistant while it holds the role |

Settings > Notifications exposes every §12 control; Settings > Permissions & Device Access lists
all 16 capabilities with live Android state and the Android/Web status from the registry.

**Shared Brain integration:**
- A backend action needing confirmation returns a server confirmation.
- Android and Web show the exact action and approve/decline *that id*. If the action changed
  before running (e.g. a different GitHub identity), a new confirmation is issued and nothing runs.

**Web UI:**
- Session gate; account panel (link / sign in / sign out).
- Permission Center and confirmation cards.
- GitHub connect/disconnect; real SSE progress.

## 3. Capability status (truthful; nothing is `WORKING`)

Every Android capability is implemented and `PARTIAL` in `shared/capability-registry.json`
(the backend, Web and Android all read this file). The note on each says it is not yet verified
on a real device. Web statuses: `microphone`, `files`, `photos` PARTIAL; `camera`, `location`,
`calendar` PLANNED; the rest UNSUPPORTED with the reason shown to the user.

| Capability | Risk | Confirmation | Android | Web | Emulator result (8.0 / 11 / 14) |
|---|---|---|---|---|---|
| `microphone` | MEDIUM | NONE | PARTIAL | PARTIAL | permission flow: **blocked** / pass / pass; deny keeps text input |
| `contacts` | MEDIUM | NONE | PARTIAL | UNSUPPORTED | Allow / Not Now / Learn More + Deny: **blocked** / pass / pass |
| `phone_call` | HIGH | PER_ACTION | PARTIAL | UNSUPPORTED | call placed only after ZARVIS confirmation (dialer accepted ACTION_CALL, telephony call state 2): pass ×3; permanent denial → Settings: **blocked** / pass / pass |
| `notification_read` | HIGH | PER_ACTION | PARTIAL | UNSUPPORTED | Settings page, grant, listener bind, revoke detected: pass ×3. §12 filtering of real notifications (3 shown, 1 sensitive hidden): API 30/34 only — API 26 has no shell `cmd notification post`, so 0 notifications were read there |
| `notification_speak` | MEDIUM | NONE | PARTIAL | UNSUPPORTED | skip rules (excluded app, headphones, quiet hours, security alerts, off) and voice on/off: pass. Real TTS output (`Spoken(chars=65)`): API 26 and 34. **API 30: the Google TTS engine is installed and visible but never started; ZARVIS reports "the text-to-speech engine did not start" instead of claiming speech** |
| `camera` | MEDIUM | NONE | PARTIAL | PLANNED | not driven on the emulator (system capture UI) — unverified |
| `files` | MEDIUM | NONE | PARTIAL | PARTIAL | not driven on the emulator (system picker) — unverified on Android |
| `photos` | MEDIUM | NONE | PARTIAL | PARTIAL | not driven on the emulator (system picker) — unverified on Android |
| `location` | MEDIUM | NONE | PARTIAL | PLANNED | **FAILED on all three** — honest "couldn't get a fix", even with `geo fix` injected. Unverified |
| `bluetooth` | MEDIUM | NONE | PARTIAL | UNSUPPORTED | API 30/34: opens Bluetooth Settings, never toggles it. API 26 image has no `BLUETOOTH_SETTINGS` handler → honest FAILED ("This phone couldn't open Bluetooth settings") |
| `alarms` | LOW | NONE | PARTIAL | UNSUPPORTED | handed to the Clock app; reminder notification delivered: pass ×3 |
| `calendar` | MEDIUM | NONE | PARTIAL | PLANNED | handed to the calendar app, or honest "no calendar app": pass ×3 |
| `accessibility` | VERY_HIGH | PER_ACTION | PARTIAL | UNSUPPORTED | service bind, global BACK/HOME/NOTIFICATIONS verified by the resulting window, revoke gates the pipeline: pass ×3 |
| `usage_stats` | HIGH | PER_ACTION | PARTIAL | UNSUPPORTED | real UsageStatsManager foreground time; revoke via appops detected: pass ×3 |
| `default_assistant` | MEDIUM | NONE | PARTIAL | UNSUPPORTED | role held/removed read back, `KEYCODE_ASSIST` opens ZARVIS's assist screen only while it is the assistant: pass ×3 |
| `screen_interaction` | VERY_HIGH | PER_ACTION | PARTIAL | UNSUPPORTED | reads Clock app, taps "Timer" and verifies the window changed; Settings (security surface) refused: pass ×3 |

"pass ×3" = passed on API 26, 30 and 34 emulators. Emulator passes are **not** real-device
verification.

## 4. Verification results

### 4.1 Emulator verification (Android 8.0 / 11 / 14)

CI workflow `.github/workflows/android-emulator.yml` boots Google-APIs emulators for **API 26
(x86), API 30 (x86_64) and API 34 (x86_64)**, installs the debug app and the instrumentation
APK, and runs `android/scripts/emulator/verify.sh`. Every test drives the real Android system
(real permission dialogs, real Settings pages, real services, real dialer, real Clock app) and
re-reads the state from Android afterwards. Each claim is printed as a `ZARVIS_EVIDENCE` line in
the job log.

| Phase | What it proves | API 26 (8.0) | API 30 (11) | API 34 (14) |
|---|---|---|---|---|
| A — `EmulatorSmokeTest`, `PermissionDialogFlowTest` | registry packaged, every state readable; Not Now → no system dialog; Learn More + Deny → DENIED; Allow → GRANTED; Deny twice → PERMANENTLY_DENIED → Settings → still denied; mic denied keeps text input; notifications per API level | **Platform-blocked** (see 4.3): Not Now and notifications-per-API pass; the 4 dialog tests are reported `UNVERIFIED`, never passed | pass | pass |
| B — `ProcessDeathTest` (two instrumentation runs) | process killed while a call waits for permission; new process *offers* "call 5551234", does not run it; dismissal clears it | pass | pass | pass |
| C — `revoke-kills-process.sh` | `pm revoke RECORD_AUDIO` while backgrounded: Android kills ZARVIS's live process; on restart the banner says "Microphone access was turned off in Android settings" | pass (active app process killed; see note) | pass | pass |
| D — `SpecialAccessTest`, `DeviceCapabilityTest` (13 tests) | notification access, spoken notifications, usage access, accessibility + screen interaction, default assistant, call, location, alarm, Bluetooth, calendar, reminder | 13/13 pass | 13/13 pass | 13/13 pass |
| E — `SettingsUiTest` | Settings > Notifications: all §12 controls render, taps persist, system Back returns to the hub; Permission Center lists all 16 capabilities with live state | pass | pass | pass |

Runs used as evidence (all on PR #78):

| Run | Commit | API 26 | API 30 | API 34 |
|---|---|---|---|---|
| [36523259172](https://github.com/jitendrakumarraj831-byte/ZarvisMobile/actions/runs/36523259172) | 6fee2d8 | warm-up proves the dialog crash (5→25 crashes, dialog never shown); B, D 13/13, E 2/2 | all phases pass | A–D pass; E failed (scroll) |
| [36524899277](https://github.com/jitendrakumarraj831-byte/ZarvisMobile/actions/runs/36524899277) | e83f464 | job green: A 3/3 + 4 dialog tests `UNVERIFIED platform-blocked` (26 System UI crashes, 0 dialogs); B, C, D 13/13, E 2/2 | job green: all phases | A–D pass; E failed (page-sized scroll skipped rows) |
| [36532044511](https://github.com/jitendrakumarraj831-byte/ZarvisMobile/actions/runs/36532044511) | 3c501d9 (latest) | **job green**: A 3/3 + 4 dialog tests `UNVERIFIED platform-blocked` (26 crashes, 0 dialogs); B, C (active pid 8408 killed), D 13/13, E 2/2 | **job green**: all phases | **job green**: A 7/7, B, C, D 13/13, E 2/2 (Permission Center rendered all 16) |

Note on C, API 26: ActivityManager's active `*APP*` record (pid 9133) was killed by the revoke
and no longer exists. One more process with the same name (pid 9006) stayed alive; it is the
process ActivityManager logged as `Spurious death for ProcessRecord{... 9006 ...}` when phase
B1 killed the app, i.e. an Android 8 bookkeeping leftover that holds no ZARVIS activity. It is
printed in the evidence line (`other_live_same_name=9006`), not hidden. The same pattern recurred on 3c501d9 (active
pid 8408 killed; pid 8267, not ActivityManager's `*APP*` record, stayed alive); the log tail
fetched for that run did not include the matching `Spurious death` line, so that leftover is
reported as observed, not explained. This scenario is not counted as a real-device result.

"pass" means the test asserted Android's own state after the action. A pass does not mean the
capability is `WORKING`: no capability is promoted without a real device.

### 4.2 Regression suites (re-run after the last change)

| Suite | Result |
|---|---|
| Backend `vitest` (in-memory + real Postgres 16), incl. new route-auth and client↔backend contract guards | **226 / 226** passed; the 2 opt-in live tests skipped (no credentials) |
| Backend `tsc --noEmit`, root/Vercel `tsc` | clean |
| Registry export in sync (`capabilities:export` + `git diff --exit-code shared`) | in sync |
| Web `node --check` (app, logic, sw) + logic unit tests | clean, **6 / 6** |
| Web Playwright E2E in Chromium (real backend + Postgres + GitHub API stub) | **14 / 14**, no console/CSP errors |
| Android `:domain:test` | **117 / 117** |
| Android data-layer JVM tests, `assembleDebug`/`assembleRelease`/`bundleRelease` | CI (`android-build.yml`) — the Android SDK cannot be downloaded in this sandbox |
| Windows + Git Bash: driver self-test + both APKs via `build-apks.sh` (`android-windows.yml`) | self-test **12 / 12**; fresh-checkout build **successful in 7 m 39 s**, no stall |
| Device driver self-test on Linux (`scripts/device/selftest.sh`) | **12 / 12** |

Security, denial/revoke and lifecycle suites are unchanged from the previous report and still
run inside the numbers above (`phase1Security.test.ts`, `postgresTls.test.ts`,
`AccessCoordinatorTest`, `RevocationAndRecoveryTest`, confirmation replay/expiry/identity tests).

### 4.3 Android 8.0: the permission-dialog failure is the emulator image, not ZARVIS

Evidence (API 26 job log, run 36523259172, and every earlier API 26 run):

```
FATAL EXCEPTION: main
Process: com.android.systemui
java.lang.NullPointerException: Attempt to invoke virtual method
  'void com.android.systemui.statusbar.phone.NavigationBarFragment.onKeyguardOccludedChanged(boolean)'
  on a null object reference
  at com.android.systemui.statusbar.phone.StatusBar.onKeyguardOccludedChanged(StatusBar.java:3843)
  at com.android.systemui.statusbar.phone.StatusBarKeyguardViewManager.setOccluded(StatusBarKeyguardViewManager.java:277)
  at com.android.systemui.keyguard.KeyguardViewMediator.handleSetOccluded(KeyguardViewMediator.java:1176)
  at com.android.systemui.keyguard.KeyguardViewMediator$4.handleMessage(KeyguardViewMediator.java:1531)
  at android.os.Handler.dispatchMessage / Looper.loop / ActivityThread.main / ZygoteInit.main
```

- Every frame is in System UI; there is no ZARVIS frame. The null field is System UI's own
  navigation-bar fragment.
- It is triggered only when Android shows its own `GrantPermissionsActivity`. Ruled out one at
  a time: disabling the lock screen (`locksettings set-disabled true`) did not stop it; launching
  activities with `am start` did not trigger it; launching through `ActivityScenario` did not
  trigger it; requesting a permission did, every time.
- A dedicated warm-up (`SystemWarmUp`, not evidence) requested one permission 4 times per
  attempt, 5 attempts: System UI crashed 5 more times on every attempt (5 → 25 in total) and
  the permission dialog was never displayed (`permission dialog shown=false` in all rounds).
  It never settles, so this is a property of the image.
- Android 11 and 14 run the identical ZARVIS code and pass all permission-dialog tests.

Deterministic strategy (`verify.sh`): on API < 28, after the warm-up, if the permission dialog
never appeared and System UI crashed, phase A runs the tests that do not need Android's dialog
as normal, runs the four dialog tests separately, and records
`ZARVIS_EVIDENCE sdk=26 permission_dialog_flow UNVERIFIED platform-blocked (...)`. Those four
results are never counted as passes; the runtime-permission flow on Android 8.x stays
unverified until it is run on a real Android 8/9 device.

### 4.4 Bugs found by the emulator runs and fixed in ZARVIS

| Bug (real, in product code) | Found on | Fix |
|---|---|---|
| Permission recorded as "requested" even when Android returned no answer (dialog dismissed/covered) → next request misread as **permanently denied** | API 26 | `ActivityBridge.request` marks only the permissions Android actually answered |
| Notification-access revocation not detected (stale `NotificationManagerCompat` listener cache) | API 26 | `SpecialAccessStates` reads `isNotificationListenerAccessGranted` (API 27+) or the secure setting fresh |
| "No TTS engine" on Android 11+ although Google TTS is installed (package visibility) | API 30 | `<queries>` for `TTS_SERVICE`; engine start timeout with an honest message |
| Screen reading/tapping saw only the topmost window of a multi-window app (Clock popup) | API 34 | Reads and taps across all of the foreground app's windows |
| Settings sub-page: system Back left Settings instead of returning to the hub | phase E | `BackHandler` in `SettingsScreen` |

Test-harness problems (not product bugs) fixed along the way: UiAutomation unbinding ZARVIS's
accessibility service (now `FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES`); `am start -W` hanging
behind the Android 8 crash dialog; Android 14 edge swipes acting as Home; blind page-by-page
scrolling on the 320×640 image (the Settings test now uses Compose's scroll-to-node and drives Home
through Compose, since the Compose test rule owns the frame clock); the revoke check reading ActivityManager's
active process record instead of every process with the package name.

## 5. Real-device status

**Not done — this blocks PASS.** This session runs in a cloud container: `adb` is not installed,
there is no USB bus (`/dev/bus/usb` does not exist) and no device farm credentials, so no
physical phone can be reached from it. Nothing below is claimed as verified.

### 5.1 How to run it (ready, not yet run)

`android/scripts/device/verify-device.sh` runs the same phases A–E as the emulator CI against
a real phone plugged into the computer that runs it (with the backend on `localhost:3000`):

```bash
cd backend && PORT=3000 npm run dev          # terminal 1
cd android && ZARVIS_DEVICE_RESET_OK=1 bash scripts/device/verify-device.sh   # terminal 2
# optional: ZARVIS_TEST_CALL_NUMBER=<a number you own> to include the real-call test
```

The emulator driver would have been harmful on a personal phone, so device mode differs:

| Emulator behaviour | On a physical phone |
|---|---|
| Disables the lock screen | Never touched; the phone must be unlocked by its owner |
| `adb emu geo fix` fake GPS | Real location; coordinates redacted from the logs |
| Calls 5551234 for real | No call unless `ZARVIS_TEST_CALL_NUMBER` is given; otherwise recorded `UNVERIFIED` (JUnit assumption, never a pass) |
| Overwrites notification access, accessibility services and the default assistant | Current values saved first and restored on exit (also on failure / Ctrl-C); the restore is re-read and any difference printed with what to re-select |
| Backend at `10.0.2.2` | Debug build pointed at `127.0.0.1` + `adb reverse tcp:3000` |

It refuses to run on an emulator, with more than one device, without the backend, or without
explicit consent (`ZARVIS_DEVICE_RESET_OK=1`, since ZARVIS is uninstalled for a fresh-install
run). Run here, it stops at "adb not found".

### 5.2 What a device run must cover (the §22A real-device gate)

| Item | Covered by | Emulator result | Real device |
|---|---|---|---|
| Runtime permission Allow / Not Now / Learn More + Deny | Phase A | pass (11, 14); 8.0 platform-blocked | **not run** |
| Permanently denied → Settings → still denied | Phase A | pass (11, 14) | **not run** |
| Revocation from Settings while backgrounded | Phase C | pass ×3 | **not run** |
| Process death while an action waits; offered, not run | Phase B | pass ×3 | **not run** |
| Permission Center (16 capabilities, live state) | Phase E | pass ×3 | **not run** |
| Notification access, §12 privacy modes, OTP/banking hidden | Phase D | pass (11, 14; 8.0 without real notifications) | **not run** |
| Spoken notifications | Phase D | real speech on 8.0 and 14; engine never started on 11 | **not run** |
| Location | Phase D | **no fix on any emulator** | **not run** |
| Special access: accessibility, screen interaction, usage, default assistant | Phase D | pass ×3 | **not run** |
| Structured tool results + Brain → capability → permission → ToolPipeline → execution → verification | Phases A–D (every test goes through `orchestrator.handleTurn` / `ToolPipeline` and asserts status + `verificationEvidence`) | pass ×3 | **not run** |
| Phone call placed only after ZARVIS's confirmation | Phase D | pass ×3 (emulator dialer) | **not run** (needs a number the tester owns) |
| Truthful capability states | registry + Phase E | every Android capability `PARTIAL`, none `WORKING` | promote to `WORKING` only after a device pass |

Required device matrix: at least one Android 8/9 phone (the only way to verify the runtime
permission dialogs on 8.x), one Android 11/12 and one Android 13+. The harness opens the
document picker, photo picker and camera and backs out (cancel must not be a success); choosing
a real file/photo or taking a real picture is a manual check on the device (§5.5).

### 5.3 External integrations

| Integration | Needed for Phase 1? | State | How to verify safely |
|---|---|---|---|
| Gemini TTS with a real key | Not a Phase 1 capability (voice is Phase 3), but part of "live paths unverified" | Unit-tested against mocked HTTP only; no key in this environment | `backend/test/live/geminiTts.live.test.ts` — opt-in (`ZARVIS_LIVE_TESTS=1 GEMINI_API_KEY=<test key>`); checks a real WAV of plausible length. Skipped here |
| Real authorized GitHub write / PR | Developer-agent authorization (deep-scan Critical item) | Tested against a local GitHub stub (E2E) only | `backend/test/live/githubWrite.live.test.ts` — opt-in with a token scoped to a throwaway sandbox repo you own (`ZARVIS_LIVE_GITHUB_TOKEN`, `ZARVIS_LIVE_GITHUB_TEST_REPO`); checks push access, branch, commit and PR, then closes the PR and deletes the branch; refuses the ZARVIS repo. Skipped here |
| Google Play Billing | Not a Phase 1 capability | Backend verifier (Play Developer API v3) unit-tested with mocks; production without credentials fails closed. **The Android app has no Play Billing client at all** (the subscription screen says "pricing coming soon") | Needs a Play Console app, a subscription product, a license-tester account, a Play-distributed build and `PLAY_BILLING_SERVICE_ACCOUNT_JSON` — none exist for this repository; cannot be tested honestly yet |

### 5.4 Pre-verification audit (before the first physical-device run)

A full re-scan before the Nothing Phone 2A run (Windows + Git Bash host). Every finding was
fixed in this PR; nothing in Phase 1 was removed or weakened to make a check pass.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | `verify-device.sh` counted devices with `awk '$2=="device"'`; on Windows `adb.exe` ends lines with `\r`, so a connected phone was reported as "found 0" | strip `\r` before parsing; self-test drives the driver with a fake adb that prints `\r` |
| 2 | High | Git Bash rewrites `/sdcard/…` arguments into `C:/Program Files/Git/sdcard/…` before they reach `adb.exe` | `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'` in every driver script |
| 3 | High | No `.gitattributes`: with `core.autocrlf=true` (Git for Windows default) `gradlew` and the `.sh` scripts are checked out with CRLF and bash cannot run them | `.gitattributes` forces LF for `*.sh`/`gradlew`; the build script detects CRLF and prints the fix |
| 4 | High | Build could hang forever (the reported 2 h+ `compileDebugKotlin`) with no diagnostics | `scripts/device/build-apks.sh`: stops stale Gradle/Kotlin daemons first, no-progress watchdog (`ZARVIS_BUILD_TIMEOUT_MIN`, default 40), saves `jps`/`jstack` thread dumps to `build/build-diagnostics/`, stops daemons and exits 124; `--profile` task timings; see §5.6 |
| 5 | Medium | Debug APK's backend port could differ from the `adb reverse` port | the driver builds with `-Pzarvis.devApiPort=$ZARVIS_BACKEND_PORT` |
| 6 | Medium | Emulator/device driver left a background `adb logcat` running after exit | killed on EXIT trap |
| 7 | High (truthfulness) | Conversation UI showed "Done" for any `success=true` result, including `USER_ACTION_REQUIRED` hand-offs | "Done" only for status `COMPLETED` |
| 8 | Medium | Files / photos / camera had no automated coverage | `DeviceCapabilityTest` g/h/i: the request must open Android's own picker/camera, and backing out must be `FAILED` ("nothing was read"), never `COMPLETED` |
| 9 | Medium | Startup error on a phone built for `127.0.0.1` gave no hint that it needs `adb reverse` | debug-only hint explains `adb reverse` / LAN IP |
| 10 | Guard | No test proved every non-public backend route requires auth | `routeAuthCoverage.test.ts` walks the Express router: every route except the 6 public ones returns 401 without a token |
| 11 | Guard | No test that the Android (Retrofit) and Web (`apiFetch`) clients call routes that exist | `clientContract.test.ts`: every client endpoint exists with the same method |

Audited and clean: no `TODO`/`FIXME`; no client-side `confirmed` flag (confirmation is a one-time
server/`ToolPipeline` token); no capability `WORKING` anywhere (tests enforce it); all 15 Android
skills map to a registry capability (microphone is the voice path); applicationId
`com.zarvismobile.app` everywhere; no stale script paths; every JVM-test module runs in CI;
`ActivityBridge` waits are bounded except while the user keeps a system picker open (by design);
manifest permissions match the capabilities (camera/photos/files use system intents and need no
runtime permission).

### 5.5 Nothing Phone 2A checklist (tomorrow)

Setup: phone language English, unlocked, USB debugging on, location on, notifications cleared;
one terminal `cd backend && PORT=3000 npm run dev`, another in Git Bash:

```bash
cd android
ZARVIS_BUILD_ONLY=1 bash scripts/device/verify-device.sh          # 1. build only, watchdog on
ZARVIS_DEVICE_RESET_OK=1 bash scripts/device/verify-device.sh      # 2. full run (add ZARVIS_TEST_CALL_NUMBER=<your own number> for the real call)
# if the build stalls: attach build/build-diagnostics/ and retry with
ZARVIS_GRADLE_ARGS="-Pkotlin.compiler.execution.strategy=in-process" ZARVIS_BUILD_ONLY=1 bash scripts/device/verify-device.sh
```

Automated on the phone (phases A–E): runtime permission Allow / Not now / Learn more / Deny and
permanently-denied → Settings; revocation while backgrounded; process death with a pending
action; Permission Center (16 capabilities, live state); notification access + §12 privacy
(OTP/banking hidden); spoken notifications; location (real fix); accessibility, screen
interaction, usage stats, default assistant; reminders delivered by Android; alarm, calendar and
Bluetooth hand-offs;
call only after ZARVIS confirmation; file/photo picker and camera open the system UI and cancel is
not a success. The driver restores notification access, accessibility, default assistant and
screen timeout afterwards and prints any difference.

Manual on the phone (not driven by the harness), record each with a screenshot:
1. Pick a real document and a real photo → ZARVIS reports its name/type, nothing uploaded.
2. Take a real photo → result reported; cancel → "nothing was read".
3. Nothing OS permission dialogs look like AOSP (ids `permission_allow_*`); if a test cannot find
   a button, note the Android/Nothing OS version and screenshot the dialog.
4. Battery optimisation (Nothing OS): after the run, confirm reminders still fire with the screen off.
5. Web ↔ Android shared Brain: sign in to the same account on the Web client and check the
   conversation appears on both.
6. After the run: Settings → Notifications → Device & app notifications, Accessibility, Default
   apps → Digital assistant are back to what they were before.

Evidence to send back: `android/build/emulator-evidence/`, `android/build/build-diagnostics/`,
the driver's console output. Only with that evidence can a capability move from `PARTIAL` to
`WORKING`, and only then can §22A's real-device row be re-assessed.

### 5.6 The 2 h+ `compileDebugKotlin` hang — investigation

**Not reproducible on a clean Windows machine; not an intrinsic build hang.** The same commit,
on `windows-latest` with Git Bash and Temurin JDK 17, through the exact script the device driver
uses (`build-apks.sh`), built both APKs from a fresh checkout in **7 m 39 s** (405 tasks, 340 executed, 65 from the
Gradle cache; every `compileDebugKotlin` progressing normally); Linux CI builds them in 4–7 min. A second run in the
same job (fresh daemons, same tree) is now also required to pass, to prove the build repeats.

The root cause on the tester's computer is therefore environmental and cannot be named without
that machine's thread dumps. The CI log does show one relevant signal: `w: Detected multiple
Kotlin daemon sessions` — session files left by an earlier Kotlin daemon. A Gradle daemon that
reconnects to a Kotlin compile daemon wedged by an earlier interrupted build (Windows file
locks) blocks in `compileDebugKotlin` with no output, which matches the report. Other
candidates: memory pressure (`-Xmx2048m` Gradle daemon + an equally sized Kotlin daemon on a
low-RAM laptop), antivirus scanning `build/`, a OneDrive-synced checkout.

What changed so it cannot hang silently again:
- `build-apks.sh` stops this project's Gradle daemons and any Kotlin compile daemon before
  building (`ZARVIS_KEEP_DAEMONS=1` skips it) — removes the stale-daemon cause;
- a no-progress watchdog (`ZARVIS_BUILD_TIMEOUT_MIN`, default 40) saves `jps` + `jstack` of the
  Gradle and Kotlin daemons to `android/build/build-diagnostics/`, stops them and exits 124;
- `--profile` task timings in `android/build/reports/profile/`;
- JDK check (the modules compile with `jvmToolchain(17)`) and CRLF check on `gradlew`;
- fallback that avoids the Kotlin daemon entirely:
  `ZARVIS_GRADLE_ARGS="-Pkotlin.compiler.execution.strategy=in-process"`.

If it stalls tomorrow, the diagnostics folder names the stuck thread; that is the evidence
needed to fix the real cause.

## 6. Other bugs fixed (earlier in this PR)

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

- No real-device verification (§5).
- Android 8.x runtime-permission dialog flow: unverified (emulator platform bug, §4.3).
- Location: no fix on any emulator even with injected coordinates; ZARVIS reports the failure
  honestly. Unverified.
- Spoken notifications on the API 30 image: the TTS engine never starts; reported as a
  failure, not as speech.
- Camera / files / photos pickers are not driven by the emulator tests.
- `notification_read` §12 filtering of real notifications is only exercised on API 30/34
  (API 26 has no shell notification poster).
- The rate limiter is in-memory per instance; serverless instances do not share limits.
- Gemini TTS and GitHub are tested against stubs/mocks only; opt-in live tests exist
  (`backend/test/live/`) but have not been run (no test credentials here).
- Play Billing: the Android app has no Play Billing client; the backend verifier has never
  been exercised against Google's API. Not a Phase 1 capability.
- Web Permission Center: only the microphone is a browser permission; the others are labelled
  per the registry (mostly UNSUPPORTED/PLANNED on the web).

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

# Android emulator verification (CI: .github/workflows/android-emulator.yml)
cd android
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest -Pzarvis.devApiHost=10.0.2.2
bash scripts/emulator/verify.sh <api-level>   # with one emulator attached; prints ZARVIS_EVIDENCE lines

# Physical phone (on a computer with the phone attached; see §5.1, §5.5)
ZARVIS_BUILD_ONLY=1 bash scripts/device/verify-device.sh      # APKs only, with the hang watchdog
bash scripts/device/selftest.sh                                # driver restore guarantee, no phone
ZARVIS_DEVICE_RESET_OK=1 bash scripts/device/verify-device.sh

# Opt-in live integration checks (test credentials only; skipped otherwise)
cd backend
ZARVIS_LIVE_TESTS=1 GEMINI_API_KEY=... npx vitest run test/live/geminiTts.live.test.ts
ZARVIS_LIVE_TESTS=1 ZARVIS_LIVE_GITHUB_TOKEN=... ZARVIS_LIVE_GITHUB_TEST_REPO=https://github.com/<you>/<sandbox> \
  npx vitest run test/live/githubWrite.live.test.ts
```

CI runs all of the above on every push to the PR: `.github/workflows/backend-tests.yml` (backend,
web, web-e2e), `.github/workflows/android-build.yml`, `.github/workflows/android-emulator.yml` and
`.github/workflows/android-windows.yml` (Windows + Git Bash build and driver self-test).

## 9. To reach Phase 1 PASS

1. Run `scripts/device/verify-device.sh` on the device matrix in §5.2 and record the evidence
   per capability. Promote a capability to `WORKING` only with that evidence.
2. Verify the Android 8.x runtime-permission flow on a real Android 8/9 device.
3. Get a real location fix on a device (and re-check the emulator failure).
4. Run the opt-in live tests with test credentials: Gemini TTS, and a GitHub write on a
   throwaway sandbox repo.
5. Play Billing (outside Phase 1): add a Play Billing client to the app, then verify with a
   license tester on a Play test track.
