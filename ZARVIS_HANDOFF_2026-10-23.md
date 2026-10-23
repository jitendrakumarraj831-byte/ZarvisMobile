# ZARVIS handoff — 2026-10-23

Session handoff for the deep audit and Phase 1 fixes. The full audit, with evidence for each finding, is in
`ZARVIS_DEEP_AUDIT_2026-10-23.md`.

## Where things are

| | |
|---|---|
| Repository | `jitendrakumarraj831-byte/ZarvisMobile` |
| Base audited | `main` @ `7a8b67f` (merge of #113) |
| Branch | `claude/elegant-goldberg-hs56sh` |
| PR | [#114](https://github.com/jitendrakumarraj831-byte/ZarvisMobile/pull/114) (draft) |
| Code commits | `34766b0` audit report · `f7d485b` backend · `ad86d30` Hindi tap safety · `19e7e12` account switch · `0a0876e` chat/voice/memory/developer |
| This file | added in a docs-only commit on top of `0a0876e` |
| PR subscription | active; one safety-net check-in scheduled for 2026-10-23T08:42Z (`trig_01JpagBgk88oahMRSdbDHhbC`) |

## CI on `0a0876e` (checked 2026-10-23 ~08:10Z)

| Workflow / job | Status |
|---|---|
| Android build (run 39920597697): `assemble-debug`, `test-and-lint` (unit tests and lint for every module; no new warnings allowed), `dev-backend-reachability` | **passed** |
| Android build (Windows + Git Bash), run 39920597731 | **passed** |
| Backend + Web checks, run 39920597700: `backend` (Postgres 16 suite, registry export diff) and `web-e2e` | **passed** |
| CodeQL (actions, java-kotlin, javascript-typescript) | **passed** |
| Android emulator verification, run 39920597702: API 30 x86_64, API 34 x86_64, API 26 harness self-test | **passed** |
| Android emulator verification: API 26 x86 | **still running** |
| Edge TTS live audit (browser), run 39920589104 | **still running** |
| Live preview API smoke, run 39920589066 | **queued**. It shares the `live-voice-quota` concurrency group with the Edge TTS audit, so it starts when that audit finishes. |

Pushing this file starts these workflows again on the new head. The file changes no code.

### APK build status
- **Render debug APK** (talks to `https://zarvismobile.onrender.com/` over HTTPS only; CI checked that the BuildConfig and the
  dex contain no cleartext or dev host): artifact `app-debug-apk-render`, id 12486218043, built from `0a0876e`, expires
  2027-01-21 — https://github.com/jitendrakumarraj831-byte/ZarvisMobile/actions/runs/39920597697/artifacts/12486218043
- Also built: `app-debug-apk-emulator` (12487236448, host 10.0.2.2), `app-release-unsigned` (12487650485, unsigned APK + AAB,
  not installable as-is), `android-lint-and-test-reports` (12486848679).
- The APK has **not** been installed on any physical device. The emulator jobs install the emulator-host build and run the repo's instrumented checks. They are not a device test of the features in this PR.

## Audit findings (summary; AUD-xx are the report's ids)

| Id | Pri | Finding | State |
|---|---|---|---|
| AUD-01 | P1 | Android never sent `clientTurnId`; no Try again; a turn whose stream dropped re-ran its tools when retyped | fixed in PR |
| AUD-02 | P1 | Every non-AI failure (500, 409 `turn_in_progress`, error inside the stream) shown as "check your connection" | fixed in PR |
| AUD-03 | P2 | Stream `meta` conversation ignored: a failed turn's user message left in a conversation the device never continued | fixed in PR |
| AUD-04 | P1 | STT errors shown as "Speech recognition error (code N)"; hearing nothing treated as an error; English only | fixed in PR |
| AUD-05 | P1 | Backend told the planner that capture/pick photo and pick document attach or read the content; the phone shows a preview or file details only | fixed in PR (descriptions made truthful) |
| AUD-06 | P1 | Developer screen could not decode a failed analysis; showed a serialization error | fixed in PR |
| AUD-07 | P1 | `screen.tap` refused risky labels in English only | fixed in PR (Hindi/Hinglish added) |
| AUD-08 | P1 | Signing in to another account (or new guest after expiry) kept the previous account's reminders, alarms and interrupted action | fixed in PR |
| AUD-09 | P1 | Android memory: no add, no per-item pause | fixed in PR |
| AUD-10 | P2 | Greeting fast path replied in the UI locale, not the greeting's language | fixed in PR |
| AUD-11 | P1 | Android Tasks: cancel only; no run/retry/approve; ignores server `actions`, steps and events | open |
| AUD-12 | P2 | No Android activity history or chat list; phone actions never reach the executions ledger | open |
| AUD-13 | P2 | `POST /orchestrator/device-result` not bound to an issued `toolCallId`; repeated reports append repeated replies | open |
| AUD-14 | P2 | English-only Android surfaces: AssistActivity, Permission Center, notification settings, session-expired screen | open (chat and voice texts done) |
| AUD-15 | P2 | Rotated refresh token written with `SharedPreferences.apply()` (async); a process kill can lose it, and the next refresh then revokes the session | open |
| AUD-16 | P2 | No recovery if `EncryptedSharedPreferences` cannot be opened (code-reading finding, not reproduced) | open |
| AUD-17 | P2 | Voice-input language tied to the app language (hi-IN / en-US) | open |
| AUD-18 | P3 | Plans: upgrade disabled; Monthly/Yearly toggle only changes a caption; no prices from `/billing/plans`; TRIAL never marked current | open |
| AUD-19 | P3 | Legacy refresh tokens re-mint sessions; login timing reveals unknown emails; release builds log accessibility package names; `/usage/charge` cannot charge on-device skills (latent, all free); no answer-length setting; no Stop button | open |
| AUD-20 | P1 | No document understanding on Android (the web has it via `/documents/extract`) | open |

"Fixed in PR" means the code changed and automated tests cover it (unit tests, the JVM harness, and CI). It does **not** mean verified on a phone. No feature in this table is marked WORKING.

## Files changed and why

**Docs**
- `ZARVIS_DEEP_AUDIT_2026-10-23.md` (new): the audit, the plan, and §9 (what this PR implements, and how it was verified).
- `ZARVIS_HANDOFF_2026-10-23.md` (new): this file.

**Backend**
- `backend/src/agents/orchestrator.ts`: `getSimpleGreetingResponse` uses `detectReplyLanguage(normalized, locale)` (AUD-10).
- `backend/src/capabilities/deviceActions.ts`: truthful descriptions for `camera.capture_photo`, `photos.pick_photo`,
  `files.pick_document`; `photos.describe_photo` says the photo is sent to be described and is not stored. `mockHints`, ids
  and schemas are unchanged (AUD-05).
- `backend/test/api/orchestratorGreeting.test.ts`, `backend/test/agents/deviceActionHandoff.test.ts`: one new test each.

**Android: domain (pure Kotlin)**
- `domain/.../presentation/TurnFailures.kt` (new): `TurnFailureKind` (OFFLINE, INTERRUPTED, SERVER, BUSY, REJECTED, SESSION),
  plus `fromHttp`, `fromStreamError` and `network(replyStarted)` (AUD-02).
- `domain/.../presentation/SpeechErrors.kt` (new): `SpeechRecognizer` error code → `UiString`; NO_MATCH and SPEECH_TIMEOUT
  give `isError = false` (AUD-04).
- `domain/.../presentation/UiString.kt`: `CHAT_FAIL_*`, `CHAT_RETRY_NAMED`, `VOICE_*` (failures and playback), `MEMORY_ADD_*`,
  `MEMORY_ADDED`, `MEMORY_ITEM_USE(_NAMED)`. Reworded `WORK_MEMORY_BODY`, `MEMORY_PERSONAL_EMPTY_BODY` and
  `LANGUAGE_SCOPE_BODY` so they stay true (it still names what is English-only).
- `domain/.../skill/SpecialAccessSkills.kt`: `isBlockedTapLabel` = English regex + Hinglish regex + Devanagari substrings
  (no `\b`, because Devanagari vowel signs are not word characters in Java regex) (AUD-07).
- Tests: `presentation/TurnFailuresTest.kt` (new: `TurnFailuresTest` + `SpeechErrorsTest`), and one new test in
  `skill/SpecialAccessSkillsTest.kt`.

**Android: data and orchestration**
- `data-remote/.../dto/Dtos.kt`:
  - `OrchestratorTurnRequest.clientTurnId` and `OrchestratorTurnResponse.replayed`.
  - `ApiErrorResponse.retryable`.
  - `CreateNoteRequest`, `UpdateNoteRequest`.
  - Tolerant `DeveloperAnalyzeResponse` (`structured`, all-optional `DeveloperAnalyzeResult`).
- `data-remote/.../ZarvisApi.kt`: `createNote` (POST `api/v1/notes`) and `updateNote` (PATCH `api/v1/notes/{id}`).
- `data-remote/.../AiServiceErrors.kt`: `ApiErrorBodies.code()` and `.retryable()`; `codeOf()` unchanged.
- `data-repository/.../SessionRepository.kt`: `replaceAccount()` runs `forgetDeviceData()` when the new account id differs from
  the stored one (AUD-08).
- `agents/.../AndroidOrchestrator.kt`:
  - `handleTurn(..., clientTurnId)`.
  - New public `TurnFailedException(failure)`.
  - `TurnOutcome.retryable`, true for retryable AI-limit outcomes.
  - `StreamProgress` (started flag + `meta` conversation id).
  - On a failure after `meta`, `conversation.adopt(metaId, sent.epoch)` (AUD-01/02/03).
- `core-common/.../voice/VoiceEngines.kt`: `SpeechRecognitionFailure(code: Int?)`.
- Tests: `MemoryApiTest` (3 new), `DeveloperApiTest` (new, 3), `SessionRepositoryTest` (2 new), and
  `AndroidOrchestratorConversationTest` (5 new). `aStreamThatStopsBeforeTheAnswer…` was updated to expect
  `TurnFailedException(INTERRUPTED)` caused by an `IOException`, instead of a bare `IOException`; the test is strengthened, not
  removed.

**Android: features and app**
- `feature-conversation/.../ConversationViewModel.kt`:
  - `ConversationTurn.clientTurnId` and `.retryable`; `ConversationUiState.hint`.
  - `retry()`: refuses while `progress != null`, and stops a failed reply that is still being read aloud.
  - `runTurn(retryOf)` replaces the failed exchange.
  - Failures are mapped through `TurnFailures`/`UiString` in the app language.
  - STT failures go through `SpeechErrors`.
- `feature-conversation/.../ConversationScreen.kt`: a "Try again" button under the newest failed, retryable reply (only while
  nothing is in flight), and a quiet hint line.
- `app/.../assist/AssistActivity.kt`: hint line and a "Try again" button (English, like the rest of the overlay).
- `app/.../voice/AndroidSpeechToTextEngine.kt`: closes with `SpeechRecognitionFailure(code)` and `(null)` when recognition is
  unavailable.
- `feature-settings/.../MemoryViewModel.kt`:
  - `add()` trims the text and refuses empty or >2000 characters (`MAX_MEMORY_CHARS`, which mirrors backend
    `LIMITS.noteContent`).
  - `setItemEnabled()`.
  - `change()` returns Boolean; new state field `added`.
- `feature-settings/.../MemoryScreen.kt`: `AddMemoryCard` (the draft is cleared only after the server saves it) and a per-item
  "Use in replies" switch.
- `feature-developer/.../DeveloperViewModel.kt`: shows `structured.userSafeMessage` / `userMessage` or the server's `{error}`;
  never `t.message`; rethrows cancellation.
- `feature-developer/build.gradle.kts`: test dependencies only.
- Tests: `ConversationViewModelFailureTest` (new, 7), `MemoryViewModelTest` (4 new), `DeveloperViewModelTest` (new, 4).

## Tests run in this session

| Suite | Passed | Failed | Skipped | Notes |
|---|---|---|---|---|
| Backend `npm run typecheck` | clean | 0 | — | |
| Backend `npm test` (in-memory) | 1425 | 0 | 22 | skipped tests need `TEST_DATABASE_URL` or live provider keys; CI runs the Postgres ones |
| Android `./gradlew :domain:test` (JDK 17) | 323 | 0 | 0 | baseline 314, 9 new |
| JVM harness (data-remote, data-repository, agents, view models) | 130 | 0 | 1 | baseline 102; the skipped one is the live-backend test. Compiles the real sources against Maven Central; androidx `ViewModel`/`SavedStateHandle` and `@HiltViewModel` are local stand-ins |
| Compose Desktop 1.7.0 compile check (`ConversationScreen.kt`, `MemoryScreen.kt`, `SettingsComponents.kt`, all core-ui) | compiled, 0 warnings | — | — | compile only; stand-ins for `BackHandler`, `hiltViewModel`, `LifecycleResumeEffect`, `R.font`, `Settings`, `LocalContext` |
| CI Android build: all modules' unit tests + lint + APKs | passed | — | — | run 39920597697 |
| CI backend (Postgres), web-e2e, CodeQL | passed | — | — | run 39920597700 and CodeQL |
| CI emulator: API 30, API 34, API 26 harness self-test | passed | — | — | run 39920597702 |
| CI emulator API 26 x86, Edge TTS audit, preview smoke | pending | — | — | see the CI table |
| Physical device | **not run** | — | — | |

The two harnesses live only in this session's scratchpad (`…/scratchpad/jvm-harness`, `…/scratchpad/compose-harness`); they are
not in the repo. They exist because this container cannot reach `dl.google.com`, to which `maven.google.com` redirects, so AGP
and the Android SDK cannot be downloaded. JDK 17 was installed with apt because `:domain` needs a 17 toolchain.

## Known limitations and unresolved items
- None of the Android capabilities is verified on a real device; the registry still marks them PARTIAL, and nothing here changes
  that.
- `AndroidSpeechToTextEngine.kt` and `AssistActivity.kt` use Android APIs: CI compiled them, and they have no unit tests.
- Try again is offered only for Brain failures (`TurnFailedException` with `retryable`, and retryable AI-limit outcomes). It is
  not offered for on-device results, a plain `IOException` from confirmation or session calls, or a stopped turn. This is a
  deliberate choice.
- In `CHAT_FAIL_INTERRUPTED` the server "can reuse" what already finished: a completed turn is replayed, and tool runs are
  reused only for identical (skill + input) requests. The text is worded so it does not promise more.
- A replayed answer that carries a `deviceAction` runs that action on the phone. This is intended, because the earlier attempt
  never reached the phone, and every action still goes through permission and confirmation.
- `files.pick_document` still reads nothing; the planner is now told so (AUD-20 is the real fix).
- A wrong-password sign-in while another session is active triggers the authenticator's refresh of the current session. This
  is pre-existing and harmless, and is noted in `SessionRepositoryTest`.
- Every open item in the findings table above.

## Constraints and decisions to keep
- Do not mark anything WORKING without real-device evidence (blueprint §19, registry rule).
- No mock features or fake progress; keep the Retry promise as narrow as the server's guarantee (above).
- No new Android permissions, and no change to auth, the confirmation flow or the server's ToolPipeline.
- Private on-device results (`PRIVATE_RESULT_SKILLS`) never go to the server; keep it that way in any Phase 2 work.
- The Web UI was not redesigned and must not be in this task.
- `clientTurnId` format is `android-<uuid>`, which matches the server's `^[A-Za-z0-9_-]{8,100}$`.
- Commits end with the Co-Authored-By / Claude-Session lines; PR bodies end with the Claude Code line and the session link.

## Exact next steps
1. Wait for the remaining checks on the PR head: emulator API 26 x86, the Edge TTS audit, and the preview smoke. If any is red, find the cause,
   reproduce it, then fix and push; never skip a test.
2. Once green, take the `app-debug-apk-render` artifact from the newest Android build run on the head and give its link. The
   link above is from `0a0876e`, which has the same code as the handoff commit.
3. Optional device check (must not be claimed unless it is actually run): install the Render debug APK on a phone and walk
   through `ZARVIS_PHASE1_DEVICE_CHECKLIST.md`, plus: Try again after airplane mode during a reply, mic with silence,
   "भुगतान करें" tap refusal, Memory add/pause, and signing in to a second account to confirm the old reminders are gone.
4. Phase 2, in dependency order (report §8):
   1. AUD-15: write tokens with `commit()`. AUD-16: recover when the encrypted store cannot be opened.
   2. AUD-20: `files.read_document` through `/documents/extract`, in the web's `[Attached document: name]` format; registry
      text update and export.
   3. AUD-11: Tasks run/retry/approve, driven by the server's `actions`.
   4. AUD-13: bind `device-result` to an issued handoff and make it idempotent. Then AUD-12: activity screen, phone actions in
      the executions ledger, and a chat list.
   5. AUD-14 / AUD-17: the remaining Hindi surfaces, and a voice-input language setting.
5. Phase 3: Play Billing and real prices, an answer-length setting, a Stop control, and a physical-device verification run
   before any capability is marked WORKING.
