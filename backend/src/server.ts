import express, { type Express } from "express";
import type { Container } from "./container.js";
import { authRouter } from "./api/routes/auth.js";
import { billingRouter } from "./api/routes/billing.js";
import { developerRouter } from "./api/routes/developer.js";
import { entitlementsRouter } from "./api/routes/entitlements.js";
import { orchestratorRouter } from "./api/routes/orchestrator.js";
import { skillsRouter } from "./api/routes/skills.js";
import { tasksRouter } from "./api/routes/tasks.js";
import { usageRouter } from "./api/routes/usage.js";
import { logger } from "./security/redact.js";

/** Builds the Express app from a wired [Container] — versioned under /api/v1, see MASTER_SPEC.md §25. */
export function buildServer(container: Container): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/v1/auth", authRouter(container.authService));
  app.use("/api/v1/skills", skillsRouter(container.registry, container.entitlementPort));
  app.use("/api/v1/orchestrator", orchestratorRouter(container.orchestrator));
  app.use("/api/v1/entitlements", entitlementsRouter(container.entitlementPort));
  app.use("/api/v1/tasks", tasksRouter(container.taskService));
  app.use("/api/v1/usage", usageRouter(container.registry, container.usagePort));
  app.use("/api/v1/developer", developerRouter(container.pipeline));
  app.use("/api/v1/billing", billingRouter(container.billingVerifier));

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
