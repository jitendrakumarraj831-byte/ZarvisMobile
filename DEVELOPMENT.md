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
- Chat: the Chat tab and a chat opened from Home are two screens over ONE stored conversation id. `ConversationSync` (domain) decides how they stay in step;
  `AndroidOrchestratorConversationTest` (agents) pins which id a turn carries, that New chat clears it and that a cancelled turn cannot bring it back.
- A failed call is reported (and retryable), never shown as an empty list or a zero.

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
| `GEMINI_API_KEY` | for real AI, TTS and image analysis | AI features fail closed with honest errors; image upload → 503 `image_analysis_unavailable`. |
| `INTEGRATION_ENCRYPTION_KEY` | for GitHub connections in production | GitHub connection is reported unavailable. |

Check a deployment with `GET /health`. It never returns secrets; `database` is one of `ok`,
`not_configured`, `tls_certificate_untrusted`, `auth_failed`, `unreachable`,
`schema_error` or `error`.

The **Live preview API smoke test** workflow (`.github/workflows/preview-smoke.yml`) runs
after each successful Vercel deployment. It calls `/health`, then guest sign-in, then
`/auth/me`, then a "Hi" chat turn against the live URL. For a deployment behind Vercel
Deployment Protection, add the repository secret `VERCEL_AUTOMATION_BYPASS_SECRET`.
