# DEVELOPMENT

How to build and run this repository locally.

## Prerequisites

- **JDK 21** (for the Android/Kotlin `domain` module and Gradle)
- **Node.js 22+** (for the backend)
- An **Android SDK + Android Studio** if you intend to build/run the full `android/app`
  module. **Not required** to build or test `android/domain` — see below.

## Pure-Kotlin `domain` module (no Android SDK needed)

`android/domain` uses the `kotlin("jvm")` Gradle plugin, not the Android Gradle Plugin, so
it builds and tests on any machine with a JDK — this is deliberate (see
[MASTER_SPEC.md §31](./MASTER_SPEC.md#31-technical-decisions) and
[ARCHITECTURE.md](./ARCHITECTURE.md#why-a-pure-kotlin-domain-module)).

```bash
cd android
./gradlew :domain:build       # compiles and runs unit tests
./gradlew :domain:test        # unit tests only
```

## Full Android app

The remaining modules (`app`, `core/*`, `data/*`, `agents`, `skills`, `features/*`) use the
Android Gradle Plugin and require a standard Android Studio setup (Android SDK, an
emulator or device) to build, run, and instrument-test. **This repository's automated
environment does not have an Android SDK installed**, so those modules are written as
complete Kotlin/Compose source consistent with
[MASTER_SPEC.md §8](./MASTER_SPEC.md#8-android-architecture) but have not been
build-verified by the agent that authored them — open `android/` in Android Studio to
build/run them. This limitation is recorded in
[MASTER_SPEC.md §32](./MASTER_SPEC.md#32-risks-and-limitations); closing it (CI with an
Android SDK image, instrumented tests) is Phase 12 work.

The app talks to the same backend the web client does (`data-remote`'s `ZarvisApi`,
MASTER_SPEC.md §25), via a base URL compiled into `BuildConfig.API_BASE_URL` by
`app/build.gradle.kts` — `release` is `https://zarvismobile.com/`, `debug` is your local
dev backend (`cd backend && npm run dev`).

### Pointing a debug build at your dev backend

**A physical phone cannot use `10.0.2.2`.** That address is the *emulator's* NAT alias for
the host machine's loopback; a real phone is a separate machine on your Wi-Fi and has no
route to it at all. Symptoms of a build that still uses it are a startup failure like
`Failed to connect to /10.0.2.2:3000` or, before this was fixed, `CLEARTEXT communication
to 10.0.2.2 not permitted by network security policy`.

So the debug host is resolved per build machine, in this order:

1. `-Pzarvis.devApiHost=<host>` on the command line, or `zarvis.devApiHost=<host>` in any
   `gradle.properties` — including your **personal** `~/.gradle/gradle.properties`
   (`%USERPROFILE%\.gradle\gradle.properties` on Windows), which lives outside the repo so a
   machine-specific address is never committed.
2. The `ZARVIS_DEV_API_HOST` environment variable (CI and scripted builds).
3. **Auto-detected**: this machine's own LAN IPv4 — the address a phone on the same Wi-Fi
   dials. This is the default, so a plain `./gradlew :app:assembleDebug` (or hitting Run in
   Android Studio) already produces an APK a physical device can talk to.
4. `10.0.2.2`, only if no LAN interface was found at all. The build logs a warning when it
   falls back this far.

Every build prints what it resolved, so you can always check what the APK will dial:

```
$ ./gradlew :app:assembleDebug
ZARVIS debug API base URL: http://192.168.1.50:3000/  [host from auto-detected LAN address of this machine]
```

Use `-Pzarvis.devApiHost` when auto-detection picks the wrong interface (multiple NICs, a
VPN) or when the backend runs somewhere else entirely; `-Pzarvis.devApiPort` (default
`3000`) sets the port:

```bash
./gradlew :app:assembleDebug -Pzarvis.devApiHost=192.168.1.50 -Pzarvis.devApiPort=3000
```

The address the app shows on its startup error screen is the one it actually used, so a
phone that can't connect tells you which backend it was configured for.

Before building for a device, confirm the backend is reachable the way the phone will reach
it — over the LAN rather than loopback:

```bash
./scripts/check-dev-backend.sh          # auto-detects this machine's LAN IP
./scripts/check-dev-backend.sh 192.168.1.50 3000
```

The backend itself needs no configuration: `backend/src/index.ts` calls `app.listen(port)`
with no host argument, so Node binds the unspecified address rather than loopback only.
What does commonly block a phone is the **host firewall** (allow inbound TCP 3000) and
**client isolation** on guest/corporate/hotspot Wi-Fi, which blocks device-to-device traffic
outright; on such a network use a phone hotspot the laptop joins, or a tunnel. To check the
phone's own path, open `http://<your-lan-ip>:3000/health` in the phone's browser — the
script can only prove the *build machine* can reach it. A USB-only alternative that avoids
the network entirely is `adb reverse tcp:3000 tcp:3000` with
`-Pzarvis.devApiHost=127.0.0.1`, which the generated config also permits.

The debug APK built in CI is pinned to `10.0.2.2` (a runner's own address would be
meaningless to download), so it is emulator-only — build locally for a phone.

### Cleartext HTTP in debug builds

The dev backend is plain HTTP and Android 9+ (API 28) blocks cleartext by default, so debug
builds ship a network security config that exempts it. It is **generated** per build by
`app/build.gradle.kts`'s `generateDebugNetworkSecurityConfig` task rather than checked in,
because the host needing the exemption is machine-specific and Android's config format can
only name literal hosts, never address ranges:

```xml
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">192.168.1.50</domain>  <!-- your dev host -->
        <domain includeSubdomains="false">10.0.2.2</domain>      <!-- emulator alias -->
        <domain includeSubdomains="false">127.0.0.1</domain>     <!-- adb reverse -->
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
</network-security-config>
```

Two properties this deliberately keeps, both enforced by the `Android build` workflow:

- **Cleartext is never permitted app-wide.** `base-config` stays `false`, so every host
  other than the dev backend keeps the platform's HTTPS-only default, even in debug.
- **Only private addresses are ever exempted.** Loopback, RFC1918, link-local and
  `.local`/`localhost` names qualify. Point `zarvis.devApiHost` at a *public* host and it is
  deliberately **not** exempted (the build warns) — a real domain must be reached over
  HTTPS, not silently downgraded to plaintext.

The task is wired into the debug variant's resources only, and the manifest attribute that
references it lives in `app/src/debug/AndroidManifest.xml`, so **release builds have no
network security config at all** and keep the platform default — see SECURITY.md.

`release` has no host override flag; point it at a different backend by editing its
`buildConfigField` directly (unlike the web client's `?api=` query param, this is compiled
app config, not a browser URL).

### Release build & signing (Play Store submission)

No production keystore is ever committed to this repository — secrets live outside source
control (SECURITY.md). `app/build.gradle.kts` resolves signing credentials, in order:

1. `RELEASE_STORE_FILE` / `RELEASE_STORE_PASSWORD` / `RELEASE_KEY_ALIAS` / `RELEASE_KEY_PASSWORD`
   environment variables (CI / scripted release builds).
2. `android/app/keystore.properties` (git-ignored — see `android/.gitignore`), the same 4
   keys as `key=value` lines, for a local release build:

   ```properties
   storeFile=/absolute/path/to/your-release.jks
   storePassword=...
   keyAlias=...
   keyPassword=...
   ```

Generate a keystore if you don't have one yet (standard `keytool`, part of every JDK):

```bash
keytool -genkeypair -v -keystore release.jks -alias zarvis -keyalg RSA -keysize 2048 -validity 10000
```

**Back this keystore up somewhere durable and never lose it.** Play Store ties an app's
listing to the signing identity it was first uploaded with (directly, or as the upload key
under Play App Signing) — losing it means you can never publish an update to the same app
listing again.

Without real credentials, `./gradlew :app:assembleRelease` still succeeds (useful as a
compile-verification step) but produces an **unsigned** APK/AAB: installable on no device,
rejected by Play Console. The build logs a warning naming exactly what's missing when this
is the case.

## Backend

```bash
cd backend
npm install
npm run build     # TypeScript -> dist/, fails the build on type errors
npm test          # vitest unit + integration tests
npm run dev        # local dev server with the mock AI provider and in-memory store
```

Copy `backend/.env.example` to `backend/.env` to configure real provider/GitHub/DB
credentials — the server runs fully functional against mocks with no `.env` at all,
which is the default for local development and CI (see
[AI_ARCHITECTURE.md](./AI_ARCHITECTURE.md) and [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md)).
Set `GEMINI_API_KEY` there to switch the orchestrator's default provider from
`MockAIProvider` to live Google Gemini calls — get a key from
[aistudio.google.com/apikey](https://aistudio.google.com/apikey).

## Web client (browser)

`web/` (repo root) is a plain HTML/CSS/JS client — no build step, no separate dependency
install — served automatically by the backend from the same origin. See
[MASTER_SPEC.md §12a](./MASTER_SPEC.md#12a-web-client-architecture).

```bash
cd backend && npm run dev
# then open http://localhost:3000 in a browser
```

It calls the same `/api/v1/*` routes the Android app calls, bootstraps a guest account on
first load (mirrors the Android app's device-scoped account, §32), and works with either
`MockAIProvider` or a configured `GEMINI_API_KEY` with no client-side change. To point the
client at a different backend host, open it with `?api=https://your-backend/api/v1`.

### Voice quality

`web/app.js`'s `speak()` calls `POST /api/v1/tts/synthesize` first — Gemini's own
native-audio-output voice (`backend/src/ai/geminiTts.ts`), the same underlying voice
technology behind the Gemini app's voice mode, using the same `GEMINI_API_KEY` already
configured (no separate credential). If that call fails for any reason (not configured,
offline, rate-limited), it falls back to the browser's built-in `speechSynthesis` —
picking its best available network voice for the current language, with a manual voice
picker in the topbar once more than one is available (persisted in `localStorage`) — so
voice output never silently goes dead, per Product Principle #4.

`GEMINI_TTS_MODEL`/`GEMINI_TTS_VOICE` (`.env.example`) configure the model and one of
Gemini's fixed prebuilt voice names (e.g. `Kore`, `Puck`, `Charon`, `Aoede`, `Fenrir`).
Live-verified in this repository: a real signed WAV response, confirmed to be real speech
(not silence) by inspecting its PCM sample RMS/peak amplitude, not just a non-error status
code.

**Note this is a different, separate integration from Google Cloud Text-to-Speech**
(Neural2/Studio/Chirp voices) — that remains a documented-but-unimplemented option if
Gemini's prebuilt voices aren't sufficient later; it needs its own Cloud project and
credential, unlike the native-audio route actually wired in here.

### Hands-free "wake word" mode

Arms itself automatically on every page load (per explicit product request — no tap
needed): say "Zarvis" (or a close mishearing like "Jarvis" — most speech recognizers have
never seen the actual word and fall back to the much more common one) followed by a
command, e.g. *"Zarvis, find the best phone under 20000"*. Tapping the orb mutes/unmutes it
manually. This is a software approximation of a wake word built on the Web Speech API's
`continuous`/auto-restart pattern (`setupSpeechRecognition()` in `app.js`), **not** a true
low-power OS wake-word detector: it only works while the tab is open and in the
foreground, and every second of "armed" audio is sent to the browser's speech-recognition
service exactly like a manual mic tap would be — stated honestly rather than oversold. The
armed/muted choice itself is intentionally never persisted across a reload — it always
re-arms fresh rather than remembering a muted state indefinitely, so it can't end up
silently listening in a way the person in front of the screen forgot was ever turned on.

Deliberately quiet by design (explicit product feedback: it should listen for "Zarvis" in
the background without announcing itself, the same way a phone's real wake word doesn't
pop up a notification every time it starts listening) — arming or muting shows no bubble
or toast. The transparency trade-off is the subtle cyan ring around the orb whenever armed
(so it stays inspectable, not literally secret — MASTER_SPEC.md §15) plus the fact that
the very first visible/audible reaction only happens once "Zarvis" is actually heard
(`acknowledgeWakeWord()`/`submitUtterance()` in `app.js`), not before.

Not testable end-to-end in this environment — the sandbox this was built in has no
microphone hardware at all (Chrome's Web Speech API failed immediately with an
`audio-capture` error even with WebRTC fake-device flags, which don't extend to
`SpeechRecognition`), so only the arm/error/recovery logic was verified, not real
wake-word detection accuracy. Test on a real device before relying on it.

### Personalizing replies with a name

`POST /api/v1/orchestrator/turn` accepts an optional `userName`, folded into the system
prompt (`orchestrator.ts`) so Gemini can address the user by name naturally. `web/app.js`
sends whatever is in `localStorage["zarvis.userName"]` with every turn, defaulting it to
the product owner's name on first load (no settings screen exists yet to change it — see
MASTER_SPEC.md §32 "No login screen yet"; edit `localStorage` directly for now). This is a
display label only, never an identity/auth claim — the account itself is authenticated by
the bearer token regardless of what this field says.

### First-reply warmth

The turn request also carries `isFirstTurn` (`web/app.js` tracks it client-side, true only
once per page load), asking Gemini for one short, warm, energetic welcome-style opening
line before the very first reply of a session — every later turn stays direct and concise.
Live-verified this actually reaches the user even when the model also invokes a skill in
that same first turn: `Orchestrator.runTurn` used to build the returned `message` purely
from the tool-pipeline outcome, discarding any conversational text the model attached to a
tool-calling response — silently swallowing that greeting exactly when it mattered most
(a first request like "find me a phone" that immediately triggers `web.search`). Fixed by
prepending `aiResponse.message.content` when present; the system prompt also had to say
explicitly that a tool call must still carry that greeting as accompanying text, since
Gemini's default behavior for a clear, actionable first request was a tool call with no
text at all.

## Deploying to Vercel (public URL, e.g. zarvismobile.com)

This is how the web client (§12a) becomes reachable at a real URL in any browser, not just
`localhost` — the step before an Android build exists to try. `vercel.json` (repo root) and
`api/index.ts` wrap the same `buildContainer()`/`buildServer()` composition root
`backend/src/index.ts` uses, as a Vercel serverless function; `web/` is served as static
files by the same deployment (see `vercel.json`'s `routes` for exactly which path goes
where). This has been sanity-checked in this repository by bundling `api/index.ts` with
esbuild (what Vercel's Node builder uses) and running the bundle directly — health check,
signup, and the skill catalogue all worked — but not by an actual `vercel deploy`, which
needs a real Vercel account this environment doesn't have.

**One-time setup (Vercel dashboard or CLI), done by whoever owns the Vercel account:**

1. Import this GitHub repository into Vercel (New Project → this repo). Leave the Root
   Directory as the repo root (not `backend/`) — `vercel.json` and `api/index.ts` are at
   the top level on purpose so one project serves both the API and `web/`.
2. Project Settings → Storage → add a Postgres database (e.g. Vercel Postgres/Neon) and
   connect it to this project — Vercel sets `POSTGRES_URL` automatically. This is required,
   not optional: without it the backend falls back to the in-memory `Store` (see "Known
   limitation" below), which breaks refresh tokens and every authenticated endpoint soon
   after signup/login on a serverless deployment.
3. Project Settings → Environment Variables → add `GEMINI_API_KEY` (from
   [aistudio.google.com/apikey](https://aistudio.google.com/apikey)) so the deployed
   backend uses live Gemini instead of the mock — same variable as `backend/.env.example`,
   just set through Vercel's dashboard instead of a local file. `PUBLIC_APP_URL` and
   `CORS_ORIGINS` (see `.env.example`) already default to `zarvismobile.com`; only override
   them if deploying under a different domain.
4. Project Settings → Domains → add `zarvismobile.com` (and `www.zarvismobile.com`), then
   update the domain's DNS at the registrar (GoDaddy) to the records Vercel's dashboard
   shows for it (typically an `A` record to Vercel's IP for the apex domain and a `CNAME`
   to `cname.vercel-dns.com` for `www`) — Vercel's domain settings page shows the exact
   values to use once the domain is added there.
5. Deploy (Vercel redeploys automatically on every push to `main` once the project is
   imported).

Or from the CLI, once logged in (`npx vercel login`) and with a project token:
`npx vercel --prod --token=<token>`.

**Formerly a known limitation, now fixed:** `backend/src/store/inMemoryStore.ts` keeps
accounts/tasks/usage in a plain in-process `Map`, which does not survive a serverless
deployment routing a request to a fresh, cold instance — this previously broke refresh
tokens and every authenticated endpoint (`/api/v1/auth/refresh`, `/api/v1/skills`,
`/api/v1/orchestrator`, `/api/v1/tts/*`, ...) soon after signup/login in production.
`backend/src/store/postgresStore.ts` implements the same `Store` interface against a real
Postgres database and is selected automatically whenever `POSTGRES_URL`/`DATABASE_URL` is
set (see step 2 above) — `container.ts` falls back to the in-memory store only when neither
is configured, which should never be the case for a deployed environment.

## Repository conventions

- `MASTER_SPEC.md` is updated **before** any change that alters an architectural decision
  — never let the spec and the code silently diverge (see the top of MASTER_SPEC.md).
- New capabilities are added as Skills (see [SKILLS.md](./SKILLS.md)), not as one-off
  branches in the Orchestrator.
- Every skill handler must run through the shared Tool pipeline — see
  [SECURITY.md](./SECURITY.md) and [ARCHITECTURE.md](./ARCHITECTURE.md).
- Commit messages and PRs describe *why*, not just *what* — the diff already shows what.

## CI

Not yet configured in this pass (see [MASTER_SPEC.md §28 Phase 12](./MASTER_SPEC.md#28-development-phases)).
Until then, run `./gradlew :domain:build` and `npm run build && npm test` (in `backend/`)
locally before pushing.
