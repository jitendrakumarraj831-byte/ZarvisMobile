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
