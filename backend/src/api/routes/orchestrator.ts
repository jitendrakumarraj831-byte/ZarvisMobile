import { Router } from "express";
import type { Orchestrator } from "../../agents/orchestrator.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

/**
 * POST /api/v1/orchestrator/turn — one conversation turn. See AI_ARCHITECTURE.md and
 * MASTER_SPEC.md §25. Not streamed in this pass (the provider supports `streamGenerate`,
 * but the HTTP route uses the simpler non-streaming `generate` — see AI_ARCHITECTURE.md).
 */
export function orchestratorRouter(orchestrator: Orchestrator): Router {
  const router = Router();

  router.post(
    "/turn-stream",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { utterance, confirmed, locale, userName, isFirstTurn, history, conversationId } = req.body ?? {};
      if (typeof utterance !== "string" || !utterance.trim()) {
        res.status(400).json({ error: "utterance is required" });
        return;
      }

      const result = await orchestrator.runTurn({
        accountId: req.auth!.accountId,
        utterance,
        confirmed: typeof confirmed === "boolean" ? confirmed : undefined,
        locale: typeof locale === "string" ? locale : undefined,
        userName: typeof userName === "string" && userName.trim() ? userName.trim().slice(0, 60) : undefined,
        isFirstTurn: isFirstTurn === true,
        history: sanitizeHistory(history),
        conversationId: typeof conversationId === "string" && conversationId.trim()
          ? conversationId.trim().slice(0, 100)
          : undefined,
      });

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      const send = (event: string, data: unknown) => {
        res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
      };
      send("meta", { conversationId: result.conversationId });
      const chunks = chunkForRealtimeDisplay(result.message);
      for (const chunk of chunks) {
        if (res.destroyed) return;
        send("delta", { text: chunk });
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
      send("done", { message: result.message, toolCalls: result.toolCalls });
      res.end();
    }),
  );

  router.post(
    "/turn",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { utterance, confirmed, locale, userName, isFirstTurn, history, conversationId } = req.body ?? {};
      if (typeof utterance !== "string" || utterance.trim().length === 0) {
        res.status(400).json({ error: "utterance is required" });
        return;
      }
      const result = await orchestrator.runTurn({
        accountId: req.auth!.accountId,
        utterance,
        confirmed: typeof confirmed === "boolean" ? confirmed : undefined,
        locale: typeof locale === "string" ? locale : undefined,
        // Client-supplied, not a trust boundary — see orchestrator.ts's TurnRequest.userName
        // doc comment. Capped short so it can't be used to smuggle a large prompt injection
        // into the system prompt under the guise of a "name".
        userName: typeof userName === "string" && userName.trim() ? userName.trim().slice(0, 60) : undefined,
        isFirstTurn: isFirstTurn === true,
        history: sanitizeHistory(history),
        conversationId: typeof conversationId === "string" && conversationId.trim()
          ? conversationId.trim().slice(0, 100)
          : undefined,
      });
      res.json(result);
    }),
  );

  return router;
}

function sanitizeHistory(value: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { role: string; content: string } =>
      !!item && typeof item === "object" &&
      typeof (item as any).role === "string" &&
      typeof (item as any).content === "string",
    )
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      role: item.role as "user" | "assistant",
      content: item.content.trim().slice(0, 1500),
    }))
    .filter((item) => item.content.length > 0)
    .slice(-12);
}

function chunkForRealtimeDisplay(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?。！？\n]+[.!?。！？\n]+|[^.!?。！？\n]+$/g) ?? [normalized];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const words = sentence.split(/(\s+)/);
    let current = "";
    for (const word of words) {
      if ((current + word).length > 90 && current.trim()) {
        chunks.push(current);
        current = "";
      }
      current += word;
    }
    if (current) chunks.push(current);
  }
  return chunks.filter(Boolean);
}
