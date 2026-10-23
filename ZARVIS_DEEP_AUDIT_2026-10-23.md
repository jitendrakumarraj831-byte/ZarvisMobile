# ZARVIS deep audit — 2026-10-23

Audited commit: `main` @ `7a8b67f` (merge of #113). Every finding below was re-read in the current code; older audit
documents in this repository (DEEP_AUDIT_2026-10-02.md, PRODUCTION_AUDIT_2026-10-14.md, DEEP_SCAN_REPORT.md, …) were not
used as evidence.

Goal of the review: a reliable A–Z Android personal assistant — Hindi/Hinglish commands, real-time chat and voice, safe
phone automation, permission intelligence, screen/photo understanding, user-controlled memory, verified tasks, activity
history and secure settings.

## 0. What was run, and what was not

| Check | Result | Where |
|---|---|---|
| Backend typecheck (`npm run typecheck`) | clean | this session |
| Backend tests (`npm test`, in-memory store) | 1423 passed, 22 skipped (the skipped ones need `TEST_DATABASE_URL` or live provider keys) | this session |
| Android `:domain` (`./gradlew :domain:test`) | 314 passed, 0 failed | this session, JDK 17 |
| Android JVM-pure modules (data-remote, data-repository, agents, the view models) | 102 passed, 1 skipped (live backend test) | this session, in a scratch JVM harness that compiles the real sources against Maven Central artifacts (androidx `ViewModel`/`SavedStateHandle` and Hilt's annotation replaced by local stand-ins) |
| Android SDK builds (`:app:assembleDebug`, lint, Compose screens), emulator suite | **not run here** | this container cannot reach `dl.google.com` (Android SDK and Google Maven both redirect there). These run in GitHub Actions: `android-build.yml`, `android-emulator.yml` (API 26/30/34) |
| Physical-device test | **not run** | no device is attached to this session; nothing in this report claims a physical-device result |

The CI workflows are the authoritative check for anything that needs the Android SDK.

## 1. Executive summary

The codebase is far more complete and more honest than a typical prototype: a server-authoritative ToolPipeline on both
sides, server-issued single-use confirmations, real permission state re-read after every system flow, privacy-filtered
notifications, sensitive-app refusal for screen reading/tapping, idempotent turns on the server, and extensive tests. The
gaps that matter most for an Android-first assistant are at the **seams between the Android client and the backend**:

1. **Chat reliability (P1).** The Android client never sends the server's idempotency key (`clientTurnId`) and has no
   Retry; every non-AI failure — a 500, a 409 "still processing", an in-stream server error — is shown as *"I couldn't reach
   ZARVIS… check your connection"*. The web client already does both correctly.
2. **Voice (P1).** A speech-recognition error is shown as `Speech recognition error (code 7)`; "didn't hear anything" is
   treated as an error state; voice messages are English-only.
3. **Contract truth (P1).** The backend tells the AI planner that "take a photo", "pick a photo" and "pick a document"
   *attach the content to the chat / read it*; the Android skills only show a preview or the file's name and size. The
   Developer screen cannot decode the server's failure body and shows a raw serialization error.
4. **Safety (P1).** `screen.tap` refuses "Pay", "Delete", "Allow"… only in English; a phone in Hindi shows "भुगतान करें",
   "हटाएँ", "अनुमति दें", which are not refused.
5. **Privacy (P1).** Signing in to a different account (or starting a new guest after a session ended) keeps the previous
   account's reminders and their alarms on the phone; only Sign out clears them.
6. **User-controlled memory (P1).** Android can view, delete and pause all memory, but cannot add a memory or pause one
   item, although the backend supports both.
7. **Verified tasks / activity history (P1/P2).** Android lists tasks and cancels them, but cannot run, retry or approve a
   step, ignores the server's `actions`, and has no activity-history or chat-list screen (the backend has both APIs).

Section 8 orders all fixes by dependency. Section 9 lists what the accompanying PR implements.

## 2. Feature status

Status as found on `main` @ `7a8b67f`; section 9 lists what the accompanying PR changes.

Legend: **Implemented** (works end to end in code and has tests), **Partial**, **Missing**, **Broken**, **Duplicated**,
**Insecure**, **Unverified** (implemented, but no real-device evidence; the capability registry itself marks every Android
capability PARTIAL for that reason).

| Area | Feature | Status | Evidence |
|---|---|---|---|
| Auth | Guest bootstrap, email link, sign in/out, rotating refresh with reuse detection, server-side session check on every request | Implemented | `backend/src/auth/authService.ts`, `api/middleware/authMiddleware.ts`, `android/data/data-remote/.../TokenAuthenticator.kt`, tests `test/auth/*`, `TokenAuthenticatorTest` |
| Auth | Legacy refresh tokens (no `sid`) mint a fresh session on every use without being retired | Partial (P3) | `authService.ts:169` |
| Auth | Login timing differs for unknown emails (no scrypt) | Insecure, minor (P3) | `authService.ts:112-118` |
| Session | Rotated refresh token persisted with `SharedPreferences.apply()` (async) | Partial (P2) | `core-security/SecureStorage.kt:26-27` |
| Session | Account switch keeps previous account's reminders/alarms/interrupted action | Broken (P1 privacy) | `data-repository/SessionRepository.kt:64-77` vs `88-93` |
| Chat | Streaming turn with real progress (`thinking`, tools) | Implemented | `routes/orchestrator.ts:51-110`, `AndroidOrchestrator.streamTurn`, `TurnStreamReaderTest` |
| Chat | Idempotent retry (`clientTurnId`) | Missing on Android (Implemented on web/server) | `dto/Dtos.kt:60-70`, `web/app.js:4252,4536`, `agents/orchestrator.ts:220-243` |
| Chat | Truthful failure messages | Broken (P1) | `ConversationViewModel.kt:426-433`, `AndroidOrchestrator.kt:276-283` |
| Chat | Retry control for a failed turn | Missing (P1) | `ConversationScreen.kt` (no retry), web has `addErrorBubble(..., retry)` |
| Chat | One active conversation shared by every screen; stale replies dropped | Implemented | `domain/conversation/ActiveConversation.kt`, `ConversationSync.kt`, `ConversationViewModelSyncTest` |
| Chat | Conversation list / switch between chats | Missing on Android | backend `GET /conversations` (`routes/conversations.ts:30-48`) unused |
| Chat | Delete chat | Implemented | `AndroidOrchestrator.deleteConversation`, `conversationDelete.test.ts` |
| Hindi/Hinglish | On-device command routing (Hindi order, negations, "na", multi-step) | Implemented | `DeviceCommandGate.kt`, `HinglishDeviceCommandSafetyTest` (domain) |
| Hindi/Hinglish | Reply language follows the current message | Implemented, except the greeting fast path | `language/textLanguage.ts:84`, `orchestrator.ts:684-702` (P2) |
| Hindi/Hinglish | Voice: Hindi/English/Hinglish TTS voice chosen from the text | Implemented | `tts/voices.ts` |
| Hindi/Hinglish | Voice input language follows app language only (hi-IN / en-US) | Partial (P2) | `ConversationViewModel.kt:306` |
| Hindi/Hinglish | Some Android surfaces English-only (assist overlay, Permission Center, notification settings, session-expired screen, chat error texts) | Partial (P2) | `AssistActivity.kt:113-159`, `PermissionCenter.kt:164,212-215`, `MainActivity.kt:146-169`, `ConversationViewModel.kt:296-299,428,432` |
| Voice | Tap-to-talk STT, server TTS with truthful "Speaking" state | Implemented | `AndroidSpeechToTextEngine.kt`, `AndroidTextToSpeechEngine.kt` |
| Voice | Recognition errors shown as raw codes; no-match treated as an error | Broken (P1) | `AndroidSpeechToTextEngine.kt:36-38`, `ConversationViewModel.kt:318-320` |
| Phone automation | Open app, call (confirmed), find contact, reminders, alarm, calendar, settings, app search, message draft, multi-step handoff | Implemented, Unverified on a real device | `domain/skill/*`, `AndroidOrchestratorDeviceActionTest`, `AppAutomationTest` (emulator) |
| Phone automation | Brain → phone handoff contract for photo/document | Broken contract (P1) | `capabilities/deviceActions.ts:116-143` vs `DeviceCapabilitySkills.kt:117-147` |
| Phone automation | `device-result` not bound to an issued handoff; repeated reports append repeated replies | Partial (P2) | `routes/orchestrator.ts:154-225`, `orchestrator.ts:644-649` |
| Phone automation | Phone actions never reach the server's executions ledger / activity | Missing (P2) | `orchestrator.ts:518-536` (no pipeline run, no record) |
| Safety | Confirmation of the exact action (server-issued, single use, input-hash bound) | Implemented | `security/confirmationService.ts`, `routes/confirmations.ts`, `phase1Security.test.ts` |
| Safety | Screen tap refuses pay/delete/allow… labels | Partial — English only (P1) | `SpecialAccessSkills.kt:394` |
| Safety | Banking/password/permission/installer screens refused for read and tap | Implemented | `privacy/SensitiveApps.kt`, `SpecialAccessSkillsTest` |
| Permission intelligence | Explain → Allow/Not now → system dialog/Settings → re-read real state; revocation detection; process-death recovery | Implemented | `domain/access/*`, `PermissionDialogFlowTest`, `SpecialAccessTest`, `ProcessDeathTest` (emulator) |
| Screen/photo understanding | Describe a picked photo (server vision) | Implemented, Unverified | `DeviceCapabilitySkills.describePhoto`, `ApiPhotoDescriber.kt`, `PhotoDescriptionResultsTest` |
| Screen/photo understanding | Read screen text (kept on the phone, never sent) | Implemented, Unverified | `SpecialAccessSkills.readScreen`, `PRIVATE_RESULT_SKILLS` |
| Screen/photo understanding | Take a photo and ask about it | Missing (preview only) | `DeviceCapabilitySkills.capturePhoto` |
| Document understanding | Read/summarize a document on Android | Missing (web has it via `/documents/extract`) | `web/logic.js:596-603`, `DeviceCapabilitySkills.pickDocument` |
| Memory | View, delete one, forget all, pause all | Implemented | `MemoryViewModel.kt`, `MemoryViewModelTest`, `MemoryApiTest` |
| Memory | Add a memory, pause/resume one item | Missing on Android (P1) | `ZarvisApi.kt:122-136`, backend `routes/notes.ts:115-139` |
| Memory | Saved memory and project state given to the planner as data, paused memory excluded | Implemented | `agents/turnContext.ts`, `memoryAndLogPrivacy.test.ts` |
| Tasks | Server task engine with truthful lifecycle, run/retry one step as a real turn, cancel, stale detection | Implemented | `tasks/*`, `test/tasks/*` |
| Tasks | Android: list + cancel only; no run/retry/approve; ignores `actions`; no steps/events | Partial (P1) | `TasksScreen.kt:146-160`, `TasksViewModel.kt:51-52`, `Dtos.kt:182-193` |
| Activity history | Server activity feed + executions ledger | Implemented | `routes/activity.ts`, `workspace/activity.ts` |
| Activity history | Android activity screen | Missing (P2) | `navigation/NavGraph.kt` (ACTIVITY tab is the Tasks list) |
| Settings | Language, theme, lightweight, voice, auto-speak, account link/sign in/out/delete, Permission Center, notification privacy | Implemented | `feature-settings/*`, `SettingsUiTest` (emulator) |
| Settings | Answer-length preference (server supports `replyLength`) | Missing on Android (P3) | `routes/orchestrator.ts:283` |
| Secure storage | Tokens in EncryptedSharedPreferences; backups and device transfer excluded | Implemented | `SecureStorage.kt`, `res/xml/*backup*` |
| Secure storage | No recovery if the encrypted store cannot be opened (keyset/Keystore failure) | Unverified risk (P2) | `SecureStorage.kt:14-24`, `di/AppModule.kt:82-84` |
| Billing | Server: Razorpay orders/verify/webhook, Play token verification (fail-closed in production) | Implemented | `billing/*`, `test/billing/*` |
| Billing | Android: plan shown; upgrade disabled; Monthly/Yearly toggle only changes a caption; prices not read from `/billing/plans`; TRIAL never marked current | Partial (P3) | `SubscriptionScreen.kt:139-171` |
| Billing | `/usage/charge` can never charge an on-device skill (they are not in the server registry) — latent, all on-device skills are free | Partial (P3) | `routes/usage.ts:225-245`, `skills/index.ts` |
| Developer | Analyze repo from Android | Broken on failure (P1 contract) | `routes/developer.ts:36`, `Dtos.kt:251-257`, `DeveloperScreen.kt:82` |
| Logging | Accessibility evidence lines log foreground package names in release builds | Minor (P3) | `ZarvisAccessibilityService.kt:123` |
| Docs | Many overlapping audit/plan documents | Duplicated | repo root `*_AUDIT*.md`, `DEEP_SCAN_REPORT.md`, `FINAL_PHASE1_VERIFICATION.md` |

## 3. Android screen → control → ViewModel → data → API/native → test

| Screen (route) | Control | ViewModel / function | Repository / port | API or native action | Tests |
|---|---|---|---|---|---|
| Startup (MainActivity) | Try again | `AppStartupViewModel.retry` | `SessionRepository.ensureSession` | `POST /auth/guest` (first launch) | `AppStartupViewModel` none (unit); `EmulatorSmokeTest` |
| Session expired | Sign in / Start a new guest | `AppStartupViewModel.signIn` / `startNewGuest` | `SessionRepository.signIn` / `startGuestSession` | `POST /auth/login`, `POST /auth/guest` | `SessionRepositoryTest` |
| Onboarding (`onboarding`) | Next / Back / Skip | `OnboardingViewModel.next/previous/skip` | `AppPreferences.setOnboardingComplete` | — | none |
| Home (`home`) | orb / mic | `onTalk` → Chat with `listen=true` | — | — | `ShellScreenshotTest` |
| Home | composer / category chips / tiles | navigation to Chat (`submit=true`) / feature pages | — | — | `NavigationReachabilityTest` (domain) |
| Home | Try again | `HomeViewModel.refresh` | `ZarvisApi` | `GET /skills`, `GET /entitlements/me`, `GET /tasks` | none |
| Skills (`capabilities`) | Run skill / open feature / plans | `CapabilitiesViewModel.refresh`; navigation | `ZarvisApi` | `GET /skills` | none |
| Feature page (`feature/{id}`) | Start chat / Speak / Developer | navigation | — | — | `SharedFeatureCatalogTest` (domain) |
| Chat (`chat`, `conversation?…`) | Send | `ConversationViewModel.submitComposerText` → `runTurn` | `AndroidOrchestrator.handleTurn` | on-device skill via `ToolPipeline`, or `POST /orchestrator/turn-stream` (+ `/device-result`, `/confirmations/:id/approve|decline`) | `ConversationViewModelSyncTest`, `AndroidOrchestratorConversationTest`, `AndroidOrchestratorDeviceActionTest`, `ConversationLifecycleTest`, `ChatSyncTest`, `AppAutomationTest` |
| Chat | Mic / orb | `startListening` / `cancelListening` | `AccessCoordinator.ensure(MICROPHONE)`, `SpeechToTextEngine` | Android `SpeechRecognizer` | `PermissionDialogFlowTest.f_microphoneDeniedKeepsTextInput` |
| Chat | New chat / Delete | `startNewConversation` / `deleteConversation` | `ActiveConversation`, `ZarvisApi` | `DELETE /conversations/:id` | `ConversationViewModelSyncTest`, `ChatSyncTest` |
| Chat | Continue / Dismiss (interrupted action) | `resumeInterrupted` / `dismissInterrupted` | `PendingActionStore` | re-runs the request | `ProcessDeathTest` |
| Chat | suggestion chips | `submitInitialText` | as Send | as Send | none |
| Chat | Retry a failed turn | **missing** | — | — | — |
| Confirmation dialog (global) | Approve / Decline | `ConfirmationViewModel` | `ComposeConfirmationPort` | on-device: local; Brain: `POST /confirmations/:id/*` | `DeviceCapabilityTest.a_callIsPlacedOnlyAfterTappingConfirm…` |
| Permission rationale (global) | Allow / Not now / Learn more / Open settings | `PermissionMonitorViewModel` | `ComposeRationalePort`, `ActivityBridge` | Android permission dialog / Settings | `PermissionDialogFlowTest` |
| Tasks (`activity`, `tasks`) | Cancel | `TasksViewModel.cancel` | `ZarvisApi` | `POST /tasks/:id/cancel` | `TasksViewModelTest` |
| Tasks | Run / Retry / Approve | **missing** | — | server has `POST /tasks/:id/run|retry`, `/confirmations/:id/*` | — |
| Work (`more`) | cards | `WorkViewModel.refresh`; navigation | `ZarvisApi` | `GET /tasks`, `GET /memory`, `GET /entitlements/me` | `WorkViewModelTest` |
| Memory (`memory`) | Use saved memory switch | `MemoryViewModel.setEnabled` | `ZarvisApi` | `PUT /memory/settings` | `MemoryViewModelTest` |
| Memory | Delete item / Forget all | `delete` / `forgetAllPersonal` | `ZarvisApi` | `DELETE /notes/:id`, `DELETE /memory/personal` | `MemoryViewModelTest`, `MemoryApiTest` |
| Memory | Add memory / pause one item | **missing** | — | server has `POST /notes`, `PATCH /notes/:id` | — |
| Metrics (`metrics`) | Try again | `MetricsViewModel.refresh` | `ZarvisApi`, `TurnMetricsStore` | `GET /tasks` | none |
| Plans (`subscription`) | Monthly/Yearly toggle | local state only (caption) | — | — | none |
| Plans | Upgrade | disabled | — | — | — |
| Developer (`developer`) | Analyze | `DeveloperViewModel.analyze` | `ZarvisApi` | `POST /developer/analyze` | none |
| Settings (`settings`) | Language / Appearance / Voice / Auto-speak / Lightweight | `SettingsViewModel.set*` | `AppPreferences` | — | `SettingsUiTest` |
| Settings | Link email / Sign in / Sign out / Delete account | `linkEmail` / `signIn` / `signOut` / `deleteAccount` | `SessionRepository`, `ZarvisApi` | `POST /auth/link`, `POST /auth/login`, `POST /auth/logout`, `DELETE /account` | `SessionRepositoryTest` |
| Settings > Permissions | Allow / Turn on / Turn off in Settings / Learn more | `PermissionCenterViewModel` | `AccessCoordinator`, `ActivityBridge` | Android dialogs/Settings | `SettingsUiTest.permissionCenterListsEveryCapabilityWithLiveState` |
| Settings > Notifications | mode, speak, quiet hours, headphones, lock screen, sensitive, apps, sample | `NotificationSettingsViewModel` | `DataStoreNotificationSettings`, `NotificationSpeaker` | Android TTS | `SettingsUiTest.notificationSettingsPageControlsRealSettings`, `SpecialAccessTest.b_…` |
| Assist overlay (`AssistActivity`) | Speak / Send / Close | `ConversationViewModel` | as Chat | as Chat | `SpecialAccessTest.f_…`, `g_…` |

## 4. Critical flows traced end to end

**F1 — Hinglish phone command ("WhatsApp kholo").** `ConversationViewModel.runTurn` → `AndroidOrchestrator.handleTurn` →
`KeywordSkillMatcher.matchCommand` (`phone.open_app` scores on "kholo") → `DeviceCommandGate.accepts` (Hindi order, no
negation) → `handleOnDevice` → permissions (none) → `ToolPipeline.execute` (free skill: no entitlement call, works
offline) → `AndroidAppLauncherPort` → `ToolResults.from` → bubble with status. Verified by domain tests and
`AppAutomationTest` on the emulator. Not part of a server conversation (by design).

**F2 — Brain chat turn.** `handleWithBrain` → `POST /orchestrator/turn-stream` (`deviceActions` listed, **no
`clientTurnId`**) → server stores the user message, loads saved memory, runs ≤5 planner steps through the ToolPipeline →
`meta`, `progress`, `done`. Android reads `thinking`/`tool_started` for live progress and **ignores `meta`**
(`AndroidOrchestrator.kt:358-363`). Failure paths: an HTTP error before the stream → classified only for AI 429/503;
everything else, and any in-stream error without an AI code, ends in `catch (t: Throwable)` → "I couldn't reach ZARVIS…
Check your connection" (`ConversationViewModel.kt:429-433`). There is no Retry; retyping sends a new turn with no link to the
failed attempt, so a turn whose stream dropped after the server finished runs its tools a second time.

**F3 — Voice.** Orb → `startListening` → `AccessCoordinator.ensure(MICROPHONE)` (explained, verified) →
`SpeechRecognizer` with `hi-IN` or `en-US` from the app language → partials into the composer → final → `runTurn`.
`onError(code)` → `IllegalStateException("Speech recognition error (code N)")` → `VoiceState.ERROR` with that text. Silence
(`ERROR_SPEECH_TIMEOUT` 6) or no match (`ERROR_NO_MATCH` 7) — the most common outcomes — show as errors with a code.
Reply speech: `POST /tts/synthesize` (voice picked from the reply's language), truthful "Speaking" only while audio plays.

**F4 — Brain → phone handoff ("Rahul ko WhatsApp pe hi bolo").** Server returns `deviceAction{message.draft}` → the phone
runs it through its own pipeline (contacts permission explained, draft opened, user presses Send) → `POST
/device-result` with the real status; private skills report only "shown on the phone". Multi-step continues with `then` up to
5 steps. Contract gap: for `camera.capture_photo`, `photos.pick_photo` and `files.pick_document` the server's description
promises the content reaches the chat (`deviceActions.ts:116-143`); the phone shows a preview or file details only
(`DeviceCapabilitySkills.kt:117-147`), so "is PDF ka summary do" ends in "You picked x.pdf. ZARVIS has not uploaded it or
read its contents."

**F5 — Confirmation.** A HIGH-risk server skill → `confirmation_required` with a server id → Android dialog with the exact
action → `POST /confirmations/:id/approve` → server re-checks the grant against skill + input hash + action text → runs once;
a retried approve answers 409 and Android says it ran once. Verified by backend tests.

**F6 — Memory.** Memory screen → `GET /memory`; delete/forget/pause-all work and re-read. Adding a memory or pausing one
item is impossible on Android (the empty state tells the user to use the website).

**F7 — Tasks.** A workflow created in chat (`automation.create_workflow`) appears in Tasks with its lifecycle; Android can
cancel it but cannot start or retry a step or approve a waiting confirmation; the server's per-task `actions` field is
not read.

**F8 — Account switch.** Settings > Sign in with another email → `SessionRepository.signIn` → `clearAccount()` (tokens only)
→ the previous account's reminders remain in Room and their alarms stay armed and fire for the new account
(`SessionRepository.kt:72-77`; only `signOut`/`clearLocal` call `forgetDeviceData`).

## 5. Findings

Priorities: **P0** broken core flow or security hole; **P1** major gap in a priority area; **P2** important; **P3** polish.

### AUD-01 · P1 · Android turns are not idempotent and cannot be retried
- **Where:** `android/data/data-remote/.../dto/Dtos.kt` `OrchestratorTurnRequest` (no `clientTurnId`);
  `AndroidOrchestrator.handleWithBrain` (`:258-266`); `ConversationViewModel.runTurn`; `ConversationScreen` (no retry).
- **Evidence:** the server accepts `clientTurnId` and replays a completed turn / reuses already-successful tool runs of a
  failed one (`backend/src/api/routes/orchestrator.ts:229-246`, `agents/orchestrator.ts:220-243, 437-440`); the web client
  sends it and offers Retry with the same id (`web/app.js:4252, 4536`).
- **Root cause:** the Android client never adopted the idempotency contract.
- **Fix:** a `clientTurnId` per user turn, kept on the failed turn; a Retry control re-sends the same text with the same id;
  a replayed answer is shown like any other.
- **Depends on:** AUD-02 (to know which failures are retryable).
- **Acceptance:** (a) the request body carries `clientTurnId` matching `^[A-Za-z0-9_-]{8,100}$`; (b) Retry re-sends the same
  id and text, a new message gets a new id; (c) against a server that already completed the turn, Retry shows the stored
  reply and runs no tool (server test `turnIdempotency.test.ts` covers the server half); (d) the retried exchange replaces
  the failed bubble instead of adding a second question.

### AUD-02 · P1 · Every non-AI failure is reported as a connection problem
- **Where:** `ConversationViewModel.kt:426-433`; `AndroidOrchestrator.kt:269-283`.
- **Evidence:** `catch (t: Throwable)` → "I couldn't reach ZARVIS, so nothing was done. Check your connection" for an HTTP
  500, a 409 `turn_in_progress` (`routes/orchestrator.ts:127-130`), a 400, or an in-stream `error` event without an AI code
  (`routes/orchestrator.ts:96-99` sends `{error, retryable:true}`), which the orchestrator turns into an `IOException`.
- **Root cause:** no classification between "no connection", "server failed", "still processing", "refused" and "session".
- **Fix:** a pure classifier (domain) from HTTP status / error code / network failure to a kind with a retryable flag and
  bilingual text; the orchestrator throws one typed failure; the view model shows its text and offers Retry only when
  retrying can help.
- **Acceptance:** unit tests per kind; "check your connection" only for a real network failure; no "nothing was done" claim
  when the server may have run something (in-stream failure after tools started → "may have partly run; Retry won't repeat
  what finished").

### AUD-03 · P2 · The stream's `meta` conversation is ignored
- **Where:** `AndroidOrchestrator.streamTurn` (`:358-363` ignores `TurnStreamEvent.Meta`).
- **Evidence:** the server stores the user's message in the conversation it reports in `meta` before planning
  (`agents/orchestrator.ts:354-374`). If the stream then fails, the device never learns that id: the next message of a new
  chat starts a second server conversation and the first keeps an unanswered question.
- **Fix:** remember the `meta` id and adopt it (same epoch rules as a finished turn) when the turn fails after it.
- **Acceptance:** after a stream that fails post-`meta`, the next turn is sent with that `conversationId`.

### AUD-04 · P1 · Voice recognition errors show raw codes; silence is an "error"
- **Where:** `app/voice/AndroidSpeechToTextEngine.kt:36-38`; `ConversationViewModel.kt:316-320`.
- **Fix:** a typed `SpeechRecognitionFailure(code)`; a pure mapping (domain) to bilingual text: no-match/timeout → back to
  idle with "I didn't catch that…"; network/server → "voice service unreachable, you can type"; permission → microphone off;
  busy → try again; language unsupported → switch language or type.
- **Acceptance:** unit tests for each code; no "code N" text reaches the screen; no-match leaves `VoiceState.IDLE`.

### AUD-05 · P1 · Phone-action descriptions promise content the phone never sends
- **Where:** `backend/src/capabilities/deviceActions.ts:116-143` (`camera.capture_photo` "attach it to this chat",
  `photos.pick_photo` "use in this chat", `files.pick_document` "read in this chat").
- **Evidence:** `android/domain/.../skill/DeviceCapabilitySkills.kt:117-147`: picking shows name/type/size ("ZARVIS has not
  uploaded it or read its contents"); the camera returns a preview size only.
- **Fix now:** truthful descriptions that point the planner at `photos.describe_photo` for "what is in this photo" and say
  plainly that a picked document is not read on the phone yet. **Later (AUD-20):** real document reading.
- **Acceptance:** backend test that these three descriptions do not claim to attach/read content and that describe_photo is
  named as the way to understand a photo.

### AUD-06 · P1 · Developer screen cannot read a failed analysis
- **Where:** `Dtos.kt:251-257` (`DeveloperAnalyzeResult(summary, output)` required); `DeveloperViewModel.analyze`;
  `DeveloperScreen.kt:82` prints `t.message`.
- **Evidence:** `routes/developer.ts:36` answers `{...outcome, structured}`; for `execution_failed` the `result` is
  `{kind, reason, userMessage}` (`domain/types.ts:154`), so decoding throws and the screen shows a kotlinx serialization
  message.
- **Fix:** tolerant DTO (all fields optional, `structured` modelled); show `structured.userSafeMessage`; never `t.message`.
- **Acceptance:** decoding tests for success, `execution_failed` and `entitlement_denied` bodies; view model test that a
  failure shows the server's user-safe message.

### AUD-07 · P1 · `screen.tap` refuses dangerous buttons only in English
- **Where:** `android/domain/.../skill/SpecialAccessSkills.kt:394` (`BLOCKED_TAP_LABELS`, English words with `\b`).
- **Evidence:** a phone set to Hindi labels buttons "भुगतान करें", "अभी खरीदें", "हटाएँ", "अनुमति दें", "इंस्टॉल करें",
  "स्वीकार करें", "साइन इन करें"; none matches. (Banking/payment packages are refused separately, but shopping, settings-like
  dialogs inside ordinary apps are not.)
- **Fix:** add Devanagari and common Hinglish forms, matched as substrings (Devanagari has no `\b` word boundary in Java
  regex).
- **Acceptance:** domain tests: each Hindi/Hinglish label is refused before any accessibility call; harmless Hindi labels
  ("आगे", "ठीक है") are still allowed.

### AUD-08 · P1 · Switching account keeps the previous account's reminders on the phone
- **Where:** `SessionRepository.signIn` / `startGuestSession` (`:64-77`).
- **Evidence:** only `signOut` and `clearLocal` call `forgetDeviceData` (`:88-111`), which `AppModule.kt:104-110` wires to
  cancel alarms and delete reminders and the interrupted action.
- **Fix:** when the session is replaced by a different account, forget the previous account's device data first.
- **Acceptance:** `SessionRepositoryTest`: sign-in to another account and new-guest-after-expiry run the forget hook; the
  first-ever guest session does not.

### AUD-09 · P1 · Memory cannot be added or paused per item on Android
- **Where:** `ZarvisApi.kt:122-136`, `MemoryViewModel.kt`, `MemoryScreen.kt`, `UiString.MEMORY_PERSONAL_EMPTY_BODY`.
- **Evidence:** backend `POST /notes` (`kind:"memory"`, ≤2000 chars, ≤500 notes) and `PATCH /notes/:id {enabled}`
  (`routes/notes.ts:115-139`, `workspaceService.ts:213-250`).
- **Fix:** "Add to memory" field + save; per-item "Use in replies" switch; both re-read the list from the server; failures
  say so and keep the list.
- **Acceptance:** `MemoryViewModelTest`: add calls `createNote(kind=memory, content)` then re-reads; blank or >2000 chars is
  refused locally; per-item pause calls `updateNote(id, enabled=false)`; a failure sets `actionFailed` and leaves the list.

### AUD-10 · P2 · Greeting fast path ignores the message's language
- **Where:** `backend/src/agents/orchestrator.ts:684-702` (`getSimpleGreetingResponse` uses only `locale`).
- **Evidence:** "नमस्ते" or "namaste zarvis" with an English UI gets "Hi! 👋 I'm ZARVIS…", contrary to the planner rule
  "reply in the language of the CURRENT message"; `detectReplyLanguage` already exists (`language/textLanguage.ts:84`).
- **Fix:** use `detectReplyLanguage(utterance, locale)`.
- **Acceptance:** "नमस्ते"/"namaste" + `en` → Hindi greeting; "hi"/"hello" + `en` → English; "hello" + `hi` → Hindi (unchanged).

### AUD-11 · P1 · Android Tasks cannot run, retry or approve, and ignore the server's `actions`
- **Where:** `TasksScreen.kt:146-160`, `TasksViewModel.kt`, `Dtos.kt:182-193`.
- **Fix (phase 2):** model `actions`, `progress`, `steps`, `events`, `pendingConfirmationId`; Run/Retry call
  `POST /tasks/:id/run|retry` (one step, answers when done — allow the 150 s read timeout); a CONFIRMATION_REQUIRED task
  shows the pending action (`GET /confirmations/:id`) with Approve/Decline.
- **Acceptance:** buttons follow `actions` exactly; a run shows the step's real result; approval runs once.

### AUD-12 · P2 · No activity history or chat list on Android; phone actions absent from the ledger
- **Where:** `navigation/NavGraph.kt`; backend `routes/activity.ts`, `routes/conversations.ts:30-48`;
  `agents/orchestrator.ts:518-536`.
- **Fix (phase 2):** Activity screen over `GET /activity`; Chats list over `GET /conversations` (switch = `ActiveConversation`);
  record a reported phone action as an execution row (skill id, status, no private content).

### AUD-13 · P2 · `device-result` is not bound to an issued handoff
- **Where:** `routes/orchestrator.ts:154-225`, `orchestrator.ts:644-649`.
- **Fix (phase 2):** store issued `toolCallId`s per conversation (turn record), accept one report per id (idempotent), refuse
  unknown ids.

### AUD-14 · P2 · English-only Android surfaces
- **Where:** `AssistActivity.kt:113-159`, `PermissionCenter.kt`, `NotificationSettings.kt`, `MainActivity.kt:146-169`,
  chat error texts in `ConversationViewModel`.
- **Fix:** move to `UiString` (this PR does the chat and voice texts it touches); the rest in phase 2.

### AUD-15 · P2 · Rotated refresh token written asynchronously
- **Where:** `SecureStorage.kt:26-27` (`apply()`), `TokenAuthenticator.storeTokens`.
- **Evidence:** the server revokes the session if an already-rotated refresh token is presented again
  (`authService.ts` refresh reuse check). A process kill between rotation and the async disk write would present the old
  token on the next launch.
- **Fix (phase 2):** `commit()` for token writes (they run on OkHttp's thread or a coroutine).

### AUD-16 · P2 · No recovery path if the encrypted token store cannot be opened
- **Where:** `SecureStorage` constructor, `AppModule.provideSecureStorage`. Code-reading finding; not reproduced.
- **Fix (phase 2):** catch the open failure, delete the store, treat the device as signed out (Session-expired screen).

### AUD-17 · P2 · Voice input language is tied to the app language
- **Where:** `ConversationViewModel.kt:306`.
- **Fix (phase 2):** a "Voice input language" setting (Hindi / English (India) / English (US)), default from app language.

### AUD-18 · P3 · Plans page
- Upgrade disabled (honest), toggle changes only a caption, prices not read from `GET /billing/plans`, TRIAL not marked
  current. Fix with the Play Billing integration.

### AUD-19 · P3 · Minor
- Legacy refresh tokens re-mint sessions (`authService.ts:169`); login timing (`:112`); accessibility evidence logs in
  release (`ZarvisAccessibilityService.kt:123`); `/usage/charge` cannot charge on-device skills (latent); no answer-length
  setting on Android; no explicit Stop control while a reply is on its way.

### AUD-20 · P1 (feature) · Document understanding on Android
- **Fix (phase 2):** `files.read_document` on-device skill: pick → `POST /documents/extract` → a Brain turn with the web's
  attachment format (`question\n\n[Attached document: name]\ntext`, `web/logic.js:596-603`); restored bubbles show "📎 name";
  capability registry text updated to say the document's text is sent to be read and not stored.

## 6. API contract (Android DTO ↔ backend)

| Endpoint | Android | Server | Status |
|---|---|---|---|
| `POST /orchestrator/turn-stream` request | `utterance, locale, conversationId, deviceActions` | also `clientTurnId, replyLength, userName, isFirstTurn, history, projectId, agentId` | Android lacks `clientTurnId` (AUD-01); others optional |
| turn `done` / response | `message, toolCalls[{skillId,outcome{kind,confirmation},result}], conversationId, deviceAction` | also `turnId, replayed, ai`, `toolCalls[].toolCallId` | compatible (ignored fields) |
| stream `meta` | parsed, ignored | `{conversationId, turnId, projectId?, agentId?}` | AUD-03 |
| stream `error` | AI codes only | `{error, code?, retryable, turnId}` | AUD-02 |
| `POST /orchestrator/device-result` | matches | matches | not idempotent (AUD-13) |
| `POST /developer/analyze` | requires `result.summary/output` | `result` is a failure object on failure; `structured` added | **broken on failure** (AUD-06) |
| `GET /memory`, `PUT /memory/settings`, `DELETE /memory/personal`, `DELETE /notes/:id` | matches | matches | OK |
| `POST /notes`, `PATCH /notes/:id` | absent | present | AUD-09 |
| `GET /tasks`, `POST /tasks/:id/cancel` | partial DTO | `actions, progress, events, …` | AUD-11 |
| `GET /entitlements/me` | `plan` → `EntitlementLevel.valueOf` | FREE/TRIAL/PLUS/PRO/BUSINESS/ENTERPRISE | OK (a new server plan name would throw) |
| `POST /documents/extract` | photo only | PDF/DOCX/text/image | AUD-20 |
| `POST /tts/synthesize` | matches | matches | OK |

## 7. Tests and CI

- **Backend:** 106 test files, 1445 tests (1423 run without Postgres/keys). Strong coverage of the orchestrator, gateway,
  security, idempotency, confirmations, tasks and documents. CI (`backend-tests.yml`) also runs against Postgres 16 and
  checks the generated capability registry.
- **Android:** 314 domain tests (routing, Hinglish safety, pipeline, permissions, presentation), 102 JVM tests for
  network/session/orchestrator/view models, and an emulator suite on API 26/30/34 (`android-emulator.yml`) with real
  permission dialogs, special access, automation and process death. Gaps: no unit tests for Home, Capabilities, Metrics,
  Developer, Subscription, Onboarding and Settings view models; Compose screens are covered only by screenshots and the
  emulator flows.
- **CI build:** `android-build.yml` assembles the emulator debug APK, the **Render debug APK** (`app-debug-apk-render`,
  HTTPS-only to `https://zarvismobile.onrender.com/`), and an unsigned release APK/AAB, and runs every module's unit tests
  and lint with a zero-new-warnings gate.
- **Not covered anywhere:** a physical device. Capability statuses are honestly PARTIAL for that reason.

## 8. Dependency-ordered implementation plan

**Phase 1 — reliability, truth and safety of what already exists (this PR)**
1. AUD-02 failure classifier (domain) → typed turn failure (agents) → bilingual messages (view model).
2. AUD-01 `clientTurnId` + Retry (needs 1). AUD-03 adopt `meta` on failure (same code path).
3. AUD-04 speech-error mapping (domain) → typed failure (app) → view model.
4. AUD-07 Hindi/Hinglish blocked tap labels (domain).
5. AUD-08 forget previous account's device data on account switch (data-repository).
6. AUD-09 memory add + per-item pause (data-remote → view model → screen).
7. AUD-06 tolerant developer DTO + user-safe message.
8. AUD-05 truthful phone-action descriptions; AUD-10 greeting language (backend).

**Phase 2 — complete the assistant loop**
9. AUD-15 durable token writes; AUD-16 encrypted-store recovery (before any feature that adds stored secrets).
10. AUD-20 document reading (needs the registry text update and the attachment display helper).
11. AUD-11 Tasks run/retry/approve (needs `GET /confirmations/:id` client + DTO `actions`).
12. AUD-13 device-result binding, then AUD-12 activity screen + phone actions in the ledger (needs 13 for clean records).
13. AUD-12 chat list (uses `ActiveConversation`; no server change).
14. AUD-14 remaining Hindi surfaces; AUD-17 voice-input language.

**Phase 3 — product**
15. Play Billing purchase flow and real prices (AUD-18); answer-length setting; Stop control.
16. Physical-device verification run (`android/scripts/device/verify-device.sh`) before any capability is marked WORKING.

## 9. Implemented in the accompanying PR

Phase 1 items AUD-01 … AUD-10. Everything in Phase 2 and 3 is unchanged and still open.

| Item | Change | Where | Tests |
|---|---|---|---|
| AUD-01 | Every chat message carries a `clientTurnId`; a failed reply that can be fixed by trying again shows **Try again**, which re-sends the same text under the same id and replaces the failed exchange | `Dtos.kt` (`clientTurnId`, `replayed`), `AndroidOrchestrator.handleTurn`, `ConversationViewModel.retry/runTurn`, `ConversationScreen.TurnBubble`, `AssistActivity` | `AndroidOrchestratorConversationTest.theMessageCarriesItsIdAndARetryCarriesTheSameOne`, `aTurnWithoutAnIdSendsNoneAsBefore`; `ConversationViewModelFailureTest.aServerErrorIsNotCalledAConnectionProblem…`, `aNewMessageGetsAnIdOfItsOwn`, `aRefusedRequestIsNotOfferedAgainUnchanged` |
| AUD-02 | Failures classified as offline / interrupted / server / busy / refused / session (domain `TurnFailures`), bilingual text, Retry only where it helps; the orchestrator throws `TurnFailedException` instead of a bare `IOException` | `domain/presentation/TurnFailures.kt`, `UiString.CHAT_FAIL_*`, `AndroidOrchestrator.handleWithBrain`, `ApiErrorBodies.code/retryable` | `TurnFailuresTest` (6), `AndroidOrchestratorConversationTest.eachFailureIsNamedForWhatHappened`, `aRetryableAiLimitSaysSoOnTheOutcome`, `aStreamThatStopsBeforeTheAnswer…`; `ConversationViewModelFailureTest.aMessageStillBeingWorkedOnAsksToWait`, `withTheAppInHindiTheFailureIsSaidInHindi` |
| AUD-03 | The `meta` conversation is adopted when a turn fails after it | `AndroidOrchestrator.streamTurn`/`keepTheConversationTheFailedTurnStarted` | `AndroidOrchestratorConversationTest.aTurnThatFailsAfterTheServerNamedItsConversationContinuesThatConversation` |
| AUD-04 | Typed `SpeechRecognitionFailure(code)`; codes become words (domain `SpeechErrors`); no-match/timeout is a quiet hint with the chat back at rest; voice and microphone texts bilingual | `VoiceEngines.kt`, `AndroidSpeechToTextEngine.kt`, `SpeechErrors.kt`, `ConversationViewModel.startListening`, `ConversationScreen` (hint line) | `SpeechErrorsTest` (2), `ConversationViewModelFailureTest.theMicrophoneHearingNothingIsAQuietHint…`, `aRecognizerErrorIsSaidInWords…` |
| AUD-05 | Truthful descriptions for `camera.capture_photo`, `photos.pick_photo`, `files.pick_document` (and `photos.describe_photo` says the photo is sent and not stored) | `backend/src/capabilities/deviceActions.ts` | `deviceActionHandoff.test.ts` "says what the photo and document actions really do…" |
| AUD-06 | Tolerant `DeveloperAnalyzeResponse` (+ `structured`); the screen shows the server's own words, never an exception's text | `Dtos.kt`, `DeveloperViewModel.kt` | `DeveloperApiTest` (3), `DeveloperViewModelTest` (4) |
| AUD-07 | `screen.tap` also refuses Hindi (Devanagari) and Hinglish pay/buy/delete/allow/install/accept/sign-in labels, before the screen is read or a confirmation is asked | `SpecialAccessSkills.isBlockedTapLabel` | `SpecialAccessSkillsTest` "risky buttons on a phone set to Hindi…" |
| AUD-08 | Signing in to another account, or a new guest after the session ended, forgets the previous account's reminders, alarms and interrupted action; signing back in to the same account keeps them | `SessionRepository.replaceAccount` | `SessionRepositoryTest` (2 new) |
| AUD-09 | Memory: **Add to memory** (personal item, ≤2000 chars, cleared only after the server saved it) and a per-item **Use in replies** switch | `ZarvisApi.createNote/updateNote`, `Dtos.kt`, `MemoryViewModel.add/setItemEnabled`, `MemoryScreen` | `MemoryApiTest` (3 new), `MemoryViewModelTest` (4 new) |
| AUD-10 | Greeting fast path answers in the greeting's own language | `backend/src/agents/orchestrator.ts` `getSimpleGreetingResponse` | `orchestratorGreeting.test.ts` "greets in the language of the greeting…" |

The Language page's own description (`UiString.LANGUAGE_SCOPE_BODY`) now says that Chat's failure and voice messages are
translated, so it still names exactly what is and is not in Hindi.

**Verification in this session:** backend typecheck clean and 1425 tests passed (22 skipped: Postgres/live keys); Android
`:domain` 323 passed; the JVM-pure Android modules (data-remote, data-repository, agents and the view models) 130 passed in a
scratch JVM harness; `ConversationScreen.kt`, `MemoryScreen.kt` and core-ui compiled without warnings against Compose Desktop
1.7.0 (a compile check only — Android stand-ins were used for `BackHandler`, `hiltViewModel`, `LifecycleResumeEffect`, `R.font`
and `Settings`). `AndroidSpeechToTextEngine.kt` and `AssistActivity.kt` (Android APIs) and every Android SDK build, lint and
emulator check are verified only by GitHub Actions on the PR. No physical device was used.
