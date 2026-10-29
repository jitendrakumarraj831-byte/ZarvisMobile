# ZARVIS Android: UI/UX and QA audit (2026-10-29)

> Branch `claude/fervent-cori-b2scg7`, based on `main` at `dec1aba` (Queen Night, PR #118). Client: `android/`.
> Every finding below was traced in the code (screen → view model → API call → backend where relevant). Nothing was run on a phone or
> an emulator, so no device-level behaviour is claimed as verified.

## 1. Scope and method

Read in full: the navigation graph, `MainActivity` and startup, the system dialogs, the Assist overlay, every feature screen and view
model (Home, Chat, Skills/Capabilities, capability pages, Work, Tasks, Usage & metrics, Memory, Plans, Developer Agent, Onboarding,
Settings and each of its pages: Account, Permissions & Device Access, Phone action safety, Voice, Language, Appearance, AI,
Notifications, Privacy, Security, Data, Rules & Protection, Memory, Developer), the shared Queen components, `UiString`, `StatusLabels`,
and the existing unit and emulator tests. Where a screen's behaviour depended on the server (task status, text-to-speech voices) the
backend code was read too. Android has no separate Activity feed: the Tasks tab (`Routes.ACTIVITY`) is it.

The product rules in `ANDROID_QUEEN_DESIGN.md` were the yardstick: no fake capability or state, status words say what is really
happening, every list has loading / empty / error states, and every visible string on a translated screen has Hindi.

## 2. Findings, by priority

### Confirmed bugs

| # | Sev. | Screen | Finding | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| B1 | High | Home | Home read skills, then plan, then tasks in one `try`. Home shows no skills, but a failing `/skills` hid the recent tasks **and** the plan. After any failure, Recent tasks said **"No tasks yet"**, a false empty state, under an error card. | `HomeViewModel.kt:52-62` (sequential calls, `skills` never rendered); `HomeScreen.kt:190` (empty row on failure) | Fixed |
| B2 | Medium | Usage & metrics | A failed Chat turn was recorded as **0 ms**, so the latency log showed "0 ms" in red, and the average latency was pulled down by every failure. | `ConversationViewModel.kt:567` (`durationMs = 0L`); averaged at `MetricsScreen.kt:66` | Fixed |
| B3 | Low | Plans | When a refresh failed after a plan had been shown, the error was dropped and the old credits stayed on screen as if current. Memory already handles this case (it says the list could not be refreshed). | `SubscriptionScreen.kt:118` (`entitlement != null` branch wins over `failed`); compare `MemoryScreen.kt:104` | Fixed |

### Missing UI states

| # | Sev. | Screen | Finding | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| S1 | Medium | Settings › Notifications | "Choose apps" opened a dialog with an **empty list** while the installed apps were still being read. It read as "no apps" on a slow phone, and a second tap started a second read. | `NotificationSettings.kt:90` (`emptyList()` both "loading" and "none"), `:239` | Fixed |
| S2 | Low (a11y) | All lists | `QueenErrorCard` (Home, Skills, Tasks, Metrics, Memory, Plans, Phone safety) appeared silently for TalkBack. Chat's own cards already use a polite live region. | `QueenComponents.kt:328` | Fixed |

### Inconsistencies

| # | Sev. | Screen | Finding | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| I1 | Low | Capability pages, Permissions | The same capability status was "Not supported" (and Hindi) on the Skills tab but "Unsupported" (English only) on the capability's own page and in Permissions. | `FeatureCatalog.kt:54-59`, `PermissionCenter.kt` `statusLabel` vs `CapabilitiesScreen.kt:224-229` | Fixed: one mapping, `StatusLabels.capability` |
| I2 | Low | Chat | The "earlier request was interrupted" notice was English-only, though Chat is listed as translated. | `ConversationViewModel.kt:168` | Fixed: `CHAT_INTERRUPTED_EXPIRED` |

### Incomplete functions (reported, not changed)

| # | Finding | Evidence | Why not changed here |
| --- | --- | --- | --- |
| F1 | Settings › Voice › **Voice style** (Kore, Puck…) only changes the voice when the server speaks with Gemini. The default chain puts ElevenLabs first when it has a key, then Gemini, then Edge, and ElevenLabs and Edge ignore the name. The website has the same picker. | `SettingsScreen.kt:150`; `backend/src/config/ttsConfig.ts:95`; `elevenLabsTtsProvider.ts:100` | Needs a product call for both clients: hide it, explain it, or have the server say which engine spoke (`X-Zarvis-TTS` already does). |
| F2 | Plans: Upgrade is off ("coming soon"); Tasks: no Run / Retry; Developer Agent: analysis only; replies arrive whole, not word by word; no offline banner; several Settings pages are English only. | `SubscriptionScreen.kt`, `TasksScreen.kt`, `ANDROID_QUEEN_DESIGN.md` "Not done yet", `UiString.LANGUAGE_SCOPE_BODY` | Each is disclosed truthfully on screen or in the design doc, so none is a fake state. Listed for completeness. |

### UX improvements (recommended, not changed: each changes intended behaviour)

| # | Finding | Evidence |
| --- | --- | --- |
| U1 | Chat's text field is disabled while a reply is being prepared or read aloud (Done flash, then Speaking), so typing a follow-up needs Stop first, although the view model already ends the voice when a new message is sent. A test documents the current behaviour as intended. | `ConversationScreen.kt:301`; `ConversationViewModel.runTurn`; `ConversationReadAloudTest.kt:417` |
| U2 | A failed Chat turn says the same thing three times: the reply bubble, the red line above the field, and the status pill. | `ConversationScreen.kt:276-282`; `failTurn` |
| U3 | Settings › Notifications › "Open Permissions & Device Access", then Back, returns to the Settings list, not to Notifications. | `SettingsScreen.kt:192` and `goBack` |
| U4 | A memory item is drawn in full (up to 2,000 characters), with no "show more". | `MemoryScreen.kt:255` |
| U5 | Plans, Developer Agent and Settings opened from Work hide the tab bar; Memory, Tasks and Metrics keep it with Work highlighted. | `NavGraph.kt` `selectedRoute` |

### Checked and found correct

* **Tasks**: Cancel is offered for every unfinished state and the badge never disagrees with it: the server keeps `status` and
  `lifecycle` in step (`backend/src/domain/types.ts` `taskLifecycle`). The website cancels without asking too.
* **Work**: each number loads on its own and a failure says "Couldn't load", never zero (`WorkViewModel`, with tests).
* **Memory, Phone action safety, Account deletion, Sign out**: loading, empty, error, busy and confirm-first states are all present.
* **Chat**: one turn at a time, stop/retry/read-aloud races, delete-after-server-confirms, process-death recovery: covered by the
  existing view-model tests.
* **Package visibility** for the app list (`<queries>` MAIN/LAUNCHER) and the voice preference wiring into `/tts/synthesize` are in
  place.
* No dead buttons were found: every clickable control leads to a real screen, request or Android setting, and the only disabled one
  (Upgrade) says why.

## 3. What changed

| Fix | Files |
| --- | --- |
| B1: Home reads tasks and plan side by side, each on its own, keeps the last good data while reading again, never starts a second read on top of one in flight, and no longer asks for `/skills`. A failed task read says "Couldn't load your recent tasks". The error card's text now names what Home loads. | `feature-home/.../HomeViewModel.kt`, `HomeScreen.kt`; `UiString.HOME_ERROR`, `HOME_TASKS_UNAVAILABLE` |
| B2: a failed turn is timed from when it was sent. | `feature-conversation/.../ConversationViewModel.kt` |
| B3: the error card shows whenever the last read failed, also above a plan shown before. | `feature-subscription/.../SubscriptionScreen.kt` |
| S1: the app list is `null` until read, the dialog shows the loading skeleton meanwhile, and a read already on its way is not started twice. | `feature-settings/.../NotificationSettings.kt` |
| S2: `QueenErrorCard` is a polite live region. | `core-ui/.../QueenComponents.kt` |
| I1: `StatusLabels.capability` is the one mapping; the capability page shows it in the app's language, Permissions keeps English (as that page is documented to be). | `domain/.../StatusLabels.kt`, `CapabilitiesScreen.kt`, `FeatureDetailScreen.kt`, `FeatureCatalog.kt`, `PermissionCenter.kt` |
| I2: the notice follows the app's language. | `ConversationViewModel.kt`; `UiString.CHAT_INTERRUPTED_EXPIRED` |

Untouched: backend, APIs, AI logic, authentication, database, voice/TTS playback, file uploads, permissions flow, Developer Agent
logic, navigation and the visual design.

Tests added: `HomeViewModelTest` (5 cases: both load; no `/skills` call; a failed task read keeps the plan and is not "no tasks";
a failed plan read keeps the tasks; a failed refresh keeps the last good data and the next good one clears the error),
`ConversationViewModelFailureTest.aFailedTurnIsTimedForUsageAndMetricsNotWrittenDownAsZero` (a 500 after 300 ms is recorded as
≥ 300 ms, not 0), and `StatusLabelsTest` (one wording per capability status, in both languages). `UiStringTest` checks the new strings'
Hindi and placeholders.

## 4. Verification and limits

* `./gradlew :domain:build` (compile + 369 unit tests, including `UiStringTest`, `StatusLabelsTest`, `NavigationReachabilityTest`):
  passed, 0 failures (368 before this change, plus 1 new).
* The Android modules could not be compiled or unit-tested in the audit environment: its network policy blocks `dl.google.com`,
  which serves the Android Gradle Plugin, AndroidX and Compose. Every changed Kotlin file was parsed with the Kotlin 2.0.21 compiler
  (no syntax errors); type checking, the new `feature-home` and `feature-conversation` tests, and Android Lint run in CI
  (`android-build.yml`).
* Not run on a real device or emulator: TalkBack announcements, the app-list loading skeleton and layout at large font sizes are
  reasoned from the code, not observed.
