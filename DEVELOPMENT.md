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

## Deployment (and why the Vercel URL 404s)

This repository has **no web frontend** — the product is an Android app (`android/`) plus
a backend API server (`backend/`); see [MASTER_SPEC.md §1](./MASTER_SPEC.md#1-product-vision).
A web dashboard is not part of the current specification (the only "dashboard" mentioned
anywhere in `MASTER_SPEC.md` is a possible *future* internal observability/tracing tool
under §30 Future Roadmap — not a user-facing product surface, and not scheduled).

If a Vercel project is attached to this GitHub repo, every push triggers a zero-config
build. Vercel finds no root `package.json`, no static site, and no recognized framework
(`backend/`'s `package.json` is one directory down and is a plain Node/Express API server,
not a Vercel-deployable frontend or serverless-function layout) — so it produces an empty
build output, and every URL on that deployment 404s. **This is expected**, not a bug: there
is nothing here for Vercel to serve.

`vercel.json` at the repo root sets `"ignoreCommand": "exit 0"`, which tells Vercel to skip
the build step on every push — a real, minimal configuration fix for the underlying issue
(a zero-config build attempting to deploy a repo with no deployable web output on every
push), not a workaround. It stops *future* pushes from producing new empty/404 deployments.
It does **not** retroactively remove an already-existing 404 deployment/URL — Vercel does
not revert a project's production alias when a later build is skipped. To fully clear an
existing 404 page (or stop Vercel from being attached to this repo at all), disconnect or
delete the Vercel project from the Vercel dashboard (Project → Settings → Git →
Disconnect, or delete the project) — this repository has no Vercel API access to do that
programmatically.

If a real web dashboard is added to the product later, update
[MASTER_SPEC.md §1](./MASTER_SPEC.md#1-product-vision) and §22 (UI/UX System) **first**
with its scope, then remove `vercel.json`'s `ignoreCommand` and add the frontend's own
build configuration — never add frontend files solely to make a deployment target stop
404ing.

The backend itself is not currently suited for Vercel's serverless model even if a route
were added: its `Store` (see [MASTER_SPEC.md §31](./MASTER_SPEC.md#31-technical-decisions))
is an in-memory adapter, and serverless functions are stateless and cold-start per
invocation/instance — every request could see a different, empty store, silently breaking
auth, entitlements, and tasks. Deploying the backend for real means running it as a
long-lived Node process (`npm run build && npm start`, per §DEVELOPMENT's Backend section
above) on a host suited to that (a container, a VM, a platform's "web service"/long-running
process tier) — and, per the Postgres migration path already documented in §31, backing it
with real persistent storage before it serves real traffic.

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
