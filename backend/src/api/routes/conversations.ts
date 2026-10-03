import { Router } from "express";
import type { Store } from "../../store/store.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

/**
 * GET /api/v1/conversations/:id/messages — the stored messages of one of the caller's
 * conversations, so a client restored after process death (or another device signed into the
 * same account) shows only real persisted history. Tool-result rows are not exposed.
 */
export function conversationsRouter(store: Store): Router {
  const router = Router();

  router.get(
    "/:id/messages",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const accountId = req.auth!.accountId;
      const conversation = await store.getConversation(accountId, req.params.id!);
      if (!conversation) {
        res.status(404).json({ error: "Conversation not found", code: "conversation_not_found" });
        return;
      }
      const messages = await store.listConversationMessages(accountId, conversation.id, 100);
      res.json({
        conversationId: conversation.id,
        title: conversation.title ?? null,
        messages: messages
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => ({ id: message.id, role: message.role, content: message.content, createdAt: message.createdAt.toISOString() })),
      });
    }),
  );

  return router;
}
