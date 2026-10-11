# ZARVIS Development

## Before coding

1. Read [ZARVIS_MASTER_PRODUCT_BLUEPRINT.md](./ZARVIS_MASTER_PRODUCT_BLUEPRINT.md).
2. Identify the current implementation phase.
3. Inspect Web, Android and shared Brain architecture.
4. Inspect permissions, ToolPipeline, voice, notifications and authentication when relevant.
5. Search for duplicate implementations.
6. Preserve existing working APIs.

## Implementation rules

- Keep shared logic centralized.
- Keep platform adapters isolated.
- Never fake execution or progress.
- Never bypass Android security.
- Do not mark a capability WORKING without evidence.
- Add or update tests for important behavior.
- Verify UI state against real backend/tool state.
- Test lifecycle and failure paths, not only happy paths.

### Android screen text, states and replies

- Text a screen shows goes through `UiString` (`android/domain/.../presentation/UiString.kt`): English and Hindi side by side, so an entry cannot exist
  without its Hindi. Draw it with `tr(UiString.X)` (`trf` when it has `%s`/`%d`). Word it like the website (`web/i18n.js`). A screen that still has
  plain English literals is not translated, so the Language page says what Hindi covers (`LANGUAGE_SCOPE_BODY`): update it when a screen moves to `tr`.
- The emulator tests find UI by exact English text (`UiStringTest` pins the ones they use); change those words and the test together.
- Never show a raw server code (`PENDING`, `DONE`, `LOW`). `StatusLabels` gives the same names as the website, and a code it has never seen is
  shown readably, not raw.
- The Work page is `WorkCatalog`: every card opens a real screen or a Chat page that says so, or is labelled "Website only" with no button.
  Every registered route must be reachable (`NavigationReachabilityTest`).
- A reply is drawn with `MarkdownText`; the parser (`Markdown`) is the website's safe subset (`web/logic.js` formatReplyHtml) and only keeps http(s) links.
  It runs on the main thread while a screen is composed, so it must never throw or stall: the rule and fence checks are character scans (a regex with a
  repeated group threw StackOverflowError on a line of a few thousand hyphens), inline matches are found once per rule and link text/addresses have a length limit,
  and a line over 20,000 characters, a reply over 100,000 characters or one with more than 2,000 lines/list items is shown as plain text (nothing is cut).
  A new piece of syntax needs a bounded scan or regex and a case in `MarkdownRobustnessTest` (it floods every token at 30,000 characters).
- The app language (Settings > Language) sets the labels, voice input and read-aloud. It is not the language of the conversation: replies follow the
  language the user writes or speaks, and the app language only breaks a tie (`detectReplyLanguage` in `backend/src/agents/orchestrator.ts`). The Language
  page says so and lists what is still English; `UiStringTest` keeps that text honest.
- Chat: which server conversation is active is owned by ONE object, `ActiveConversation` (domain). The orchestrator, the Chat tab, a chat opened from Home,
  Settings (sign-in, sign-out, delete account) and app start-up all go through it; nothing else writes the saved id. Its `state` carries a
  `ConversationStamp(id, epoch)`; the epoch changes only when the device leaves a conversation (New chat, a conversation the server no longer has, another
  account) and is never reused, so a screen that missed changes still knows what it shows is stale. Each Chat screen remembers the stamp its transcript belongs to
  and `ConversationSync` (domain) decides, from that and the server's copy, whether to keep, append to or replace it. A turn is sent under the stamp that was active
  and its answer is recorded with `adopt`, which refuses it (`Adoption.Stale`) if the device left that conversation meanwhile. New code that starts, ends or switches a
  conversation must call `ActiveConversation`, never the preference store. Tests: `ActiveConversationTest` and `ChatScreensScenarioTest` (domain),
  `AndroidOrchestratorConversationTest` (agents), `ConversationViewModelSyncTest` (the real `ConversationViewModel`, two screens, a fake backend) and
  `ChatSyncTest` (emulator, real backend process).
- Deleting a chat is a real delete: `DELETE /api/v1/conversations/:id` (backend, `Store.deleteConversation`) removes the conversation, its messages, the stored results of its turns and the
  tool runs made in it; runs that belong to a task stay in the task's history but lose the link to the chat. It answers 404 `conversation_not_found` for a chat that does not exist or is
  another account's, and the clients treat only that code as "already gone" (an old server's bare 404 is a failure, not a delete). The website deletes from the history panel after a confirmation
  and takes the chat out of its lists only once the server has answered; the Android Chat screen deletes the active chat through `AndroidOrchestrator.deleteConversation()`, which forgets it in
  `ActiveConversation` (a new epoch) so every screen starts clean. Tests: `conversationDelete.test.ts` (both stores), `phase1.e2e.cjs` (website), `AndroidOrchestratorConversationTest`,
  `ConversationViewModelSyncTest` and `LiveBackendConversationTest`.
- Contacts: a spoken name is matched by `ContactMatching` (domain), not by whatever row the phone's database returns first. `ContactLookupPort.search` returns one entry per contact (its default,
  else a mobile, number); `ContactMatching.bestMatches` keeps only the best-ranked ones (the exact name, then names that start with it, then a word that starts with it, then names that merely
  contain it). `phone.call` refuses a name that still fits several people (`ambiguous_contact`, naming them) instead of ringing one at random, and `phone.find_contact` lists them. The lookup
  escapes `%`, `_` and `\` in the name (`ContactMatching.likePattern`). `OnDeviceInputBuilder` leaves only the name in "what is mom's number", "mom ka number batao" or "call Rahul on speaker";
  `DeviceCommandGate` keeps "call me later" and "call off the meeting" out of the call skill; a bare 3-6 digit number ("112") is dialed as a number, after the usual confirmation.
  Tests: `ContactMatchingTest`, `PhoneCallSkillFactoryTest`, `PhoneFindContactSkillFactoryTest`, `OnDeviceInputBuilderTest`, `DeviceCommandGateTest`, `DeviceCommandRoutingTest`.
- A failed call is reported (and retryable), never shown as an empty list or a zero.

## Current engineering gate

**Phase 1 — Android Mobile Access + Permission Intelligence**

Later capabilities must not weaken this permission, policy and verification foundation.

## Connecting the Android app to a backend

The app has exactly one network destination, `BuildConfig.API_BASE_URL`, fixed at build time (`android/app/build.gradle.kts`). There is no in-app setting for it.

| Build | Base URL | Cleartext HTTP |
|---|---|---|
| `debug` | `http://<dev host>:<dev port>/` | Only to private addresses (loopback, RFC1918, link-local, `.local`) and `10.0.2.2`. A debug build cannot talk to an `https://` host. |
| `release` | `https://zarvismobile.com/` (the production domain) | None. There is no network security config in a release build. |

**Dev host and port, in order of precedence.** Nothing machine-specific is committed; set these on your own machine.

1. `-Pzarvis.devApiHost=<host>` on the command line, or in your personal `~/.gradle/gradle.properties` (outside the repository).
2. The `ZARVIS_DEV_API_HOST` environment variable.
3. This machine's own LAN IPv4, detected at build time.
4. `10.0.2.2`, the emulator's alias for the host machine, when there is no LAN interface. This is useless on a physical phone and the build warns about it.

The port is `-Pzarvis.devApiPort` or `ZARVIS_DEV_API_PORT`, default `3000`. The host must be a bare name or IPv4 address (`192.168.1.20`) and the port a number from 1 to 65535;
anything else (`http://192.168.1.20`, `192.168.1.20:3000`, a path) stops the build with the reason, instead of producing an app that can never connect.
The build prints `ZARVIS debug API base URL: ...  [host from ...]` so you can see what was baked in.

### Start the backend

```
cd backend && npm install && PORT=3000 npm run dev
```

No `.env` is needed for this: without `POSTGRES_URL` it uses an in-memory store (accounts vanish when it restarts), and outside `NODE_ENV=production` it uses a development-only
signing secret. Real AI answers need `GEMINI_API_KEY` in the backend's own environment (never in the app); without it the backend uses a mock provider and `GET /health` says
`"provider":"mock"`. `app.listen(port)` binds every interface, which is what a phone needs.

### Emulator

```
cd android && ./gradlew :app:installDebug -Pzarvis.devApiHost=10.0.2.2
```

The emulator reaches the host's loopback as `10.0.2.2`. Nothing else is needed.

### Phone checklist (both phone routes)

1. On the phone: Settings > About phone > tap "Build number" seven times, then Settings > System > Developer options > turn on "USB debugging". Plug it in and accept "Allow USB debugging?".
2. On the computer: `adb devices` must list the phone as `device` (not `unauthorized` or `offline`). If an emulator or a second phone is also attached, `installDebug` installs on every attached device; pick one with `ANDROID_SERIAL=<serial from adb devices>` (adb and Gradle both honour it), and use `adb -s <serial> reverse …`.
3. Gradle prints `ZARVIS debug API base URL: http://<host>:<port>/ [host from …]` while it configures: check that it is the address you meant. If a debug build cannot reach the backend, its start-up error screen shows that address and a hint for it (a release build shows only a generic message).
4. To build once and install by hand instead: `cd android && ./gradlew :app:assembleDebug -Pzarvis.devApiHost=<host>` then `adb install -r app/build/outputs/apk/debug/app-debug.apk` (`-r` keeps the app's data). If Android refuses because a build with another signature is installed, `adb uninstall com.zarvismobile.app` first; that erases the app's data on the phone.

`scripts/device/verify-device.sh` is a separate, much heavier full verification: it uninstalls ZARVIS, switches notification access, accessibility services and the default assistant during the run and restores them afterwards, and only starts with `ZARVIS_DEVICE_RESET_OK=1`. Read its header before using it; none of the steps in this section need it.

### Physical phone over USB (no Wi-Fi involved)

```
adb reverse tcp:3000 tcp:3000
cd android && ./gradlew :app:installDebug -Pzarvis.devApiHost=127.0.0.1
```

`127.0.0.1` on the phone is now the computer's port 3000. Repeat `adb reverse` after reconnecting the cable. This works behind networks that isolate Wi-Fi clients.

### Physical phone on the same Wi-Fi

1. Start the backend as above and run `./scripts/check-dev-backend.sh`. It proves the backend answers on this machine's LAN address and prints the build command. It cannot prove the phone's path.
2. Build with the LAN address (or leave `devApiHost` unset to auto-detect it): `cd android && ./gradlew :app:installDebug -Pzarvis.devApiHost=<your LAN IP>`.
3. Open `http://<your LAN IP>:3000/health` in the phone's browser. If that fails, the app will fail too. The usual causes: the phone and computer are on different networks or
   the network isolates clients (guest, hotel and many office Wi-Fi networks), the computer's firewall blocks inbound TCP 3000, or a VPN is on. Use the USB route instead.
4. The LAN IP changes with the network; rebuild when it does. The cleartext allowance covers only private addresses, so a public host is deliberately refused.

### The deployed (HTTPS) backend

The only HTTPS destination a build can have is the production domain in the `release` build type, and a release build needs signing credentials that are never in the repository:
`RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` in the environment, or the same four keys (`storeFile`, `storePassword`, `keyAlias`,
`keyPassword`) in the git-ignored `android/app/keystore.properties`. Without them `assembleRelease` still builds but the APK is unsigned and cannot be installed. A debug build
cannot be pointed at a Vercel preview or any other HTTPS host without changing `build.gradle.kts`. A release and a debug build use different signatures, so uninstall one before installing the other.
Testing against production creates real guest accounts there: use a throwaway one and delete it from Settings > Delete account afterwards.

### What has and has not been proven

- CI (`android-emulator.yml`, `scripts/emulator/verify.sh`) builds the debug APK with `-Pzarvis.devApiHost=10.0.2.2`, installs it on emulators (API 26, 30, 34), starts the real
  backend (in-memory) on the runner and runs the app against it, including the chat tests in phase F (`ConversationLifecycleTest`: one user turn is one request across rotation and
  recreation; `ChatSyncTest`: the Chat screen follows a chat or a New chat started elsewhere). That exercises the emulator wiring; it is not a physical phone.
- `LiveBackendConversationTest` (agents) drives the app's own client layer (`ApiClientFactory`, the orchestrator, the repositories) against a running backend. It is skipped
  unless `ZARVIS_LIVE_BASE_URL` is set. It creates a guest account, sends greetings (answered without AI), starts a new chat, restores and deletes the account. Run it only
  against a backend you started locally, never against production:

  ```
  cd backend && PORT=3300 npm run dev      # one terminal
  ZARVIS_LIVE_BASE_URL=http://localhost:3300/ ./gradlew :agents:testDebugUnitTest --tests '*LiveBackendConversationTest*'   # another, from android/
  ```
- Neither proves a particular phone's network path, a hosted backend's configuration, or the production domain. Those need the steps above, run by a person with the device.

## Deploying to Vercel

`vercel.json` serves `web/` as static files and routes `/api/*` and `/health` to
`api/index.ts`, which wraps the same Express app as `backend/src/index.ts`.

Vercel scopes environment variables per environment. A **Preview** deployment (every PR
branch) does not see variables that are set only for **Production**. Set these for every
environment that must work, including Preview:

| Variable | Required | Without it |
|---|---|---|
| `JWT_SECRET` | yes | The API refuses to start. `/health` → 500 `jwt_secret_missing_or_invalid`; every API call → 500. |
| `POSTGRES_URL` (or `DATABASE_URL`) | yes on Vercel | An in-memory store per serverless instance; sessions are lost between requests. `/health` → `database: not_configured`. |
| `POSTGRES_CA_CERT` or `POSTGRES_SSL_MODE=no-verify` | when the database's TLS certificate is not publicly trusted (for example a provider's own CA) | Certificate verification is on by default, so every query fails. `/health` → 503 `database: tls_certificate_untrusted`; guest sign-in → 500. |
| `GEMINI_API_KEY` | for real AI, TTS and image analysis | AI features fail closed with honest errors; image upload → 503 `image_analysis_unavailable`. |
| `INTEGRATION_ENCRYPTION_KEY` | for GitHub connections in production | GitHub connection is reported unavailable. |

Check a deployment with `GET /health`. It never returns secrets; `database` is one of `ok`,
`not_configured`, `tls_certificate_untrusted`, `auth_failed`, `unreachable`,
`schema_error` or `error`.

The **Live preview API smoke test** workflow (`.github/workflows/preview-smoke.yml`) runs
after each successful Vercel deployment. It calls `/health`, then guest sign-in, then
`/auth/me`, then a "Hi" chat turn against the live URL. For a deployment behind Vercel
Deployment Protection, add the repository secret `VERCEL_AUTOMATION_BYPASS_SECRET`.

Reading its AI steps ("a turn that needs the AI model", "web search"). The API reports what the backend knows, not Google's HTTP status:

| Result | What it means | Retried? |
|---|---|---|
| PASS "Gemini answered" | A real answer from Gemini. | No |
| WARN `AI_RATE_LIMITED` | A per-minute limit. Temporary. | Once, after 65 s |
| WARN `AI_UNAVAILABLE`, `retryable:true` | Google was overloaded or down (408/5xx). Temporary. | Once, after 15 s |
| WARN `AI_QUOTA_EXCEEDED` | The daily quota is used up; it cannot recover within a run. | No |
| FAIL `AI_UNAVAILABLE`, `retryable:false` | Not a rate limit and not an outage: Google refused the call or no model is available (key or permission, model name, a rejected request), or no AI key is configured. Check `GEMINI_API_KEY` and `GEMINI_MODEL` for that environment. The function log has the provider status and model: search `stopped by the AI provider` (and `aiCallLog` in `Turn finished`). | No |

A WARN is never counted as a pass. A retry becomes a PASS only if Gemini really answers, and the report says it took a retry and what the first attempt was.
