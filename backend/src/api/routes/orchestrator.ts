import { Router } from "express";
import type { Orchestrator, TurnEvent, TurnRequest } from "../../agents/orchestrator.js";
import { logger } from "../../security/redact.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";

/**
 * POST /api/v1/orchestrator/turn — one conversation turn (JSON).
 * POST /api/v1/orchestrator/turn-stream — the same turn as Server-Sent Events. Events are
 * emitted only when the backend actually reaches that stage (conversation resolved, model
 * step started, tool started/finished); the reply text is sent once when it exists. There is
 * no simulated token-by-token drip.
 *
 * Neither route accepts a client "confirmed" flag: higher-risk actions come back as
 * `confirmation_required` with a server-issued confirmation id — see routes/confirmations.ts.
 */
export function orchestratorRouter(orchestrator: Orchestrator): Router {
  const router = Router();
  const turnLimit = rateLimit({ name: "orchestrator", windowMs: 60 * 1000, max: 30, keyBy: "account" });

  router.post(
    "/turn-stream",
    requireAuth,
    turnLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const request = parseTurnRequest(req);
      if (!request) {
        res.status(400).json({ error: "utterance is required", code: "invalid_request" });
        return;
      }

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      const send = (event: string, data: unknown) => {
        if (!res.destroyed) res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
      };
      try {
        const result = await orchestrator.runTurn(request, (event: TurnEvent) => {
          if (event.type === "conversation") send("meta", { conversationId: event.conversationId });
          else send("progress", event);
        });
        send("delta", { text: result.message });
        send("done", { message: result.message, toolCalls: result.toolCalls, conversationId: result.conversationId });
      } catch (err) {
        logger.error("Streaming turn failed", { error: err instanceof Error ? err.message : String(err) });
        send("error", { error: "The request could not be completed.", retryable: true });
      } finally {
        res.end();
      }
    }),
  );

  router.post(
    "/turn",
    requireAuth,
    turnLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const request = parseTurnRequest(req);
      if (!request) {
        res.status(400).json({ error: "utterance is required", code: "invalid_request" });
        return;
      }
      res.json(await orchestrator.runTurn(request));
    }),
  );

  return router;
}

function parseTurnRequest(req: AuthenticatedRequest): TurnRequest | undefined {
  const { utterance, locale, userName, isFirstTurn, history, conversationId } = req.body ?? {};
  if (typeof utterance !== "string" || utterance.trim().length === 0) return undefined;
  return {
    accountId: req.auth!.accountId,
    utterance: utterance.slice(0, 70_000),
    locale: typeof locale === "string" ? locale.slice(0, 16) : undefined,
    // Client-supplied display label, never an identity claim; capped so it can't carry a large prompt.
    userName: typeof userName === "string" && userName.trim() ? userName.trim().slice(0, 60) : undefined,
    isFirstTurn: isFirstTurn === true,
    history: sanitizeHistory(history),
    conversationId: typeof conversationId === "string" && conversationId.trim() ? conversationId.trim().slice(0, 100) : undefined,
  };
}

function sanitizeHistory(value: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { role: string; content: string } =>
      !!item && typeof item === "object" &&
      typeof (item as { role?: unknown }).role === "string" &&
      typeof (item as { content?: unknown }).content === "string",
    )
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({ role: item.role as "user" | "assistant", content: item.content.trim().slice(0, 1500) }))
    .filter((item) => item.content.length > 0)
    .slice(-12);
}
