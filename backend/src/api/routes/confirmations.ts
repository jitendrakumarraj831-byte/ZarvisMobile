import { randomUUID } from "node:crypto";
import { Router } from "express";
import { explainOutcome } from "../../agents/orchestrator.js";
import type { ServerConfirmationService } from "../../security/confirmationService.js";
import { toView } from "../../security/confirmationService.js";
import type { Store } from "../../store/store.js";
import type { SkillRegistry } from "../../tooling/skillRegistry.js";
import type { ToolPipeline } from "../../tooling/toolPipeline.js";
import { toStructuredResult } from "../../tooling/toolResult.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";

/**
 * GET  /api/v1/confirmations/:id          — what a pending confirmation will do.
 * POST /api/v1/confirmations/:id/approve  — consumes it (single use) and runs exactly that call.
 * POST /api/v1/confirmations/:id/decline  — consumes it without running anything.
 *
 * Only the owning account can see or resolve a confirmation. An expired, already-resolved or
 * unknown id returns 404 `confirmation_unavailable` and nothing runs.
 */
export function confirmationsRouter(
  confirmations: ServerConfirmationService,
  pipeline: ToolPipeline,
  registry: SkillRegistry,
  store: Store,
): Router {
  const router = Router();
  const limit = rateLimit({ name: "confirmations", windowMs: 60 * 1000, max: 30, keyBy: "account" });

  router.get(
    "/:id",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const record = await confirmations.get(req.auth!.accountId, req.params.id!);
      if (!record) {
        res.status(404).json({ error: "Confirmation not found", code: "confirmation_unavailable" });
        return;
      }
      res.json({ ...toView(record, registry.find(record.skillId)?.name ?? record.skillId), status: record.status });
    }),
  );

  router.post(
    "/:id/approve",
    requireAuth,
    limit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const accountId = req.auth!.accountId;
      const approved = await confirmations.approve(accountId, req.params.id!);
      if (!approved) {
        res.status(404).json({
          error: "This confirmation has expired, was already used, or does not exist. Nothing was run.",
          code: "confirmation_unavailable",
        });
        return;
      }
      const { record, grant } = approved;
      const outcome = await pipeline.execute(
        { id: randomUUID(), skillId: record.skillId, input: { values: record.input } },
        { accountId, conversationId: record.conversationId, confirmationGrant: grant },
      );
      const message = explainOutcome(outcome);
      if (record.conversationId) await appendAssistant(store, accountId, record.conversationId, message);
      res.json({
        confirmationId: record.id,
        outcome,
        result: toStructuredResult(record.skillId, registry.find(record.skillId), outcome, message),
        message,
      });
    }),
  );

  router.post(
    "/:id/decline",
    requireAuth,
    limit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const accountId = req.auth!.accountId;
      const record = await confirmations.decline(accountId, req.params.id!);
      if (!record) {
        res.status(404).json({ error: "Confirmation not found or already resolved", code: "confirmation_unavailable" });
        return;
      }
      const outcome = { kind: "confirmation_declined" as const, skillId: record.skillId };
      const message = explainOutcome(outcome);
      if (record.conversationId) await appendAssistant(store, accountId, record.conversationId, message);
      res.json({
        confirmationId: record.id,
        outcome,
        result: toStructuredResult(record.skillId, registry.find(record.skillId), outcome, message),
        message,
      });
    }),
  );

  return router;
}

async function appendAssistant(store: Store, accountId: string, conversationId: string, content: string): Promise<void> {
  const conversation = await store.getConversation(accountId, conversationId);
  if (!conversation) return;
  await store.appendConversationMessages([
    { id: randomUUID(), conversationId, role: "assistant", content: content.slice(0, 12000), createdAt: new Date() },
  ]);
}
