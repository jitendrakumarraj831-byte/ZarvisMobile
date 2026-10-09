import { Router } from "express";
import type { SkillRegistry } from "../../tooling/skillRegistry.js";
import type { UsagePort } from "../../tooling/ports.js";
import type { Store } from "../../store/store.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

/**
 * POST /api/v1/usage/charge — lets an on-device skill execution (which ran through the
 * Android domain module's own ToolPipeline, see ARCHITECTURE.md "Backend/Android parity
 * note") report a completed, verified, billable action so the server-authoritative credit
 * ledger stays accurate. The cost is looked up from the server's own skill registry by
 * `skillId` — never taken from the client — so a modified client cannot under-report cost.
 * No currently-shipped on-device skill has a non-zero usage cost (see SKILLS.md), so this
 * route exists ahead of need rather than being left unimplemented once one does.
 */
export function usageRouter(registry: SkillRegistry, usagePort: UsagePort, store?: Store): Router {
  const router = Router();

  /**
   * GET /api/v1/usage/summary — what this account's credits were really spent on, from the usage ledger:
   * the balance, the total and last-30-days spend, spend per skill, and the latest charges.
   */
  router.get(
    "/summary",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      if (!store) {
        res.status(503).json({ error: "Usage isn't available.", code: "usage_unavailable" });
        return;
      }
      const accountId = req.auth!.accountId;
      const [entries, balance] = await Promise.all([store.listUsage(accountId), store.getCreditBalance(accountId)]);
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const bySkill = new Map<string, { skillId: string; name: string; runs: number; credits: number }>();
      let spentTotal = 0;
      let spentLast30Days = 0;
      for (const entry of entries) {
        spentTotal += entry.cost;
        if (entry.createdAt.getTime() >= since) spentLast30Days += entry.cost;
        const row = bySkill.get(entry.skillId) ?? { skillId: entry.skillId, name: registry.find(entry.skillId)?.name ?? entry.skillId, runs: 0, credits: 0 };
        row.runs += 1;
        row.credits += entry.cost;
        bySkill.set(entry.skillId, row);
      }
      res.json({
        balance,
        spentTotal,
        spentLast30Days,
        runs: entries.length,
        bySkill: [...bySkill.values()].sort((a, b) => b.credits - a.credits).slice(0, 20),
        recent: [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 10).map((e) => ({
          skillId: e.skillId, name: registry.find(e.skillId)?.name ?? e.skillId, cost: e.cost, at: e.createdAt.toISOString(),
        })),
      });
    }),
  );

  router.post(
    "/charge",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { skillId } = req.body ?? {};
      if (typeof skillId !== "string") {
        res.status(400).json({ error: "skillId is required" });
        return;
      }
      const skill = registry.find(skillId);
      if (!skill) {
        res.status(404).json({ error: `Unknown skill '${skillId}'` });
        return;
      }
      if (!skill.executesOnDevice) {
        res.status(400).json({ error: `'${skillId}' is backend-executed and is charged automatically, not via this route` });
        return;
      }
      const balance = await usagePort.charge(req.auth!.accountId, skill.usageCost, skillId);
      res.json({ balance });
    }),
  );

  return router;
}
