import { Router } from "express";
import type { AgentCatalog } from "../../agents/agentCatalog.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

/**
 * GET /api/v1/agents      — the user-facing agents with how many of their skills this account can use.
 * GET /api/v1/agents/:id  — one agent: its skills (from the SkillRegistry), what each asks first, the integrations and
 *                           permissions it needs, its limitations, this account's recent results and projects.
 * To use an agent, send a turn to POST /orchestrator/turn(-stream) with `agentId`.
 */
export function agentsRouter(catalog: AgentCatalog): Router {
  const router = Router();
  router.get(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      res.json({ agents: await catalog.list(req.auth!.accountId) });
    }),
  );
  router.get(
    "/:id",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const agent = await catalog.detail(req.auth!.accountId, req.params.id!);
      if (!agent) {
        res.status(404).json({ error: "Agent not found", code: "agent_not_found" });
        return;
      }
      res.json(agent);
    }),
  );
  return router;
}
