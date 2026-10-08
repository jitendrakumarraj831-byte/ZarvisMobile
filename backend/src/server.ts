import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type Router } from "express";
import { rateLimit as apiRateLimit } from "express-rate-limit";
import type { Container } from "./container.js";
import { accountRouter } from "./api/routes/account.js";
import { activityRouter, executionsRouter } from "./api/routes/activity.js";
import { agentsRouter } from "./api/routes/agents.js";
import { filesRouter } from "./api/routes/files.js";
import { memoryRouter, notesRouter } from "./api/routes/notes.js";
import { projectsRouter } from "./api/routes/projects.js";
import { authRouter } from "./api/routes/auth.js";
import { billingRouter } from "./api/routes/billing.js";
import { capabilitiesRouter } from "./api/routes/capabilities.js";
import { confirmationsRouter } from "./api/routes/confirmations.js";
import { conversationsRouter } from "./api/routes/conversations.js";
import { integrationsRouter } from "./api/routes/integrations.js";
import { developerRouter } from "./api/routes/developer.js";
import { entitlementsRouter } from "./api/routes/entitlements.js";
import { orchestratorRouter } from "./api/routes/orchestrator.js";
import { skillsRouter } from "./api/routes/skills.js";
import { tasksRouter } from "./api/routes/tasks.js";
import { ttsRouter } from "./api/routes/tts.js";
import { usageRouter } from "./api/routes/usage.js";
import { defaultModelConfig } from "./ai/providerFactory.js";
import { corsMiddleware } from "./security/cors.js";
import { securityHeaders } from "./security/headers.js";
import { logger } from "./security/redact.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** ../../web from dist/server.js (or ../web from src/server.ts) — see MASTER_SPEC.md §12a. */
const webRoot = [join(__dirname, "../../web"), join(__dirname, "../web")].find((candidate) => existsSync(candidate));

/**
 * Document upload is intentionally lazy-loaded. PDF/DOCX parser dependencies must not be part
 * of the server's startup-critical import graph: if one optional document dependency is missing
 * or incompatible in a deployment, /health, auth, and the orchestrator must still start.
 */
let documentsRouterPromise: Promise<Router | null> | undefined;
function getDocumentsRouter(): Promise<Router | null> {
  if (!documentsRouterPromise) {
    documentsRouterPromise = import("./api/routes/documents.js")
      .then(({ documentsRouter }) => documentsRouter())
      .catch((err) => {
        logger.error("Document upload route failed to load", {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
  }
  return documentsRouterPromise;
}

/**
 * The largest body the API documents is a turn: a 70,000-character utterance (a document's
 * extracted text) plus 12 history entries of 1,500 characters. In Devanagari that is ~3 bytes
 * per character (~270 kB), well above express.json()'s 100 kB default. 1 MB fits it in any
 * script and stays far below the platform's own request limit.
 */
const jsonBody = express.json({
  limit: "1mb",
  // Keep the exact bytes: the Razorpay webhook signature is an HMAC over the raw body.
  verify: (req, _res, buf) => {
    (req as unknown as { rawBody?: Buffer }).rawBody = buf;
  },
});

const WEB_ASSET = /^\/(?:index\.html|app\.js|logic\.js|shell\.js|chat-kit\.js|feature-pages\.js|theme-init\.js|i18n\.js|styles\.css|sw\.js|manifest\.webmanifest|icons\/[\w.-]+)$/;

/** `req.path` is still percent-encoded, while express.static decodes it: compare the decoded form. */
function isWebAsset(path: string): boolean {
  try {
    return WEB_ASSET.test(decodeURIComponent(path));
  } catch {
    return false;
  }
}

/** Builds the Express app from a wired [Container] — versioned under /api/v1, see MASTER_SPEC.md §25. */
export function buildServer(container: Container): Express {
  const app = express();
  // Behind exactly one proxy hop (Vercel's edge / a load balancer): use its X-Forwarded-For
  // entry as req.ip for rate limiting, and never trust client-supplied deeper hops.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  // Every requireAuth check validates the server-side session through this service.
  app.locals.authService = container.authService;
  app.use(securityHeaders);
  app.use(corsMiddleware);
  // Tokens, accounts and conversations travel in these responses: no browser, proxy or CDN may keep a copy.
  app.use(["/api/v1", "/health"], (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  // Vercel's Node.js runtime (api/index.ts) can pre-parse a JSON request body onto `req.body`
  // and drain the underlying stream before Express ever sees the request — a well-known
  // Express-on-Vercel gotcha. If that already happened, `express.json()` would try to read
  // an already-empty stream and silently overwrite the real body with `{}`, so every route
  // relying on `req.body` (auth signup/login, orchestrator turn, ...) would see missing
  // fields. Keep whatever Vercel already parsed instead of re-parsing in that case; a normal
  // long-running server (no Vercel wrapper) never populates `req.body` this early, so
  // `express.json()` still runs exactly as before there.
  app.use((req, res, next) => {
    if (req.body && typeof req.body === "object" && Object.keys(req.body as object).length > 0) {
      next();
      return;
    }
    jsonBody(req, res, next);
  });

  // `provider` names which AIProvider is active (e.g. "mock" or "google") — never a secret,
  // it just lets the web client honestly show what's actually answering (Product Principle
  // #4, "Never fake success") instead of assuming Gemini is wired when it isn't.
  // `database` is a fixed, secret-free code (store/store.ts StoreHealth). When the database is
  // configured but unusable, /health says so with a 503 instead of a misleading "ok": the rest
  // of the API cannot create or restore a session in that state.
  // Separate per-IP ceiling for the non-API handlers that touch the database or the file system
  // (/health, the web client fallback), so monitoring never shares the /api/v1 budget.
  const publicLimit = apiRateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false });
  // The client's own files count on a ceiling of their own. One visit fetches about a dozen of them, and the
  // service worker fetches the same set again to precache the shell, so sharing the ceiling above locked out
  // phones behind one carrier or office address (and rapid browser tests) with a "Too many requests" page.
  const assetLimit = apiRateLimit({ windowMs: 60 * 1000, limit: 6000, standardHeaders: "draft-7", legacyHeaders: false });

  app.get("/health", publicLimit, async (_req, res) => {
    const database = (await container.store.healthCheck?.()) ?? "not_configured";
    const healthy = database === "ok" || database === "not_configured";
    res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", provider: defaultModelConfig.provider, database });
  });

  // Coarse per-IP ceiling for every API route, generous enough for shared mobile-carrier IPs.
  // The tighter per-route limits (api/middleware/rateLimit.ts) still apply on top of it.
  app.use(
    "/api/v1",
    apiRateLimit({
      windowMs: 60 * 1000,
      limit: 600,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests. Please wait and try again.", code: "rate_limited" },
    }),
  );

  app.use("/api/v1/auth", authRouter(container.authService, container.googleVerifier));
  app.use("/api/v1/account", accountRouter(container.store));
  app.use("/api/v1/skills", skillsRouter(container.registry, container.entitlementPort));
  app.use("/api/v1/orchestrator", orchestratorRouter(container.orchestrator));
  app.use("/api/v1/entitlements", entitlementsRouter(container.entitlementPort));
  app.use("/api/v1/tasks", tasksRouter(container.taskService, container.store));
  app.use("/api/v1/usage", usageRouter(container.registry, container.usagePort));
  app.use("/api/v1/developer", developerRouter(container.pipeline, container.registry, container.githubAccess));
  app.use(
    "/api/v1/confirmations",
    confirmationsRouter(container.confirmationService, container.pipeline, container.registry, container.store, container.taskRunner),
  );
  app.use("/api/v1/integrations", integrationsRouter(container.githubAccess));
  app.use("/api/v1/capabilities", capabilitiesRouter());
  app.use("/api/v1/conversations", conversationsRouter(container.store, container.workspace));
  app.use("/api/v1/projects", projectsRouter(container.workspace));
  app.use("/api/v1/notes", notesRouter(container.workspace));
  app.use("/api/v1/memory", memoryRouter(container.workspace));
  app.use("/api/v1/files", filesRouter(container.workspace, container.store));
  app.use("/api/v1/activity", activityRouter(container.workspace));
  app.use("/api/v1/executions", executionsRouter(container.store));
  app.use("/api/v1/agents", agentsRouter(container.agentCatalog));
  app.use("/api/v1/billing", billingRouter(container.billingVerifier, container.store, container.paymentService));
  app.use("/api/v1/tts", ttsRouter(container.ttsProvider));
  // Keep document parsing isolated from the startup-critical API. If its dependencies cannot
  // load in a particular deployment, document upload returns 503 instead of taking the entire
  // application down.
  app.use("/api/v1/documents", (req, res, next) => {
    void getDocumentsRouter().then((router) => {
      if (!router) {
        res.status(503).json({ error: "Document upload is temporarily unavailable" });
        return;
      }
      router(req, res, next);
    });
  });

  // Serves the browser web client (see MASTER_SPEC.md §12a "Web Client Architecture") from
  // the same origin/domain as the API — no separate static host needed for
  // https://zarvismobile.com to run the full product in a browser.
  if (webRoot) {
    // Only the files of the shipped client (the same list as vercel.json's routes). The folder also holds
    // browser tests and package metadata that are not part of the product and must not be downloadable.
    const staticFiles = express.static(webRoot);
    app.use(assetLimit, (req, res, next) => (isWebAsset(req.path) ? staticFiles(req, res, next) : next()));
    app.get(/^(?!\/api\/).*/, publicLimit, (_req, res) => res.sendFile(join(webRoot, "index.html")));
  }

  app.use((req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // A body the parser rejected is the client's error: say which, never "internal_error".
    const parserError = bodyParserError(err);
    if (parserError) {
      res.status(parserError.status).json(parserError.body);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Unhandled request error", { error: message });

    // Return only a safe category to the client. Never expose connection strings, JWTs,
    // provider credentials, SQL, or upstream response bodies. This makes production
    // failures actionable while keeping the real error only in Vercel logs.
    let code = "internal_error";
    let status = 500;
    if (/Gemini (generateContent|streamGenerateContent) failed/i.test(message)) {
      code = "ai_service_unavailable";
      if (/(?:^|\D)(408|429|500|502|503|504)(?:\D|$)|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(message)) {
        status = 503;
      }
    } else if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|self-signed certificate|certificate/i.test(message)) {
      code = "database_connection_error";
    } else if (/password authentication failed|SASL|authentication failed|database .* does not exist|no pg_hba/i.test(message)) {
      code = "database_configuration_error";
    }

    res.status(status).json({
      error: status === 503 ? "AI service temporarily unavailable" : "Internal error",
      code,
      ...(status === 503 ? { retryable: true } : {}),
    });
  });

  return app;
}

/** Maps express.json()'s own 4xx errors (malformed JSON, body too large, ...) to a stable code. */
function bodyParserError(err: unknown): { status: number; body: { error: string; code: string } } | undefined {
  if (!err || typeof err !== "object") return undefined;
  const { type, status, statusCode, message } = err as { type?: unknown; status?: unknown; statusCode?: unknown; message?: unknown };
  // Vercel's Node runtime parses the body itself (api/index.ts); its lazy `req.body` getter
  // throws an ApiError with `statusCode: 400` and "Invalid JSON" before express.json() runs.
  const vercelInvalidJson = statusCode === 400 && typeof message === "string" && /invalid json/i.test(message);
  if (type === "entity.parse.failed" || vercelInvalidJson) return { status: 400, body: { error: "The request body is not valid JSON.", code: "invalid_json" } };
  if (type === "entity.too.large") return { status: 413, body: { error: "The request body is too large.", code: "payload_too_large" } };
  if (typeof type === "string" && typeof status === "number" && status >= 400 && status < 500) {
    return { status, body: { error: "The request body could not be read.", code: "invalid_request" } };
  }
  return undefined;
}
