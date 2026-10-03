import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { AIProviderError, providerErrorLogFields, providerErrorPayload } from "../../ai/geminiErrors.js";
import { ClientTurnIdReusedError, TurnInProgressError, type Orchestrator, type TurnEvent, type TurnRequest } from "../../agents/orchestrator.js";
import { correlationOf, runWithCorrelation } from "../../observability/requestContext.js";
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
 * Both accept an optional `clientTurnId` (8–100 of [A-Za-z0-9_-]): the client's idempotency key
 * for one logical user turn, reused when it re-sends that turn. A completed turn is answered
 * from its stored result (`replayed: true`, nothing executed); a turn still running elsewhere
 * gets `turn_in_progress` (409 / SSE error); a failed one runs again.
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
      if ("error" in request) {
        res.status(400).json(request.error);
        return;
      }
      const turnId = randomUUID();
      const cancel = abortOnClientGone(res);

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
        const result = await runWithCorrelation(correlationOf(req), () =>
          orchestrator.runTurn({ ...request, turnId, signal: cancel.signal }, (event: TurnEvent) => {
            if (event.type === "conversation") send("meta", { conversationId: event.conversationId, turnId });
            else send("progress", event);
          }),
        );
        send("delta", { text: result.message });
        send("done", {
          message: result.message,
          toolCalls: result.toolCalls,
          conversationId: result.conversationId,
          turnId: result.turnId,
          ...(result.replayed ? { replayed: true } : {}),
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // The client went away (Stop, a newer turn, a closed tab): nobody is listening.
        } else if (err instanceof TurnInProgressError) {
          send("error", { error: err.message, code: err.code, retryable: true, turnId });
        } else if (err instanceof ClientTurnIdReusedError) {
          send("error", { error: err.message, code: err.code, retryable: false, turnId });
        } else if (err instanceof AIProviderError) {
          logger.warn("Streaming turn stopped by the AI provider", { turnId, ...providerErrorLogFields(err) });
          send("error", { ...providerErrorPayload(err), turnId });
        } else {
          logger.error("Streaming turn failed", { turnId, error: err instanceof Error ? err.message : String(err) });
          send("error", { error: "The request could not be completed.", retryable: true, turnId });
        }
      } finally {
        cancel.dispose();
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
      if ("error" in request) {
        res.status(400).json(request.error);
        return;
      }
      const cancel = abortOnClientGone(res);
      const turnId = randomUUID();
      try {
        res.json(await runWithCorrelation(correlationOf(req), () => orchestrator.runTurn({ ...request, turnId, signal: cancel.signal })));
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (err instanceof TurnInProgressError) {
          res.status(409).json({ error: err.message, code: err.code, retryable: true });
          return;
        }
        if (err instanceof ClientTurnIdReusedError) {
          res.status(409).json({ error: err.message, code: err.code, retryable: false });
          return;
        }
        if (err instanceof AIProviderError) {
          logger.warn("Turn stopped by the AI provider", { turnId, ...providerErrorLogFields(err) });
          res.status(err.code === "AI_UNAVAILABLE" ? 503 : 429).json(providerErrorPayload(err));
          return;
        }
        throw err;
      } finally {
        cancel.dispose();
      }
    }),
  );

  return router;
}

/**
 * Aborts the turn when the client disconnects before the response finished, so a cancelled
 * or superseded turn stops before its next model or tool call instead of running (and
 * spending AI quota) for nobody.
 */
function abortOnClientGone(res: Response): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.on("close", onClose);
  return { signal: controller.signal, dispose: () => res.off("close", onClose) };
}

const CLIENT_TURN_ID = /^[A-Za-z0-9_-]{8,100}$/;

function parseTurnRequest(req: AuthenticatedRequest): TurnRequest | { error: { error: string; code: string } } {
  const { utterance, locale, userName, isFirstTurn, history, conversationId, clientTurnId } = req.body ?? {};
  if (typeof utterance !== "string" || utterance.trim().length === 0) {
    return { error: { error: "utterance is required", code: "invalid_request" } };
  }
  // A malformed key is refused rather than ignored: ignoring it would silently drop the
  // duplicate-execution protection the client asked for.
  if (clientTurnId !== undefined && clientTurnId !== null && (typeof clientTurnId !== "string" || !CLIENT_TURN_ID.test(clientTurnId))) {
    return { error: { error: "clientTurnId must be 8-100 characters of A-Z, a-z, 0-9, _ or -", code: "invalid_client_turn_id" } };
  }
  return {
    clientTurnId: typeof clientTurnId === "string" ? clientTurnId : undefined,
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
