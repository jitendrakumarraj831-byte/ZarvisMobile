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

## Current engineering gate

**Phase 1 — Android Mobile Access + Permission Intelligence**

Later capabilities must not weaken this permission, policy and verification foundation.

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
| `GEMINI_API_KEY` | for real AI, image analysis and web search | Without it (and without OpenRouter) AI features fail closed with honest errors; image upload → 503 `image_analysis_unavailable`. |
| `OPENROUTER_API_KEY` | optional: the AI fallback (and the only AI if there is no Gemini key) | No fallback; ZARVIS runs on Gemini alone. See [AI_MODEL_GATEWAY.md](./AI_MODEL_GATEWAY.md) for `OPENROUTER_MODEL`, `OPENROUTER_MODEL_CAPABILITIES`, `AI_PRIMARY_PROVIDER`, `AI_FALLBACK_PROVIDER` and the rest. |
| `TTS_PROVIDER`, `TTS_HI_VOICE`, `TTS_EN_VOICE`, `TTS_HINGLISH_VOICE` | optional: spoken replies use Edge's neural voices and need **no key**; these only change the voices (`TTS_PROVIDER=none` switches voice off) | The defaults speak: `hi-IN-SwaraNeural` for Hindi, `en-US-JennyNeural` for English. A wrong value is logged and replaced by the default. See [AI_MODEL_GATEWAY.md](./AI_MODEL_GATEWAY.md) §2.14. |
| `INTEGRATION_ENCRYPTION_KEY` | for GitHub connections in production | GitHub connection is reported unavailable. |

Set the AI variables in **Production and Preview**, then redeploy (a changed variable applies to new
deployments only). `/health` shows `provider` and, while a fallback provider is active,
`aiFallback: true` and `aiFallbackTools` (`false` means the fallback model declares no tool support,
so chat turns will not fall back; set `OPENROUTER_MODEL_CAPABILITIES=tools`); a present-but-invalid
AI setting makes it answer 500 `ai_provider_config_invalid` (the function log names the variable).
Local `.env` files are git-ignored.

Check a deployment with `GET /health`. It never returns secrets; `database` is one of `ok`,
`not_configured`, `tls_certificate_untrusted`, `auth_failed`, `unreachable`,
`schema_error` or `error`.

The **Live preview API smoke test** workflow (`.github/workflows/preview-smoke.yml`) runs
after each successful Vercel deployment. It calls `/health`, then guest sign-in, then
`/auth/me`, then a "Hi" chat turn against the live URL, and both voice endpoints (they must return
real 24 kHz audio: that is the check that the voice works from where the API is deployed). For a
deployment behind Vercel Deployment Protection, add the repository secret
`VERCEL_AUTOMATION_BYPASS_SECRET`.

## Voice quality

Spoken replies are made on the server, not by the browser or the phone: `POST /api/v1/tts/synthesize`
(a WAV file) and `POST /api/v1/tts/synthesize-stream` (24 kHz PCM) use Microsoft Edge's neural
voices, which need no key or account (`backend/src/tts/`; the whole story is in
[AI_MODEL_GATEWAY.md](./AI_MODEL_GATEWAY.md) §2.14). The voice is chosen from the text: Hindi in
Devanagari, Hinglish, or English. The browser's own `speechSynthesis` is deliberately not a fallback,
and the phone's built-in speaker (`NotificationSpeaker`, for spoken notifications) is a separate,
on-device thing that this does not touch.

To try the real service from a machine that can reach it:
`ZARVIS_LIVE_TESTS=1 npx vitest run test/live/edgeTts.live.test.ts` (in `backend/`), or run the
**Edge TTS live probe** workflow. It is an unofficial service with no guarantee: if it stops working,
`TTS_PROVIDER=none` makes the app say so honestly, and the provider boundary
(`backend/src/tts/provider.ts`) is where another voice would plug in.
