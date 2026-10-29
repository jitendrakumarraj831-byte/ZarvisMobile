import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { AIProviderError, providerErrorLogFields, providerErrorPayload } from "../../ai/geminiErrors.js";
import { ClientTurnIdReusedError, TurnInProgressError, type Orchestrator, type TurnEvent, type TurnRequest } from "../../agents/orchestrator.js";
import { correlationOf, runWithCorrelation } from "../../observability/requestContext.js";
import { logger } from "../../security/redact.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { findAgent } from "../../agents/agentProfiles.js";
import { continuationNote, DEVICE_RESULT_STATUSES, isDeviceActionId, MAX_PHONE_STEPS } from "../../capabilities/deviceActions.js";

/**
 * POST /api/v1/orchestrator/turn — one conversation turn (JSON).
 * POST /api/v1/orchestrator/turn-stream — the same turn as Server-Sent Events. Events are
 * emitted only when the backend actually reaches that stage (conversation resolved, model
 * step started, tool started/finished); the reply text is sent once when it exists. There is
 * no simulated token-by-token drip.
 *
 * Both accept an optional `projectId` (the project a NEW chat starts in) and `agentId` (run the turn with one
 * agent's skills only), and an optional `clientTurnId` (8–100 of [A-Za-z0-9_-]): the client's idempotency key
 * for one logical user turn, reused when it re-sends that turn. A completed turn is answered
 * from its stored result (`replayed: true`, nothing executed); a turn still running elsewhere
 * gets `turn_in_progress` (409 / SSE error); a failed one runs again.
 *
 * Neither route accepts a client "confirmed" flag: higher-risk actions come back as
 * `confirmation_required` with a server-issued confirmation id — see routes/confirmations.ts.
 *
 * A reply a live model wrote carries `ai: { provider, fallback }` (the JSON body and the stream's `done` event),
 * so the client can say which provider answered. It names no model, key or reason.
 *
 * An optional `replyLength` (`short`, `balanced` or `detailed`) is the user's answer-length preference; the planner is
 * told it. Any other value is ignored.
 *
 * An optional `inputMode: "voice"` says the user spoke the message (the client's speech recognition): the planner writes a
 * reply to be heard, and reads the transcript allowing for misheard words. Any other value is ignored.
 *
 * An optional `deviceActions` (ids from capabilities/deviceActions.ts) lists the phone actions the client runs itself.
 * The planner may then answer with `deviceAction: { toolCallId, skillId, input }` instead of prose: nothing ran on the
 * server, the client runs it (its own permission and confirmation flow) and reports the outcome to
 * POST /api/v1/orchestrator/device-result, which records it as the reply in the conversation.
 *
 * A multi-step phone request ("open WhatsApp and then Rahul's chat") comes back one step at a time: the deviceAction carries
 * `then`, the rest of the request. After that step succeeds the client reports it with `continueWith` (that text), `step` (how
 * many steps have run) and its `deviceActions`, and the response carries `next`, the following turn (another deviceAction, or
 * the final reply). At most MAX_PHONE_STEPS steps; a step the user declined or that failed is never continued.
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
            if (event.type === "conversation") send("meta", { conversationId: event.conversationId, turnId, ...(event.projectId ? { projectId: event.projectId } : {}), ...(event.agentId ? { agentId: event.agentId } : {}) });
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
          // Which provider wrote the reply (and whether as a fallback), for the client's label. See TurnResult.ai.
          ...(result.ai ? { ai: result.ai } : {}),
          ...(result.deviceAction ? { deviceAction: result.deviceAction } : {}),
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

  /**
   * The result of a phone action the client ran for a `deviceAction` turn, recorded as the assistant's reply so the
   * conversation (and the next turn's context) says what really happened on the phone. Only into the caller's own
   * conversation, only for the phone action the planner handed over in it (its toolCallId and skillId), only once
   * (a repeat is 409 `device_result_already_recorded`, anything never handed over is 404 `unknown_device_action`),
   * and only the client's plain-language result text.
   */
  const deviceResultLimit = rateLimit({ name: "device-result", windowMs: 60 * 1000, max: 60, keyBy: "account" });
  router.post(
    "/device-result",
    requireAuth,
    deviceResultLimit,
    // Continuing plans another step with the model, so it counts against the same budget as a turn.
    (req, res, next) => (req.body?.continueWith ? turnLimit(req, res, next) : next()),
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { conversationId, toolCallId, skillId, status, message, continueWith, step, deviceActions, locale } = req.body ?? {};
      if (
        typeof conversationId !== "string" || !conversationId.trim() || conversationId.length > 100 ||
        typeof toolCallId !== "string" || !toolCallId.trim() || toolCallId.length > 100 ||
        !isDeviceActionId(skillId) ||
        typeof status !== "string" || !DEVICE_RESULT_STATUSES.has(status) ||
        typeof message !== "string" || !message.trim()
      ) {
        res.status(400).json({ error: "conversationId, toolCallId, a known skillId, a result status and a message are required", code: "invalid_request" });
        return;
      }
      const recorded = await orchestrator.recordDeviceResult(req.auth!.accountId, {
        conversationId: conversationId.trim(),
        toolCallId: toolCallId.trim(),
        skillId,
        message: message.trim().slice(0, 2000),
      });
      if (recorded === "conversation_not_found") {
        res.status(404).json({ error: "Conversation not found.", code: "conversation_not_found" });
        return;
      }
      // A report is accepted only for a phone action handed over in this conversation, and only once: nothing is recorded or planned.
      if (recorded === "unknown_handoff") {
        res.status(404).json({ error: "No such phone action was handed to this conversation.", code: "unknown_device_action" });
        return;
      }
      if (recorded === "already_reported") {
        res.status(409).json({ error: "This phone action's result was already recorded.", code: "device_result_already_recorded" });
        return;
      }
      logger.info("Phone action result recorded", { toolCallId: toolCallId.slice(0, 100), skillId, status });
      const then = typeof continueWith === "string" ? continueWith.trim().slice(0, 300) : "";
      if (!then) {
        res.json({ recorded: true });
        return;
      }
      // Only after a step that did what it should; a declined, refused or failed step ends the request where it is.
      if (status !== "COMPLETED" && status !== "USER_ACTION_REQUIRED") {
        res.json({ recorded: true, stopped: "The last step did not finish, so the rest was not done." });
        return;
      }
      const stepsDone = Number.isInteger(step) && step >= 1 ? step : 1;
      if (stepsDone >= MAX_PHONE_STEPS) {
        res.json({ recorded: true, stopped: `I stopped after ${MAX_PHONE_STEPS} phone steps. Ask again for what is left.` });
        return;
      }
      try {
        const next = await runWithCorrelation(correlationOf(req), () =>
          orchestrator.runTurn({
            accountId: req.auth!.accountId,
            conversationId: conversationId.trim(),
            utterance: continuationNote(stepsDone, status, then),
            locale: typeof locale === "string" ? locale.slice(0, 16) : undefined,
            deviceActions: Array.isArray(deviceActions) ? [...new Set(deviceActions.filter(isDeviceActionId))] : undefined,
            continuation: true,
          }),
        );
        res.json({ recorded: true, next });
      } catch (err) {
        if (err instanceof AIProviderError) {
          logger.warn("Phone request stopped by the AI provider", { ...providerErrorLogFields(err) });
          res.json({ recorded: true, stopped: providerErrorPayload(err).error });
          return;
        }
        throw err;
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
  const { utterance, locale, userName, isFirstTurn, history, conversationId, clientTurnId, projectId, agentId, replyLength, inputMode, deviceActions } = req.body ?? {};
  if (typeof utterance !== "string" || utterance.trim().length === 0) {
    return { error: { error: "utterance is required", code: "invalid_request" } };
  }
  // A malformed key is refused rather than ignored: ignoring it would silently drop the
  // duplicate-execution protection the client asked for.
  if (clientTurnId !== undefined && clientTurnId !== null && (typeof clientTurnId !== "string" || !CLIENT_TURN_ID.test(clientTurnId))) {
    return { error: { error: "clientTurnId must be 8-100 characters of A-Z, a-z, 0-9, _ or -", code: "invalid_client_turn_id" } };
  }
  // Unlike a malformed key, an unknown agent is named back to the client: running the turn with every
  // skill instead would not be what the user asked for.
  if (agentId !== undefined && agentId !== null && !findAgent(agentId)) {
    return { error: { error: "Unknown agent.", code: "invalid_agent" } };
  }
  return {
    clientTurnId: typeof clientTurnId === "string" ? clientTurnId : undefined,
    projectId: typeof projectId === "string" && projectId.trim() ? projectId.trim().slice(0, 100) : undefined,
    agentId: typeof agentId === "string" ? agentId : undefined,
    accountId: req.auth!.accountId,
    utterance: utterance.slice(0, 70_000),
    locale: typeof locale === "string" ? locale.slice(0, 16) : undefined,
    // Client-supplied display label, never an identity claim; capped so it can't carry a large prompt.
    userName: typeof userName === "string" && userName.trim() ? userName.trim().slice(0, 60) : undefined,
    isFirstTurn: isFirstTurn === true,
    history: sanitizeHistory(history),
    conversationId: typeof conversationId === "string" && conversationId.trim() ? conversationId.trim().slice(0, 100) : undefined,
    // A preference: "balanced" (the default) and anything unknown mean the normal length, never an error.
    replyLength: replyLength === "short" || replyLength === "detailed" ? replyLength : undefined,
    // A hint about the reply's form, like replyLength: anything but "voice" is a typed message, never an error.
    inputMode: inputMode === "voice" ? "voice" : undefined,
    // Only ids the server knows; an unknown one (an older or newer client) is ignored, never an error.
    deviceActions: Array.isArray(deviceActions) ? [...new Set(deviceActions.filter(isDeviceActionId))] : undefined,
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
