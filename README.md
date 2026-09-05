# ZARVIS MOBILE

**A Universal AI Digital Agent for Android.**

> "Tell your AI what you want done. It understands the goal, plans the work, uses the
> appropriate skills and tools, completes whatever it can legitimately complete, and
> reports the result."

ZARVIS MOBILE is not a chatbot, a voice-assistant shell, or a coding tool alone. It is a
skill-driven digital agent that a non-technical user operates entirely in natural language
(English, Hindi, Hinglish) — by voice or text — across personal, phone, web, document,
business, education, professional, creative, developer, and automation tasks.

The full product and technical specification — the source of truth for every decision in
this repository — lives in **[MASTER_SPEC.md](./MASTER_SPEC.md)**. Read that first.

**Production domain:** [zarvismobile.com](https://zarvismobile.com) — see
[MASTER_SPEC.md §12a](./MASTER_SPEC.md#12a-web-client-architecture) for how the backend and
browser web client are wired to it.

## Repository layout

```
MASTER_SPEC.md          # Source of truth: product + technical specification
ARCHITECTURE.md         # System architecture deep-dive
SECURITY.md             # Security architecture and boundaries
PRIVACY.md              # User-facing privacy policy
AI_ARCHITECTURE.md      # AI provider abstraction, tool-calling loop, Gemini adapter
SKILLS.md               # Skill catalogue and authoring guide
DEVELOPER_AGENT.md       # Developer Agent design (repo analysis -> PR)
SUBSCRIPTIONS.md        # Plans, entitlements, trial, usage/credits
DEVELOPMENT.md          # Local build/run/test instructions

android/                 # Android app (Kotlin + Jetpack Compose, Gradle multi-module)
  domain/                # Pure-Kotlin core: entities, skill/tool contracts, Tool
                          # pipeline, risk engine, entitlement resolver, orchestrator
                          # planning logic. No Android dependency — builds and tests on
                          # plain JVM/Gradle without an Android SDK.
  app/, core/, data/,
  agents/, skills/,
  features/              # Android application modules (Jetpack Compose UI, Hilt DI,
                          # Room/DataStore, WorkManager) — see MASTER_SPEC.md §8

backend/                  # Node.js + TypeScript backend (Express)
                          # auth, skill catalogue, orchestrator turn endpoint, AI
                          # provider abstraction (Gemini + mock), entitlements, usage
                          # ledger, developer/web/document skills — see MASTER_SPEC.md §9.
                          # Also serves web/ as the browser client's static host.

web/                      # Browser web client (plain HTML/CSS/JS, no build step) — the
                          # same product, running at zarvismobile.com with no install.
                          # See MASTER_SPEC.md §12a.
```

## Status

This repository is at **Phase 0 → early Phase 1–3** of the roadmap in
[MASTER_SPEC.md §28](./MASTER_SPEC.md#28-development-phases): the specification is
complete, and the foundational architecture (Orchestrator, Skill Registry, Tool pipeline,
design system, backend service) is implemented with a small number of real, working
reference skills proving the pattern end-to-end, now joined by a browser web client
(§12a) and a real Gemini AI provider adapter (§10, opt-in via `GEMINI_API_KEY`). See
[MASTER_SPEC.md §29 (MVP Scope)](./MASTER_SPEC.md#29-mvp-scope) for exactly what is real
versus planned, and [§32 (Risks and Limitations)](./MASTER_SPEC.md#32-risks-and-limitations)
for what could not be verified in this environment (no Android SDK, no browser, no live
Gemini key — see [DEVELOPMENT.md](./DEVELOPMENT.md)).

## Quick start

See **[DEVELOPMENT.md](./DEVELOPMENT.md)** for full instructions. In short:

```bash
# Pure-Kotlin domain module (builds/tests without an Android SDK)
cd android && ./gradlew :domain:test

# Backend + browser web client (same server, same origin)
cd backend && npm install && npm run build && npm test
npm run dev             # then open http://localhost:3000 — the web client (web/) is
                         # served from the running backend; add GEMINI_API_KEY to
                         # backend/.env first to talk to real Gemini instead of the mock.
```

## License

Proprietary — all rights reserved (startup codebase, license to be finalized before any
public/OSS release).
