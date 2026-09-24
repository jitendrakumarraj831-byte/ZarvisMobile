/**
 * Vercel serverless entrypoint — wraps the exact same Express app `backend/src/server.ts`
 * builds (see MASTER_SPEC.md §12a, DEVELOPMENT.md "Deploying to Vercel"). Vercel's Node.js
 * runtime accepts a default-exported `(req, res)` function as a request handler directly, so
 * no separate adapter code is needed; this file only wires the same `buildContainer()` +
 * `buildServer()` composition root `backend/src/index.ts` uses for a normal long-running
 * process, then forwards each request to the resulting Express app (itself just a callable
 * `(req, res)` handler).
 *
 * `bootstrapEnv` is dynamically imported (below) for local parity (`vercel dev`) — in a real
 * Vercel deployment, environment variables come from the Vercel project's own configured env
 * vars, not a `.env` file, and `process.loadEnvFile()` finding nothing there is a no-op (see
 * backend/src/bootstrapEnv.ts).
 *
 * `buildContainer()` picks `backend/src/store/postgresStore.ts` over the in-memory store
 * whenever `POSTGRES_URL`/`DATABASE_URL` is set (see `backend/src/container.ts`) — required
 * for a serverless deployment, since the in-memory store's plain in-process `Map`s do not
 * survive a request landing on a different, cold instance (this broke refresh tokens and
 * every authenticated endpoint in production before the Postgres store existed). See
 * DEVELOPMENT.md "Deploying to Vercel" for setup.
 *
 * `buildContainer()` eagerly constructs every *optional* integration straight from its own
 * env var — the Postgres pool (`new URL(POSTGRES_URL)`, store/postgresStore.ts), the Play
 * Billing verifier (`JSON.parse(PLAY_BILLING_SERVICE_ACCOUNT_JSON)`,
 * billing/playBillingVerifier.ts) — and `config/env.ts` itself throws if `JWT_SECRET` is
 * unset with `NODE_ENV=production`. Any one of those throwing crashed this entire module,
 * before Express (and therefore `/health`) ever existed — surfacing to every route,
 * including `/health`, as Vercel's opaque FUNCTION_INVOCATION_FAILED, even though `/health`
 * itself needs none of that optional config.
 *
 * A plain top-level `try { buildServer(buildContainer()) }` around static imports does NOT
 * fix this: ES module imports are resolved and evaluated before any code in this file runs,
 * so a throw inside `container.js`/`server.js` (or anything they import, like
 * `config/env.ts`) happens during this module's own load, outside any try/catch it could
 * write. The imports below are therefore deliberately `import()`ed lazily, inside the
 * try/catch, on first request — deferring that evaluation to somewhere it can actually be
 * caught — so one misconfigured integration degrades this function gracefully (a real HTTP
 * 500 with a message pointing at env config) instead of taking every route, `/health`
 * included, down with an opaque crash.
 */
import express, { type Express } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";
import { logger } from "../backend/src/security/redact.js";

let appPromise: Promise<Express> | undefined;

/**
 * Buckets a container-build failure into one of a small set of known, secret-free causes so
 * `/health` can name *which* optional integration is misconfigured without ever echoing the
 * underlying error message to a public, unauthenticated caller. That message is NOT always
 * safe to expose as-is: e.g. `JSON.parse` on a malformed `PLAY_BILLING_SERVICE_ACCOUNT_JSON`
 * can embed a snippet of the raw (secret-bearing) input in its own message (verified locally),
 * and a malformed `POSTGRES_URL` could similarly leak connection-string fragments some Node
 * versions include in `Invalid URL` errors. The full message is still logged server-side via
 * `logger.error` below, for whoever has access to those logs.
 */
function classifyStartupError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/JWT_SECRET/.test(message)) return "jwt_secret_missing_or_invalid";
  if (/PLAY_BILLING_SERVICE_ACCOUNT_JSON|is not valid JSON/.test(message)) return "play_billing_config_invalid";
  if (err instanceof TypeError && /invalid url/i.test(message)) return "postgres_url_invalid";
  // Keep dependency/module failures distinguishable without exposing arbitrary startup
  // exception text or environment-variable values to unauthenticated callers.
  if (/Cannot find package|Cannot find module|ERR_MODULE_NOT_FOUND/i.test(message)) return "module_dependency_missing";
  if (/does not provide an export|has no exported member/i.test(message)) return "module_export_mismatch";
  if (/Unexpected token|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION/i.test(message)) return "module_load_error";
  if (/No AIProvider registered/i.test(message)) return "ai_provider_config_invalid";
  return "unknown_startup_error";
}

function buildFallbackApp(err: unknown): Express {
  const reason = classifyStartupError(err);
  logger.error("Server failed to start; serving a minimal health-only fallback", {
    reason,
    error: err instanceof Error ? err.message : String(err),
  });
  const app = express();
  // Duplicated one-liner (not imported from ai/providerFactory.ts) rather than a shared
  // helper: that module also imports config/env.ts, the very thing that may have just thrown,
  // and Node caches a module's evaluation failure — a second import of it fails the same way.
  const provider = process.env.GEMINI_API_KEY ? "google" : "mock";
  app.get("/health", (_req, res) => res.status(500).json({ status: "error", provider, reason }));
  app.use((_req, res) => res.status(500).json({ error: "Server is misconfigured; check environment variables." }));
  return app;
}

function getApp(): Promise<Express> {
  if (!appPromise) {
    appPromise = (async () => {
      try {
        // `bootstrapEnv` must load `.env` (local/`vercel dev` only — a no-op in real Vercel
        // deployments, see above) before anything below reads `process.env.*`.
        await import("../backend/src/bootstrapEnv.js");
        const { buildContainer } = await import("../backend/src/container.js");
        const { buildServer } = await import("../backend/src/server.js");
        return buildServer(buildContainer());
      } catch (err) {
        return buildFallbackApp(err);
      }
    })();
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  app(req, res);
}
