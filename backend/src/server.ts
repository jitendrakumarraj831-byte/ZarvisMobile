import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type Router } from "express";
import type { Container } from "./container.js";
import { accountRouter } from "./api/routes/account.js";
import { authRouter } from "./api/routes/auth.js";
import { billingRouter } from "./api/routes/billing.js";
import { developerRouter } from "./api/routes/developer.js";
import { entitlementsRouter } from "./api/routes/entitlements.js";
import { orchestratorRouter } from "./api/routes/orchestrator.js";
import { skillsRouter } from "./api/routes/skills.js";
import { tasksRouter } from "./api/routes/tasks.js";
import { ttsRouter } from "./api/routes/tts.js";
import { usageRouter } from "./api/routes/usage.js";
import { defaultModelConfig } from "./ai/providerFactory.js";
import { corsMiddleware } from "./security/cors.js";
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

/** Builds the Express app from a wired [Container] — versioned under /api/v1, see MASTER_SPEC.md §25. */
export function buildServer(container: Container): Express {
  const app = express();
  app.use(corsMiddleware);
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
    express.json()(req, res, next);
  });

  // `provider` names which AIProvider is active (e.g. "mock" or "google") — never a secret,
  // it just lets the web client honestly show what's actually answering (Product Principle
  // #4, "Never fake success") instead of assuming Gemini is wired when it isn't.
  app.get("/health", (_req, res) => res.json({ status: "ok", provider: defaultModelConfig.provider }));

  app.use("/api/v1/auth", authRouter(container.authService));
  app.use("/api/v1/account", accountRouter(container.store));
  app.use("/api/v1/skills", skillsRouter(container.registry, container.entitlementPort));
  app.use("/api/v1/orchestrator", orchestratorRouter(container.orchestrator));
  app.use("/api/v1/entitlements", entitlementsRouter(container.entitlementPort));
  app.use("/api/v1/tasks", tasksRouter(container.taskService));
  app.use("/api/v1/usage", usageRouter(container.registry, container.usagePort));
  app.use("/api/v1/developer", developerRouter(container.pipeline));
  app.use("/api/v1/billing", billingRouter(container.billingVerifier, container.store));
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
    app.use(express.static(webRoot));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(webRoot, "index.html")));
  }

  app.use((req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error("Unhandled request error", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Internal error" });
  });

  return app;
}
