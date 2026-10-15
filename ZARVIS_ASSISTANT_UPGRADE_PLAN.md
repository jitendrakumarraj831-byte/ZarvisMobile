# ZARVIS assistant upgrade plan (2026-10-15)

Requested by the owner: a deep audit of ZARVIS against six assistant capabilities (natural Hindi/Hinglish voice, an
Android phone agent, screen and camera understanding, persistent user-controlled memory, verified task automation, and
a secure native Windows PC companion), and a phased plan that reuses what exists. Each phase gets its own draft PR, and
nothing merges to `main` directly.

This file does not override [ZARVIS_MASTER_PRODUCT_BLUEPRINT.md](./ZARVIS_MASTER_PRODUCT_BLUEPRINT.md). Every upgrade
phase below names the blueprint phase it belongs to. The blueprint's phase gate (§22A) still applies, and §8 of this file
lists the decisions that gate asks of the owner.

Status words are the blueprint's (§19). **WORKING** needs real verification evidence, **PARTIAL** means some real
functionality exists, **PLANNED** means designed but not built, and **UNSUPPORTED** means there is no legitimate route.

---

## 1. Audit summary

ZARVIS already has most of the foundation these capabilities need, and it is well tested. On this branch, before any
change, there were 1165 backend tests (21 skipped without Postgres or live keys), 76 web unit tests and 282 Android
`:domain` tests, all passing. Where an area falls short, the reason is that the code works but has never been run on a
real device or is missing a piece. Fake code was not the problem anywhere.

| Area | What already exists (source) | Main gap |
|---|---|---|
| Shared Brain | Bounded agent loop, server-issued single-action confirmations, idempotent turns (`backend/src/agents/orchestrator.ts`, `backend/src/security/confirmationService.ts`) | none blocking |
| Tool boundary | Registry → validation → permission → entitlement → prepare → confirm → execute → verify → charge (`backend/src/tooling/toolPipeline.ts`; Android mirror `android/domain/.../tooling/ToolPipeline.kt`) | on-device runs are not in the server's execution ledger |
| Capability truth | One registry with 16 device capabilities, shared JSON, parity tests, none WORKING without device evidence (`backend/src/capabilities/registry.ts`, `shared/capability-registry.json`, `android/domain/.../capability/CapabilityRegistry.kt`) | no real-device evidence recorded yet |
| Voice | Free keyless Edge neural voices (Hindi, English and Hinglish chosen from the text), Gemini voice as an optional fallback, streaming PCM (`backend/src/tts/*`, `backend/src/config/ttsConfig.ts`) | the reply language and the voice used two different detectors that disagreed (**fixed in Phase 1**); Android plays the non-streaming WAV |
| Memory | Only what the user saves. Pause, per-item delete, forget all, project memory, passed to the model as data (`backend/src/api/routes/notes.ts`, `backend/src/agents/turnContext.ts`) | the user cannot say "remember this" in chat, and Android can view and delete memory but cannot add it |
| Phone agent | 21 on-device skills including call (resolved contact, per-call confirmation), open app, alarms, reminders, notifications, global actions, screen read and tap with verification (`android/skills/.../OnDeviceSkillRegistryFactory.kt`, `android/app/.../access/ZarvisAccessibilityService.kt`) | Hindi word order ("WhatsApp kholo") and Devanagari commands mostly reach the Brain, which cannot act on the phone. A negation started the call flow (**fixed in Phase 1**) |
| Screen/camera | Web camera → vision; Android "describe a photo" → vision; Android screen text read locally with password fields skipped and sensitive apps refused | camera capture on Android is preview only, and there is no "explain my screen" with AI |
| Tasks | Durable tasks; one step runs per user press as an ordinary turn, with evidence; workflows track steps (`backend/src/tasks/taskRunner.ts`, `backend/src/skills/automationCreateWorkflow.ts`) | device steps are not part of tasks, and reminders are local to the phone |
| PC companion | **Nothing exists.** No client, no device pairing, no command channel | the whole feature; it is not in the blueprint yet |

---

## 2. Source-backed feature matrix

Platform columns show the status today, from the registry or the code. "Evidence" names the file and the tests that prove
the claim. Wherever the table says something is missing, the code was searched for it.

### 2.1 Natural Hindi/Hinglish voice

| Feature | Web | Android | Backend | Evidence | Gap → phase |
|---|---|---|---|---|---|
| Speech to text after a tap | PARTIAL (browser `SpeechRecognition`, `hi-IN` or `en-US` from the app language) | PARTIAL (`SpeechRecognizer`; not verified on a device) | n/a | `web/app.js` `setupSpeechRecognition`; `android/app/.../voice/AndroidSpeechToTextEngine.kt`; registry `microphone` | Hinglish speakers with an English UI get `en-US` recognition → **P3** |
| Wake word / background listening | UNSUPPORTED by design | UNSUPPORTED by design | n/a | registry `microphone.unsupportedActions` | stays unsupported (privacy rule) |
| Reply language follows the message | yes | yes (same Brain) | `detectReplyLanguage` | `backend/src/language/textLanguage.ts`; `backend/test/language/textLanguage.test.ts` | **fixed in P1**: English messages containing "the" or "do" were told to get a Hindi reply |
| Spoken replies, free and without a key | PARTIAL (stream + unary) | PARTIAL (unary WAV) | Edge by default, no key; Gemini fallback optional | `backend/src/config/ttsConfig.ts` `buildTtsProvider`; `backend/test/tts/ttsConfig.test.ts` "needs no key" | Android streaming → **P3** |
| Voice chosen from the text (Hindi, Hinglish, English) | yes | yes | `resolveVoice` | `backend/src/tts/voices.ts`; `backend/test/tts/voices.test.ts` | now the same detector as the reply (P1) |
| Interrupting ZARVIS | a new turn cancels the old one | a new turn cancels the old one | turn `signal` aborts model and tool calls | `web/app.js` `currentTurnController`; `backend/test/agents/turnExecution.test.ts` "starts no model or tool call after the client has gone away" | tap-to-stop while speaking on Android not verified on a device → **P3** |
| Spoken notifications | n/a | PARTIAL (on-device TTS, privacy modes, OTP/banking excluded) | n/a | `android/app/.../access/NotificationSpeaker.kt`; `android/domain/.../notification/NotificationPrivacy.kt` | device verification |

### 2.2 Android phone agent

| Feature | Android | Evidence | Gap → phase |
|---|---|---|---|
| Call a contact or number, with per-call confirmation of the resolved number | PARTIAL | `PhoneCallSkillFactory.kt`, `ContactMatching.kt`; `PhoneCallSkillFactoryTest`, `ContactMatchingTest` | "मम्मी को कॉल करो" (Devanagari) reaches the Brain → **P6** |
| Hinglish commands: "mummy ko call karo", "home pe jao", "OK button dabao", "screen padho", "alarm laga do", "yaad dilana" | PARTIAL | `HinglishDeviceCommandSafetyTest` (P1) pins these | — |
| Negation, deferral or a question never opens the call flow ("call mat karo", "baad mein call karna", "call kaise karte hain") | fixed in P1 | `DeviceCommandGate.notACallRequest`; `HinglishDeviceCommandSafetyTest` | — |
| Open an app in Hindi word order ("WhatsApp kholo", "YouTube chalu karo", "व्हाट्सएप खोलो") | reaches the Brain (no device action) | measured with the P1 probe | **P6** |
| Turn off spoken notifications in Hinglish ("notification mat bolo") | reaches the Brain | measured with the P1 probe | **P6** |
| Hinglish call with a two-word name ("Neha Test ko call karo"; "Neha ko call karo" works) | reaches the Brain: the gate looks for "call" only in the first three words | measured with the P1 probe | **P6** |
| Global actions (home, back, recents, notifications, lock) with read-back verification | PARTIAL | `ZarvisAccessibilityService.kt` `performGlobal`; `SpecialAccessSkillsTest` | device verification |
| Read the screen as text; tap one uniquely labelled button and check that the screen changed | PARTIAL | `AndroidScreenAccessPort.readScreen`, `tap` (password nodes skipped, sensitive apps refused) | multi-step flows → **P6** |
| Brain plans a device action and the phone runs it | not built (the Brain only *describes* device skills) | `deviceCapabilitiesForPrompt` in `backend/src/capabilities/registry.ts` | **P6** |
| Send a message through a third-party app | UNSUPPORTED (no legitimate automatic route) | — | share-intent draft that the user sends → **P6** |

### 2.3 Screen and camera understanding

| Feature | Web | Android | Evidence | Gap → phase |
|---|---|---|---|---|
| Describe a photo the user picks | PARTIAL (vision; the picture is not stored) | PARTIAL (system picker, no media permission) | `backend/src/ai/modelGateway.ts` `analyzeImage`; `android/app/.../photo/ApiPhotoDescriber.kt`; `web/e2e/camera.e2e.cjs` | device verification |
| Take a photo and describe it | PARTIAL (camera sheet → vision) | PARTIAL: capture is **preview only** | registry `camera` | Android capture → describe → **P4** |
| Explain what is on my screen | not built | screen text is read locally only, and the AI never sees it | `SpecialAccessSkills.readScreen` | consented, text-only "explain my screen" → **P4** |
| Share a browser tab or screen frame | not built (`getDisplayMedia` is unused) | n/a | `grep getDisplayMedia web/` finds nothing | optional single frame → **P4** |

### 2.4 Persistent user-controlled memory

| Feature | Web | Android | Backend | Evidence | Gap → phase |
|---|---|---|---|---|---|
| Save, edit, pause and delete memory; forget all | yes | view and delete only ("Adding memory is done on the website") | `/api/v1/notes`, `/api/v1/memory` | `backend/test/workspace/notesAndMemory.test.ts`; `android/features/feature-settings/.../MemoryScreen.kt` | add and edit on Android → **P2** |
| Memory is used only when on and not paused, and is treated as data | yes | yes | `turnContext.ts` | `notesAndMemory.test.ts` | — |
| Chat never saves memory by itself, even if the model names a tool | yes | yes | — | `backend/test/agents/memoryAndLogPrivacy.test.ts` (P1) | "remember this" with explicit approval → **P2** |
| One account's memory never reaches another account's planner | yes | yes | — | `memoryAndLogPrivacy.test.ts` (P1); `isolation.test.ts` | — |
| Memory and messages never appear in server logs | yes | yes | `security/redact.ts` | `memoryAndLogPrivacy.test.ts` (P1, checked by mutation) | — |
| Export memory | not built | not built | — | — | **P2** |

### 2.5 Verified task automation

| Feature | Web | Android | Backend | Evidence | Gap → phase |
|---|---|---|---|---|---|
| Durable tasks; one step per user press; evidence on each step | yes | list and transitions | `taskRunner.ts`, `taskService.ts` | `taskRunner.test.ts`, `taskRaces.test.ts` | — |
| Single-action confirmations bound to the exact input, expiring, used once | yes | yes | `confirmationService.ts` | `phase1Security.test.ts`, `toolPipeline.test.ts` | — |
| Execution ledger and Activity | yes | — | `GET /api/v1/executions` | `executionLedger.test.ts` | on-device runs are not recorded → **P5** |
| Device steps inside a task | not built | not built | — | — | **P5** |
| Reminders | n/a | PARTIAL (Room + AlarmManager, survive reboot, local only) | — | `RoomReminderScheduler.kt`, `BootRescheduleReceiver.kt` | visible across devices → **P5** |
| Autonomous background execution | not built, deliberately | not built, deliberately | — | `taskRunner.ts` doc: "Nothing runs in the background" | stays off (blueprint §14) |

### 2.6 Windows PC companion

| Feature | Status | Evidence | Phase |
|---|---|---|---|
| Native Windows client, pairing, command channel, PC actions | PLANNED (nothing exists) | no Windows client code; `.github/workflows/android-windows.yml` only builds the Android APK on Windows | **P7**, after the owner adds it to the blueprint |

---

## 3. Phases

One phase at a time, each on its own branch with its own draft PR, never merged to `main` directly. A phase starts only
after the previous one passes review and verification (blueprint §22A).

### Phase 1: Reliability baseline (blueprint Phase 1 gate; this PR)

Phase 1 adds no new capability. It adds tests that pin what later phases build on, and fixes the two defects those tests
found.

- **Fix: one language detector.** `backend/src/language/textLanguage.ts` is now the only detector. The planner
  (`detectReplyLanguage`) and the voice (`detectSpeechLanguage`, re-exported) both use it. The old planner check used
  non-global regexes (each list matched at most once) and counted `the`, `do`, `kal` and `ho` as Hindi, so "What is the
  capital of France?" got "Respond in Hindi/Hinglish". On the old code, 30 of the 73 new tests fail.
- **Fix: Hindi word order in the call gate.** `DeviceCommandGate.notACallRequest` sends a negation, a deferral or a
  question to the Brain. "call mat karo" ("don't call") used to open the call flow for a contact matching "mat"; a
  per-call confirmation still stood between that and a call.
- **Tests:** `backend/test/language/textLanguage.test.ts` (Hindi, Hinglish and English corpus; reply and voice agree),
  `backend/test/agents/memoryAndLogPrivacy.test.ts` (no memory written by chat or by an invented tool, isolation,
  nothing people say or save in the log), `android/domain/.../HinglishDeviceCommandSafetyTest.kt`.

**Device check:** [ZARVIS_PHASE1_DEVICE_CHECKLIST.md](./ZARVIS_PHASE1_DEVICE_CHECKLIST.md) (Nothing Phone (2a)), not yet run.

**Acceptance:** backend typecheck and tests, the web unit tests and the Android `:domain` tests all pass. Each new test
was checked to fail without its fix. A mutation that logged the utterance turned the log test red.

### Phase 2: Persistent user-controlled memory (blueprint Phase 2)

- **"Remember this" by proposal only.** A `memory.propose` backend skill (category PERSONAL, action class LOW_IMPACT,
  `requiresConfirmation: true`) prepares the exact sentence. The ToolPipeline issues the usual server confirmation, and
  only approval calls the existing `WorkspaceService.createNote({ kind: "memory" })`. While memory is paused the skill
  is not offered. Text that looks like a secret (OTP, PIN, password or card number) is refused in `prepare`.
- Android adds and edits memory with the existing `/api/v1/notes` endpoints (reuse `MemoryContent`; `UiString` entries
  in English and Hindi).
- Export: `GET /api/v1/memory/export` returns JSON for the owner only.
- "What do you remember about me?" is answered from stored items only (already true through `turnContext`; add a test).

**Acceptance tests:** a proposal that is never approved saves nothing; decline saves nothing; approval saves exactly the
proposed text once and a replayed approval is refused; no proposal while paused; secret-like text is refused;
another account cannot approve; the log test from Phase 1 is extended to the proposal's text; Android `MemoryApiTest`
covers add and edit; web E2E covers the confirmation card.
**Depends on:** Phase 1. **Reuses:** ToolPipeline, `ServerConfirmationService`, `WorkspaceService`, notes API, web
confirmation cards (`web/exec-cards.js`), Android `ComposeConfirmationPort`.

### Phase 3: Natural Hindi/Hinglish voice (blueprint Phase 3)

- Android plays `POST /api/v1/tts/synthesize-stream` (24 kHz PCM through `AudioTrack`) behind the existing
  `TextToSpeechEngine` interface, so the first sound comes before the whole reply is synthesised. "Speaking" is shown
  only once audio really plays (the interface already requires that).
- Tap to stop: a tap on the mic or orb while ZARVIS speaks stops playback and cancels the stream on Android, as it
  already does on the web.
- A "Hinglish" voice input option uses `en-IN` recognition (web `recognition.lang`, Android `RecognizerIntent`
  language). It is offered only where the recognizer supports it; otherwise the client says so.
- Free speech stays the default: Edge needs no key, and Gemini stays an optional fallback. An on-device Android
  `TextToSpeech` fallback ships only as an opt-in, clearly labelled as the phone's own voice.

**Acceptance tests:** the default provider needs no key (existing test, kept); streaming playback starts before the full
payload on a fake server; tap-to-stop stops audio and aborts the request (emulator test); the reply and voice agreement
from Phase 1 stays green; the `edge-tts-probe` and `tts-audit` workflows stay green; voice states match the real states.
**Depends on:** Phase 1 (one detector). **Risk:** Edge is unofficial (see §5).

### Phase 4: Screen and camera understanding (blueprint Phase 8 image understanding plus the Phase 1 camera capability)

- Android "describe what the camera sees": a system camera capture (the app declares no CAMERA permission, so the intent needs none) goes
  through `ApiPhotoDescriber` to the same vision endpoint. The picture is not stored.
- Android "explain my screen": `screen.read` text (never pixels) is sent to the Brain only after a per-action
  confirmation that shows exactly the text that will leave the phone. `SensitiveApps` refusal and the password-field
  skip stay in force.
- Web (optional): one frame of a shared tab or screen through `getDisplayMedia`, sent to `/api/v1/documents/extract`.
  This needs `display-capture` in `Permissions-Policy`, in both `headers.ts` and `vercel.json` (a test keeps them equal).

**Acceptance tests:** nothing leaves the phone without that confirmation; banking and OTP apps are refused; password
nodes never appear in the text; no vision provider gives an honest 503; the picture is not stored; the registry stays
PARTIAL until a device run is recorded.
**Depends on:** Phase 1. Phase 2 is not needed.

### Phase 5: Verified task automation (blueprint Phase 10)

- A device execution ledger: `POST /api/v1/executions/device`, owner-checked. Android posts the structured result of an
  on-device run (skill, status, verificationEvidence, a minimised input preview, never contact numbers or screen
  text). Activity and Tasks then show device steps beside server steps.
- Device steps in tasks: a step can name an on-device skill. It runs only when the user presses Run on the phone, with
  the same permission and confirmation flow, and is COMPLETED only with verification evidence.
- Reminders become visible across devices as read-only server records written after the phone has scheduled them.

**Acceptance tests:** a device step runs once (idempotent per `clientTurnId`); missing evidence → VERIFICATION_FAILED, never
COMPLETED; another account gets 404; nothing runs without a user press; process death keeps the step pending
(`PendingAction` recovery).
**Depends on:** Phase 1; Phase 6 benefits from it.

### Phase 6: Android phone agent (blueprint Phase 11)

- Hindi word order and Devanagari in `DeviceCommandGate`/`KeywordSkillMatcher`: "WhatsApp kholo", "YouTube chalu
  karo", "मम्मी को कॉल करो", "व्हाट्सएप खोलो", "notification mat bolo". Every new phrase comes with a negative case.
- Brain → device handoff. When the Brain decides on a device skill, the turn returns a structured device-action
  proposal instead of prose. Android runs it through its own ToolPipeline (Android permission plus per-action
  confirmation), so the phone stays the authority.
- Multi-step app flows through accessibility. Each step is confirmed, each tap is checked against
  `TapResult.screenChanged`, any step can be cancelled, and sensitive apps are refused.
- Third-party states from blueprint §11 (INTENT_AVAILABLE, SHARE_FLOW_AVAILABLE, …) in the registry. Messages are
  drafted through a share intent and the user presses Send. ZARVIS never sends on its own.

**Acceptance tests:** a Hinglish/Devanagari routing corpus with negatives; per-step confirmation; cancel mid-flow; refusal
in sensitive apps; process death recovery; emulator `SpecialAccessTest` extended. A real-device run is required before
anything is marked WORKING.
**Depends on:** Phases 1, 3 (voice) and 5 (ledger).

### Phase 7: Secure native Windows PC companion (new client; needs a blueprint amendment)

**Shape:** a native Windows app (.NET 8, WinUI 3, a tray icon) that is a *client* of the same Brain, as Web and Android
are. It is not a second brain.

- **Pairing:** a signed-in Web or Android client asks for a 6-digit, single-use code (`POST /api/v1/devices/pairing`,
  valid for 5 minutes). The PC enters it and registers an Ed25519 public key. The private key stays in the Windows user
  profile, protected by DPAPI or a Windows Hello key. The PC never holds a user password or the account's refresh token.
- **Command channel:** Vercel's serverless functions cannot keep a socket open, so the PC long-polls
  `GET /api/v1/devices/:id/commands` with a signed request (key id, timestamp, nonce). Commands are rows in the store,
  owner-checked and expiring, and each is delivered once.
- **Allowlisted actions only**, each with a risk class in the shared registry: open an app from an allowlist, open a URL
  or a file the user picks, media keys, lock the PC, show a notification, and "describe this window" (one screenshot
  after a local confirmation). **No arbitrary shell, no PowerShell, no file uploads without a picker, no keystroke
  injection.**
- **Confirmation on both sides:** the server's single-action confirmation (as today), plus a local Windows toast that
  must be accepted on the PC for MEDIUM risk and above.
- **Verification:** each result returns evidence (for example "process started, PID", "workstation locked") into the
  Phase 5 ledger.
- **Revocation:** any client can remove the PC. The server rejects its key at once and the PC deletes its key. A PC
  silent for 30 days is retired.
- **Supply chain:** a signed MSIX, reproducible builds in CI on `windows-latest`, and no auto-update without a signature
  check.

**Acceptance tests:** a pairing code works once and expires; a replayed signed request (same nonce) is refused; a stale
timestamp is refused; another account cannot queue commands; an action outside the allowlist is rejected server-side
and client-side; a command waits for the local toast; revocation stops delivery at once; keys and tokens never appear
in logs (extend the Phase 1 log test); fuzzing the command parser on the PC.
**Depends on:** Phase 5 (ledger), a blueprint amendment, and the owner's choice of signing certificate.

---

## 4. Dependencies

| Phase | Needs | External |
|---|---|---|
| 1 | — | none |
| 2 | 1 | none |
| 3 | 1 | Edge read-aloud service (unofficial, free); optional Gemini key |
| 4 | 1 | a vision-capable model (Gemini) for describing |
| 5 | 1 | Postgres migration for the device ledger |
| 6 | 1, 3, 5 | the emulator matrix (API 26, 30, 34) and a physical phone for verification |
| 7 | 5 + owner decision | code-signing certificate, Windows CI runner |

---

## 5. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Edge voices are an unofficial service | voice can stop without notice, and free TTS is a requirement | Gemini fallback (already built), honest 503 with `TTS_PROVIDER=none`, opt-in on-device Android voice (P3), live probe workflows |
| No real-device verification yet (all Android capabilities PARTIAL) | blueprint §22A blocks Phase 2 until Phase 1 is PASS | run `android/scripts/device/verify-device.sh` on a phone, or the owner explicitly approves proceeding (§8) |
| Accessibility automation can misfire | wrong tap in another app | exact single-label match, screen-change verification, per-step confirmation, sensitive-app refusal (existing), cancel |
| Play policy on Accessibility and call permissions | store rejection | declare and justify use; keep the features opt-in; prefer intents where they exist |
| A PC agent widens the attack surface | remote control of a computer | allowlist only, signed requests with nonces, local confirmation, revocation, no shell (P7) |
| Prompt injection through memory or screen text | the model follows text it read | memory and screen text are passed as data (existing rule); actions still go through policy and confirmation |
| Serverless cannot hold sockets | no push to the PC or phone | long polling with short timeouts; push only through OS notifications |
| Language detection is a word list | mixed or rare Hinglish misdetected | one detector, corpus tests, and the app language breaks ties |

---

## 6. What stays true in every phase

- Free speech stays the default (Edge, no key), and nothing ever requires a paid key to speak.
- No feature is shown as working before it is, and no screen has a dead button. Statuses come from one registry.
- Permission is not authorization: every sensitive action has its own confirmation, issued by the server where the
  Brain plans it and by the phone where the phone acts.
- No secrets, messages, memory, contact numbers or screen text in logs (a Phase 1 test enforces this for turns).
- Each phase adds to the existing pipeline, registry, confirmation service, workspace and voice boundary. None of them
  gets a second implementation.

---

## 7. How each phase is verified

Each phase runs the same checks as CI: backend `npm run typecheck` and `npm test` (with Postgres in CI), the
`capabilities:export` diff, the root `tsc`, `node --test web/tests/*.test.js`, the web E2E suites,
`./gradlew :domain:test`, and the emulator workflow. Phases that touch a device also need a real-device run, recorded
with its evidence before any status moves to WORKING.

---

## 8. Decisions for the owner

1. **Phase gate.** The blueprint says Phase 2 starts only after Phase 1 PASS, and Phase 1 PASS needs a real-device run.
   Run `android/scripts/device/verify-device.sh` on a phone, or approve starting upgrade Phase 2 before that.
2. **PC companion.** Approve adding a "Windows PC Companion" client to the blueprint (§1.1 clients, §5 matrix, §13
   roadmap) before Phase 7 begins, and choose the code-signing route.
3. **Hinglish voice.** Keep the Hindi voice for Hinglish (today's default), or set `TTS_HINGLISH_VOICE=en-IN-NeerjaNeural`.
