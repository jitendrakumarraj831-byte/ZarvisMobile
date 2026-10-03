# ZARVIS environment matrix

- **Date:** 2026-10-02. No secret value appears in this file or was read to write it.
- **Sources:** every `process.env.*` read in `backend/src` and `api/` (they all go through
  `backend/src/config/env.ts`, except `NODE_ENV` in `api/index.ts`), `backend/.env.example`,
  `.github/workflows/*.yml`, `android/app/build.gradle.kts`.
- **"Configured" evidence:** the live smoke runs on PR #79's Preview deployments (2026-10-02,
  job 110967802275 and later): `/health` `{status: ok, provider: google, database: ok}`; guest,
  email sign-up, login, refresh, logout and account deletion all work; a real Gemini answer;
  TTS returns `audio/wav`; PDF extraction works. **Production** (`zarvismobile.com`) was not reachable or
  checked from this session, so every Production cell is **NOT VERIFIED**.

Legend: **Req** = required for that environment to work; **Preview** = Vercel Preview scope.

## 1. Backend (Vercel serverless function and local server)

| Variable | Purpose | Used by | Local / CI | Preview | Production | Req | Status |
|---|---|---|---|---|---|---|---|
| `NODE_ENV` | `production` enables fail-closed paths (JWT required, no mock AI/search/content, real billing verifier) | `env.ts`, `api/index.ts` | `test` / unset | set by Vercel to `production` | set by Vercel | — | OK |
| `JWT_SECRET` | signs access and refresh tokens | `config/env.ts` `resolveJwtSecret` | dev default when unset | **configured** (server started; guest + `/me` work) | NOT VERIFIED | **yes** in production (startup refuses without it) | OK (Preview) |
| `POSTGRES_URL` / `DATABASE_URL` | Postgres store; `POSTGRES_URL` wins | `env.ts` → `container.ts` | CI service container (`TEST_DATABASE_URL`, `E2E_DATABASE_URL` are test-only) | **configured** (`database: ok`) | NOT VERIFIED | **yes** on serverless (in-memory state is lost between instances) | OK (Preview) |
| `POSTGRES_CA_CERT` | PEM for a database whose certificate is not publicly trusted | `postgresStore.ts` `poolConfigFor` | unset | not needed for Neon (publicly trusted) | NOT VERIFIED | only for a private CA | OK |
| `POSTGRES_SSL_MODE` | `no-verify` = explicit, logged opt-out of TLS verification | `postgresStore.ts` | unset | should stay unset | NOT VERIFIED | no; **should not be set** | OK |
| `GEMINI_API_KEY` | Gemini chat, search grounding, TTS, image analysis | `providerFactory.ts`, `skills/index.ts`, `tts`, `documents.ts` | unset (mock in dev/tests) | **configured and valid**: live smoke on the preview got a real Gemini answer and real TTS audio | NOT VERIFIED | **yes** for any AI answer; production fails closed without it | OK (Preview) |
| `GEMINI_MODEL` | chat model (default `gemini-3.6-flash`; the retired `gemini-2.5-flash` is remapped) | `env.ts` | default | unknown (default if unset) | NOT VERIFIED | no | OK |
| `GEMINI_TTS_MODEL` | TTS model (default `gemini-3.8-flash-lite-tts`) | `env.ts` | default | unknown | NOT VERIFIED | no | OK |
| `GEMINI_TTS_VOICE` | default voice (`Kore`) | `env.ts` | default | unknown | NOT VERIFIED | no | OK |
| `OPENROUTER_API_KEY` | OpenRouter: the AI fallback provider (and the only provider when there is no Gemini key) | `providerFactory.ts` → `OpenRouterProvider` | unset | NOT VERIFIED (set it in Preview to test) | NOT VERIFIED | no; absent = Gemini only | **NOT VERIFIED** (OpenRouter was not reachable from the build environment) |
| `OPENROUTER_BASE_URL` | OpenRouter API address; https only (http for localhost) | `config/aiConfig.ts` | default `https://openrouter.ai/api/v1` | default | default | no | OK (validated at startup) |
| `OPENROUTER_MODEL` | model sent to OpenRouter (default `openrouter/free`) | `config/aiConfig.ts` | default | default | default | no | OK |
| `OPENROUTER_MODEL_CAPABILITIES` | what that model can do beyond text/streaming: `tools`, `vision`, `structuredOutput`, `coding`, `reasoning`. Nothing is assumed | `config/aiConfig.ts` | unset | unset | unset | **set `tools` for the planner to fall back** | OK (a safe default; documented) |
| `OPENROUTER_MODEL_CONTEXT_TOKENS`, `OPENROUTER_TIMEOUT_MS` | declared context window (32768); time to response headers (60 s) | `config/aiConfig.ts` | default | default | default | no | OK |
| `AI_PRIMARY_PROVIDER`, `AI_FALLBACK_PROVIDER` | `gemini` / `openrouter` / `none`; defaults: gemini primary, the other provider as fallback | `config/aiConfig.ts` | unset | unset | unset | no | OK (an invalid value stops startup: `/health` 500 `ai_provider_config_invalid`) |
| `AI_QUOTA_COOLDOWN_MS`, `AI_MODEL_CATALOG_JSON` | quota cooldown (5 min); a JSON description of several models | `config/aiConfig.ts` | unset | unset | unset | no | OK |
| `INTEGRATION_ENCRYPTION_KEY` | AES-256-GCM key (base64, 32 bytes) for stored per-user GitHub tokens | `container.ts` `SecretBox.fromEnv` | dev derivation from JWT secret | unknown | NOT VERIFIED | **yes** for the Developer Agent in production (GitHub connect reported unavailable otherwise) | NOT VERIFIED |
| `GITHUB_API_BASE_URL` | GitHub REST base (tests point it at a stub) | `env.ts` | `http://localhost:3200` in E2E | unset (default) | unset (default) | no | OK |
| `CORS_ORIGINS` | allowed browser origins for cross-origin calls | `security/cors.ts` | localhost list | default list | NOT VERIFIED | no (web is same-origin) | OK |
| `PLAY_BILLING_SERVICE_ACCOUNT_JSON` | Google Play Developer API verification | `playBillingVerifier.ts` | unset (mock verifier outside production) | unknown | NOT VERIFIED | for paid plans only; production fails closed without it | NOT VERIFIED |
| `PLAY_BILLING_PACKAGE_NAME` | Play package (`com.zarvismobile.app`) | `env.ts` | default | default | default | no | OK |
| `PORT` | local server port | `index.ts` | 3000 / 3100 (E2E) | not used on Vercel | not used | no | OK |
| `PUBLIC_APP_URL` | — | removed in PR #79 (it was read and never used) | — | — | — | — | removed |
| `ANTHROPIC_API_KEY` | — | removed in PR #79 (it was read and never used) | — | — | — | — | removed |
| `OPENAI_API_KEY` | — | removed in PR #79 (it was read and never used) | — | — | — | — | removed |

Every AI key is server-side only. Local `.env` files (including a `.env.local` from `vercel env pull`
at the repo root) are git-ignored; only `backend/.env.example` (placeholders) is tracked.

No backend variable is read by the browser bundle: the web client is plain static files with no
build step, and `grep` finds no `process.env` in `web/`. Nothing server-only is exposed to the
client.

## 2. GitHub Actions

| Secret / variable | Used by | Purpose | Status |
|---|---|---|---|
| `VERCEL_AUTOMATION_BYPASS_SECRET` | `preview-smoke.yml` | passes Vercel Deployment Protection for the live smoke test | **configured** (log: "Vercel protection bypass secret: configured") |
| `TEST_DATABASE_URL`, `E2E_DATABASE_URL` | `backend-tests.yml` | point at the job's own Postgres service | OK (no secret) |
| `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` | `android/app/build.gradle.kts` | release signing | **absent by design** in CI: release APK/AAB are built unsigned |

## 3. Android build

| Input | Where | Debug | Release | Status |
|---|---|---|---|---|
| `zarvis.devApiHost` / `ZARVIS_DEV_API_HOST` | Gradle property / env | dev host (LAN IP; CI pins `10.0.2.2`) → `http://<host>:3000/` | not used | OK |
| `zarvis.devApiPort` / `ZARVIS_DEV_API_PORT` | Gradle property / env | default 3000 | — | OK |
| `API_BASE_URL` (BuildConfig) | generated | `http://<dev-host>:<port>/`, cleartext only for that host (CI-asserted) | `https://zarvismobile.com/` (CI-asserted) | OK |
| Signing (`keystore.properties` or the four `RELEASE_*` env vars) | `build.gradle.kts` | debug key | **not configured anywhere in the repo**: no installable release build exists yet | MISSING (expected until release) |
| API keys | — | none in the app; every provider key stays server-side (scanned: no `AIza…`, `ghp_…`, `sk-…`, `JWT_SECRET`, `POSTGRES_URL` in Android sources) | same | OK |

Known gap (ANDROID-1, PR #78): there is no build switch to point a debug build at an HTTPS
preview URL. A device can test against a local backend, or against production after merge.

## 4. Environment parity: Preview vs Production

| Concern | Finding |
|---|---|
| Same code | Vercel builds the same `api/index.ts` + `web/**` for both |
| Same runtime mode | both run with `NODE_ENV=production` |
| Different variables | possible: Vercel scopes variables per environment. The PR #78 history (BACKEND-1) is exactly this: `JWT_SECRET` and `GEMINI_API_KEY` were missing in **Preview** only |
| Detection | `/health` names `provider` and `database`; the smoke test (now with a model-backed turn) runs on every successful deployment. It runs on Preview deployments; nothing checks Production after a promotion |
| Recommendation | after merge, run the smoke workflow manually (`workflow_dispatch`, `url: https://zarvismobile.com`) and keep the Production variables identical in name to Preview |
