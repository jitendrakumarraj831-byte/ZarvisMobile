# MYRA feature claims vs ZarvisMobile `main` — evidence matrix

Compared: ZarvisMobile `main` @ `aff374c` (PR #96 merge; this branch has no code change on top) against the
README of [`codeninjavik/MYRA-AI-ASSISTANT-`](https://github.com/codeninjavik/MYRA-AI-ASSISTANT-) @ `4f8cd94`.
Date: 2026-10-15. Nothing was merged to `main`. No code was changed; this is a documentation-only PR.

## 0. Ground rules and the biggest finding

- **MYRA's repository has no source code.** It holds `README.md`, `LICENSE` and five images. The README's
  "Project Structure" (`myra/ai`, `voice`, `automation`, `vision`, `screen_reader`, `system_control` …) is
  not in the repository; the software is installed with `pip install myra-ai-assistant` and is
  activation-key gated ("Premium"). So **every MYRA claim is UNVERIFIED on MYRA's side**: there is nothing
  to read, and I did not install or run the PyPI package. Screenshots prove a UI exists, not that any
  listed feature works.
- MYRA targets a **Windows desktop** (Python, Windows APIs). ZarvisMobile is a **web + Android** product
  with a Node/TypeScript backend. A Windows row below is therefore MISSING in ZarvisMobile by design, not by
  accident, unless it says otherwise.
- Status words (about ZarvisMobile, never about MYRA):
  - **IMPLEMENTED** — code on `main` and an automated test that exercises it. Where a real phone is the
    only honest proof, the row says so and it is not called IMPLEMENTED.
  - **PARTIAL** — part of the claim exists, or it exists but is not proven on the target (e.g. real device).
  - **MISSING** — no code on `main`. A design document does not count.
  - **UNVERIFIED** — I could not determine it from the evidence available (stated per row).
- Existing project policy is the same: `shared/capability-registry.json` marks no Android capability
  WORKING, because "WORKING only with real verification evidence" (`backend/src/capabilities/registry.ts:11-14`).
  This document does not override that.

## 1. Tests run for this document (on `aff374c`)

| Suite | Result | Notes |
|---|---|---|
| `backend`: `tsc --noEmit` | clean | |
| `backend`: `npx vitest run` (in-memory store) | **1165 passed, 21 skipped, 0 failed** (89 files; 4 files skipped: Postgres / live-credential) | covers `test/tts/*`, `test/tasks/*`, `test/skills/*`, `test/capabilities/*` |
| `web`: `node --test tests/*.test.js` | **76 / 76** | |
| `android`: `./gradlew :domain:test` | **NOT RUN here** — Maven Central answered HTTP 429 through the sandbox proxy | Not a code result. CI `Android build` on the same commit: success (run 38732789249) |
| CI on `aff374c` (GitHub Actions) | `Android build` success, `Backend + Web checks` success, `Live preview API smoke test` success, CodeQL success; `Edge TTS live audit` **skipped** | skipped = the live voice audit did not run for this commit |
| Real Android phone | **NOT TESTED** | no device or USB in this environment |
| Real Windows machine | **NOT TESTED / nothing to test** | see §5 |

Not re-run (CI-only, cited as CI results): web Playwright E2E, emulator API 26/30/34, Postgres suite.

## 2. Matrix — MYRA README claims

Columns: MYRA claim → ZarvisMobile status → evidence (source) → evidence (tests) → gap.

### 2.1 Voice (priority 1: reliable free voice/TTS)

| MYRA claim | Status | Source | Tests | Gap / limitation |
|---|---|---|---|---|
| Text-to-speech / "Human-like voice" | **IMPLEMENTED** (server voice) · **PARTIAL** (on a phone) | `backend/src/tts/{edgeTtsProvider,geminiTtsProvider,fallbackTtsProvider,ssml,voices}.ts`, `api/routes/tts.ts`, `config/ttsConfig.ts`; web `web/app.js` (`/tts/synthesize`, `/tts/synthesize-stream`); Android `app/voice/AndroidTextToSpeechEngine.kt` | `backend/test/tts/*` (11 files, ~230 tests, all green); `web/e2e/tts-audit.cjs` (real Chromium); CI `smoke`: WAV returned from the preview | **Not free-guaranteed**: Edge neural voice is an unofficial Microsoft endpoint that has already returned HTTP 403 for this deployment once (`PRODUCTION_AUDIT_2026-10-14.md` §5). Fallback Gemini voice has a small quota and sends the spoken text to Google (opt-out `TTS_FALLBACK_PROVIDER=none`, then replies are text-only). Audio **quality on Gemini and on a phone speaker was never heard by a test** (`ZARVIS_PRODUCTION_READINESS.md` row "TTS: real audio on a phone — NOT TESTED"). Android has no on-device TTS fallback for chat replies by design ("no silent switch to a different voice engine") |
| Hindi / multi-language voice | **IMPLEMENTED** (en, hi, Hinglish voice selection) | `backend/src/tts/voices.ts`, `ssml.ts` | `voices.test.ts`, `ssml.test.ts`, `ttsRoutes.test.ts`, `tts-audit.cjs` | Only en/hi/Hinglish; other languages MISSING. Hinglish detector is heuristic |
| Speech recognition | **PARTIAL** | Web: `web/app.js` `setupSpeechRecognition` (browser `SpeechRecognition`, Chrome-class only); Android: `app/voice/AndroidSpeechToTextEngine.kt` | web quality E2E "voice UI" with stubs; Android: `DeviceCapabilityTest` (emulator) | Registry marks microphone PARTIAL on both; Android "not yet verified on a real device". Recognition is the platform's, not ZarvisMobile's; accuracy untested |
| Wake word | **MISSING** (deliberate) | `backend/src/capabilities/registry.ts` microphone → `unsupportedActions: ["Wake word", "Background or continuous listening"]` | n/a | Not planned in code. Needs a foreground-service design and a privacy decision first |
| Real-time voice conversation | **PARTIAL** | tap-to-talk → chat turn → streamed TTS (`/tts/synthesize-stream`, ordered segments, Stop cancels) | `quality.e2e.cjs` voice check, `tts-audit.cjs` | Turn-based, not full-duplex / barge-in streaming audio |
| Multi-language support (UI) | **PARTIAL** | `web/i18n.js` (lazy Hindi dictionary) | `web/tests/i18n.test.js` | English + Hindi only; Android strings not fully localized (UNVERIFIED — not audited here) |

### 2.2 AI intelligence

| MYRA claim | Status | Source | Tests | Gap |
|---|---|---|---|---|
| Gemini integration | **IMPLEMENTED** | `backend/src/ai/geminiProvider.ts`, `modelGateway.ts` | `test/ai/geminiProvider*.test.ts`, `geminiErrors.test.ts`, gateway tests; CI smoke "real Gemini answer" | Live quota limits observed (`ZARVIS_FINAL_MERGE_GATE.md`) |
| OpenRouter integration | **IMPLEMENTED** | `ai/openRouterProvider.ts`, `openRouterModels.ts` | `test/ai/openRouter*.test.ts` | Live OpenRouter probe is label-gated and was skipped in CI; "free model available" depends on the account (code warns when none, `f9f8c34`) |
| Context-aware conversations, "AI memory system" | **IMPLEMENTED** (server-stored conversations + Memory screen) | `backend/src/api/routes/conversations.ts`, Android `MemoryViewModel.kt`, `MemoryApi` | `test/api/*`, `MemoryApiTest.kt`, `MemoryViewModelTest.kt` | Not verified that memory improves answers; it stores/recalls records |
| Deep research | **PARTIAL** | `skills/webSearch.ts`, `researchReport.ts`, `researchCompare.ts`, `researchOutline.ts` | `test/skills/research.test.ts`, `fallbackSearch.test.ts`, `searchProviderChoice.test.ts` | Web search is a bounded model-assisted search, not a multi-source crawl; live search met per-minute Gemini limit once |
| "Intelligent task execution" | **PARTIAL** | see §2.5 | | |

### 2.3 Screen reading, vision, camera

| MYRA claim | Status | Source | Tests | Gap |
|---|---|---|---|---|
| Real-time screen reading / UI understanding (Windows) | **MISSING** on Windows; **PARTIAL** on Android | Android `ZarvisAccessibilityService.kt` (`readScreen`, skips password fields, refuses sensitive apps); registry `screen_interaction` | `SpecialAccessTest.kt` (emulator), `SpecialAccessSkillsTest.kt` (unit) | Reads the visible text of one foreground app, per-action confirmation, not real-time, not on a real device. No Windows implementation |
| OCR text extraction | **PARTIAL** | Photos are sent to the vision model (`ai/geminiVision.ts`, `documents/processUpload.ts`); PDFs/DOCX via `unpdf`/`mammoth` | `test/documents/*`, `test/ai/modelGatewayStreamingVision.test.ts`, `camera.e2e.cjs` | No dedicated OCR engine; text-in-image is whatever the vision model returns. Not verified on a phone ("camera and describe-a-photo never run on a real phone", audit §2) |
| Camera access, image analysis, visual Q&A | **PARTIAL** | web camera sheet `web/app.js`; Android `photo/ApiPhotoDescriber.kt`; `ai/imageAnalysisPrompts.ts` | `web/e2e/camera.e2e.cjs` 7/7 (simulated camera), `PhotoDescriptionResultsTest.kt` | One photo on request; no live video, no object-detection model |
| Object detection / scene understanding | **UNVERIFIED** | Delegated to the vision LLM; no detector code | none targeting detection quality | Quality is the model's; not measured |

### 2.4 Windows desktop control (priority 3: secure PC Companion)

| MYRA claim | Status | Evidence |
|---|---|---|
| Volume, brightness, system/performance monitoring, window mgmt, clipboard, keyboard & mouse automation, open/close Windows apps, file create/delete/rename/move/organize on the PC | **MISSING** | No Windows/PC-agent code anywhere in the repo (searched `windows`, `desktop`, `companion`, `pyautogui`, `pc control`, whole tree). The only "Windows" in the repo is CI: `.github/workflows/android-windows.yml`, which builds the Android APK from Git Bash and self-tests `verify-device.sh`. `ZARVIS_MASTER_PRODUCT_BLUEPRINT.md` says "desktop" only for the browser workspace |
| Same, "secure" | **MISSING** | See §5 for a proposed architecture. It is a design, not code |

### 2.5 Automation and task engine (priority 4: verified task automation)

| MYRA claim | Status | Source | Tests | Gap |
|---|---|---|---|---|
| Workflow automation / task scheduling | **PARTIAL** | `backend/src/skills/automation{Create,List,Cancel}Workflow.ts`; `tasks/taskService.ts`, `taskRunner.ts`, `taskState.ts`; Android `feature-tasks` | `test/tasks/*` (taskRunner 19, taskRace 4, service 6, cancel-aborts-run 2), `test/skills/automation.test.ts` (11); `TasksViewModelTest.kt` | **User-driven, one step per click; nothing runs in the background or on a schedule** (`taskRunner.ts` doc: "Nothing runs in the background and nothing chains on its own"). A step that used no tool is recorded DONE with evidence "model reply only". So: tracked and verified, **not autonomous**, and "task scheduling" (cron/timers) is MISSING server-side. Android reminders exist (`ReminderSkillFactoryTest`, `BootRescheduleReceiver`) and are PARTIAL on real devices |
| Open applications (Android) | **PARTIAL** | `domain/.../skill/PhoneOpenAppSkillFactory*`, `DeviceCommandGate` | `PhoneOpenAppSkillFactoryTest`, `DeviceCommandGateTest`, `DeviceCapabilityTest` (emulator) | Not real-device verified |
| Close applications, execute arbitrary commands, keyboard/mouse | **MISSING** (and for Android: deliberately unsupported — "Typing, swiping, multi-step automation or acting in the background") | registry `screen_interaction.unsupportedActions` | n/a | Safety choice, documented |
| Stale doc | note | `automationCreateWorkflow.ts` header says it "does not execute" steps, but `TaskRunner` now runs one step on request. Comment is out of date (not changed here, to keep this PR docs-only) |

### 2.6 Files, communication, web, website generation, UI

| MYRA claim | Status | Source / tests | Gap |
|---|---|---|---|
| File mgmt on the PC | **MISSING** | — | Server-side workspace files (upload, list, delete) are IMPLEMENTED for the user's cloud workspace: `api/routes/files.ts`, `test/workspace/*`; that is not PC file control |
| WhatsApp messaging, contact mgmt, smart replies | **PARTIAL / not as claimed** | Android: *open* WhatsApp (`phone.open_app`), find a contact, place a confirmed call (`phone_call`). Smart reply drafts: `skills/businessCustomerReply.ts`, `creativeWriteMessage.ts` | **No sending of WhatsApp or SMS messages anywhere.** Contacts are read-only. Message automation MISSING |
| News search / information retrieval / browsing assistance | **PARTIAL** | `skills/webSearch.ts` (`fallbackSearch.test.ts`) | Search, not browsing |
| Website generation / code generation / deployment guidance | **PARTIAL** | `skills/developerImplement.ts`, `developerAnalyzeRepo.ts`, `github/*` (opens PRs through the user's GitHub token) | `developerImplement.test.ts`, `test/github/*`. Generates code changes for a GitHub repo; no site scaffolding/publishing |
| Modern UI, animations, waveform, dashboard, status monitoring | **IMPLEMENTED** (web + Android) | `web/`, `android/core/core-ui` (AiOrb), Aurora Glass pass | `quality.e2e.cjs` (axe, responsive), `css.test.js`, `AiOrb` | Waveform: orb animation, not an audio-reactive waveform (UNVERIFIED) |
| Login, activation key / premium | **IMPLEMENTED** (different model) | accounts + Razorpay / Play Billing: `auth/*`, `billing/*` | `test/auth/*`, `test/billing/*` | Subscriptions, not activation keys. Live email sign-up was NOT TESTED per `FINAL_PHASE1_VERIFICATION.md` |

## 3. Priority 2 — real-device Android Phone Agent verification

What exists on `main` (not duplicated here): `android/scripts/device/verify-device.sh` (+ `build-apks.sh`, `selftest.sh`), run
against a USB phone; it saves and restores the phone's settings, never touches the lock screen, places no call without
`ZARVIS_TEST_CALL_NUMBER`, and records anything it cannot prove as `UNVERIFIED`. The same instrumentation suite
(`SpecialAccessTest`, `DeviceCapabilityTest`, `PermissionDialogFlowTest`, `SettingsUiTest`, `ProcessDeathTest`, `ChatSyncTest`)
passes on emulators API 26/30/34 in CI (`android-emulator.yml`) — **emulator results are never counted as device results.**

| Phone-agent capability | Code | Unit/JVM test | Emulator (CI) | **Real device** |
|---|---|---|---|---|
| Open app, find contact, call (confirmed) | yes | yes | yes (call intent accepted) | **NOT TESTED** (call: UNVERIFIED without a number) |
| Reminders / alarms | yes | `ReminderTimeParserTest`, `ReminderSkillFactoryTest` | yes | **NOT TESTED** (OEM battery killers, exact-alarm permission) |
| Notification read + speak | yes | `NotificationPrivacyTest` | yes | **NOT TESTED** (restricted-settings on sideload) |
| Accessibility read / tap / global actions | yes | `SpecialAccessSkillsTest` | yes | **NOT TESTED** (Nothing OS behaviour unknown) |
| Default assistant gesture | yes | — | yes | **NOT TESTED** |
| Camera, photo picker, describe photo | yes | `PhotoDescriptionResultsTest` | picker/camera limited | **NOT TESTED** |
| Location, Bluetooth, calendar, usage stats | yes | `DeviceCapabilitySkillsTest` | yes | **NOT TESTED** |
| Voice in/out | yes | — | engines start | **NOT TESTED** (audio audibility cannot be asserted by adb) |

Target device named in the project docs: Nothing Phone 2A. **Remaining limitation:** no run has ever been recorded;
`ZARVIS_FINAL_MERGE_GATE.md` lists this as a merge blocker. Procedure to close it is `verify-device.sh` plus the manual
checks the script itself cannot assert (hearing the voice, seeing the camera frame). I added no new device script because
the existing one already does what is needed.

## 4. Priority 1 detail — what "reliable free voice" means today

| Path | Cost | Status |
|---|---|---|
| Edge neural voice (default, server-side) | free, unofficial endpoint | has a probe workflow (`edge-tts-probe.yml`, label/manual) but the live audit was skipped on `aff374c`; blocked once (403) per the 2026-10-14 audit; protected by token logic + fallback |
| Gemini voice (fallback, default on) | free tier, small quota | tested against a local stand-in only; live audio quality untested |
| `TTS_FALLBACK_PROVIDER=none` | free | text-only when Edge is down; verified to fail cleanly |
| Browser/Android on-device TTS | free, offline | **intentionally not a fallback** (`web/app.js`: "Browser speechSynthesis is NOT a TTS fallback"; Android engine comment) |

Candidate improvement that is *not* made here (it changes product behaviour, and the owner has already chosen "no silent
engine switch"): an opt-in on-device TTS last resort. Recommend asking the owner before building it.

## 5. Priority 3 — Secure Windows PC Companion: proposed architecture (DESIGN ONLY, nothing built)

Nothing exists. If the owner wants parity with MYRA's Windows control, the safe shape that reuses what ZarvisMobile already
has (ToolPipeline, per-action confirmations, capability registry, device-command gate) is:

1. **Outbound-only agent.** A small signed Windows service/tray app opens an authenticated WebSocket *to* the ZARVIS
   backend; it never listens on a port, so there is no inbound attack surface and no router/firewall setup.
2. **Pairing.** One-time code shown on the PC, entered in the signed-in web/Android app; the backend stores a per-device
   key pair (public key only server-side). Every message is signed; tokens are short-lived and revocable from the
   Permission Center; revoking kills the socket immediately.
3. **Closed command set, no shell.** The agent exposes an allow-list of typed commands (e.g. `volume.set`, `app.open
   {registeredName}`, `file.list {root}`), validated against a JSON schema on both server and agent. No "run arbitrary
   command", no PowerShell passthrough. Unknown command = rejected and logged.
4. **Scopes and sandboxing.** File commands are confined to user-chosen root folders; delete is move-to-recycle-bin; keyboard
   and mouse injection is a separate, off-by-default scope with a visible "ZARVIS is controlling this PC" overlay and a
   hotkey kill switch. Denylist for credential stores, system folders, and elevation (the agent never runs as admin).
5. **Confirmation tiers** reuse the existing `actionClass` model: read-only = no prompt; low-impact = remembered scope;
   external/destructive/security-sensitive = per-action confirmation on the paired phone, with the exact payload shown.
6. **Audit.** Each command gets an execution record (the repo already has `tooling/executionRecord.ts`) with result
   verified by a read-back ("volume is now 40", file exists/doesn't), never "assumed success".
7. **Updates and trust.** Code-signed installer, update channel with signature verification, no auto-run of downloaded code.
8. **Tests required before any "IMPLEMENTED" label:** protocol/signature/replay unit tests, schema fuzzing, a fake-agent
   integration test in `backend/test`, and a real Windows run recorded in the same UNVERIFIED/PASS evidence style as
   `verify-device.sh`.

Open decisions for the owner: Electron/C#/Python for the agent; whether keyboard/mouse control is in scope at all;
whether the PC companion is in the Free tier.

## 6. Priority 4 — verified task automation: what to claim and what not to

- **Claimable:** a user can create a multi-step workflow, run it step by step, every step's status comes from the real tool
  result, failures fail the step, confirmations block the step, cancel aborts an in-flight run (tests: `taskRunner`,
  `taskRaces`, `cancelWorkflowAbortsRun`, `taskService`, `automation`).
- **Not claimable:** unattended/scheduled/background automation; chained steps without a click; PC or cross-app control.
- Tool coverage inside steps is limited to the registered skills (web search, docs, research, creative, business,
  developer, automation, plus on-device Android skills).

## 7. Summary counts (MYRA claim groups, collapsed into the rows above)

| Status | Rows |
|---|---|
| IMPLEMENTED | server TTS, Hindi/en voices, Gemini, OpenRouter, memory/conversations, modern UI, accounts/billing |
| PARTIAL | speech recognition, real-time voice, deep research, OCR/vision/camera, Android screen read, workflows, open-app, website/code gen, messaging helpers, i18n |
| MISSING | every Windows PC control claim, wake word, scheduled/background automation, close app, WhatsApp/SMS sending, PC file management, task scheduling |
| UNVERIFIED | all MYRA-side behaviour (no source); object-detection quality; audio-reactive waveform; Android localization coverage |

## 8. Limitations of this review

1. MYRA's implementation was not available; its package from PyPI was **not** installed or executed.
2. Android Gradle could not run locally (HTTP 429 from Maven Central); Android results are CI results on the same commit, not mine.
3. No real Android phone, no Windows machine, no Production access in this environment.
4. Live TTS (Edge/Gemini) and live Gemini/OpenRouter were not called from here; only CI and recorded probe results are cited.
5. Test counts are for this commit on this machine; skipped tests (21) are Postgres/live-credential ones.
6. This document found no new defect that needed a code change; one stale comment is noted (§2.5) and left alone.
