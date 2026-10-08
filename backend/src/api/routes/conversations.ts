import { Router } from "express";
import type { Store } from "../../store/store.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

const LIST_DEFAULT = 30;
const LIST_MAX = 100;

/**
 * GET /api/v1/conversations — the caller's own conversations, newest first (id, title, times), so a browser
 * or phone signed in to the same account can list chats started elsewhere. Only metadata: the messages of
 * one conversation come from the route below, which checks ownership again.
 *
 * GET /api/v1/conversations/:id/messages — the stored messages of one of the caller's
 * conversations, so a client restored after process death (or another device signed into the
 * same account) shows only real persisted history. Tool-result rows are not exposed.
 */
export function conversationsRouter(store: Store): Router {
  const router = Router();

  router.get(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const asked = Number.parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, LIST_MAX) : LIST_DEFAULT;
      const conversations = await store.listConversations(req.auth!.accountId, limit);
      res.json({
        conversations: conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title ?? null,
          createdAt: conversation.createdAt.toISOString(),
          updatedAt: conversation.updatedAt.toISOString(),
        })),
      });
    }),
  );

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
