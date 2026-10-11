import { Router } from "express";
import type { Store } from "../../store/store.js";
import type { WorkspaceService } from "../../workspace/workspaceService.js";
import { executionView } from "../../workspace/views.js";
import { sendWorkspaceError } from "./workspaceErrors.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";

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
 *
 * DELETE /api/v1/conversations/:id — deletes one of the caller's chats for good: its messages, the stored results of its turns and the
 * tool runs made in it (runs that belong to a task keep the task's history but lose the link to the chat). 204 when deleted;
 * 404 `conversation_not_found` for a chat that does not exist or is another account's, so a client can treat 404 as "already gone".
 */
export function conversationsRouter(store: Store, workspace: WorkspaceService): Router {
  const router = Router();
  const writeLimit = rateLimit({ name: "conversations-write", windowMs: 60 * 1000, max: 90, keyBy: "account" });

  router.get(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const asked = Number.parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, LIST_MAX) : LIST_DEFAULT;
      const projectId = typeof req.query.projectId === "string" && req.query.projectId ? req.query.projectId : undefined;
      const conversations = await store.listConversations(req.auth!.accountId, limit, projectId ? { projectId } : {});
      res.json({
        conversations: conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title ?? null,
          projectId: conversation.projectId ?? null,
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
        projectId: conversation.projectId ?? null,
        messages: messages
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => ({ id: message.id, role: message.role, content: message.content, createdAt: message.createdAt.toISOString() })),
      });
    }),
  );

  // The tool runs of one chat, oldest first, so a reloaded chat can show what ZARVIS did between the messages.
  router.get(
    "/:id/executions",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const accountId = req.auth!.accountId;
      const conversation = await store.getConversation(accountId, req.params.id!);
      if (!conversation) {
        res.status(404).json({ error: "Conversation not found", code: "conversation_not_found" });
        return;
      }
      const executions = await store.listExecutions(accountId, { conversationId: conversation.id, limit: 100 });
      res.json({ executions: executions.reverse().map(executionView) });
    }),
  );

  // Moves a chat into a project (or out of every project with { projectId: null }).
  router.post(
    "/:id/project",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        res.json(await workspace.moveConversation(req.auth!.accountId, req.params.id!, (req.body ?? {}).projectId ?? null));
      } catch (err) {
        if (!sendWorkspaceError(err, res)) throw err;
      }
    }),
  );

  router.delete(
    "/:id",
    requireAuth,
    writeLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        await workspace.deleteConversation(req.auth!.accountId, req.params.id!);
        res.status(204).end();
      } catch (err) {
        if (!sendWorkspaceError(err, res)) throw err;
      }
    }),
  );

  return router;
}
