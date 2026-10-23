import { createHash, randomUUID } from "node:crypto";
import { deviceCapabilitiesForPrompt } from "../capabilities/registry.js";
import { deviceActionTools, findDeviceAction, nextPhoneStep, sanitizeDeviceInput, type DeviceActionRequest } from "../capabilities/deviceActions.js";
import { resolveEntitlement } from "../domain/entitlementResolver.js";
import type { SkillExecutionContext, ToolCall, ToolExecutionOutcome } from "../domain/types.js";
import { toStructuredResult, type StructuredToolResult } from "../tooling/toolResult.js";
import { explainOutcome } from "../tooling/explainOutcome.js";
import { stableJson } from "../util/stableJson.js";
import { previewInput } from "../tooling/executionRecord.js";
import type { ConversationMessage as StoredConversationMessage, Store, TurnRecord } from "../store/store.js";
import type { AICallMeta, AIProvider, ConversationMessage, ModelConfiguration } from "../ai/provider.js";
import type { EntitlementPort } from "../tooling/ports.js";
import type { SkillRegistry } from "../tooling/skillRegistry.js";
import type { ToolPipeline } from "../tooling/toolPipeline.js";
import { classifyIdentityQuestion, creatorIdentityForPrompt, identityResponse } from "../config/zarvisProfile.js";
import { abortError } from "../ai/geminiErrors.js";
import { logger } from "../security/redact.js";
import { withModelCallLog, type ModelCallRecord } from "../ai/callTrace.js";
import { correlationFields, runWithCorrelation } from "../observability/requestContext.js";
import type { PipelineStage } from "../tooling/toolPipeline.js";
import { detectReplyLanguage } from "../language/textLanguage.js";
import { findAgent } from "./agentProfiles.js";
import { contextPrompt, loadTurnContext, type TurnContextText } from "./turnContext.js";

export interface TurnRequest {
  accountId: string;
  utterance: string;
  locale?: string;
  /** Client-supplied display name; never an identity/auth claim. */
  userName?: string;
  /** True only for the first turn of a client session. */
  isFirstTurn?: boolean;
  /** Client fallback history used only when no server conversation exists yet. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Durable server-side conversation id. */
  conversationId?: string;
  /**
   * The project a NEW conversation is created in. An existing conversation keeps its own project;
   * an id that is not the account's project is ignored (the chat is simply not in a project).
   */
  projectId?: string;
  /** Run the turn as one of the user-facing agents: the planner only sees that agent's skills. */
  agentId?: string;
  /** The task whose step this turn carries out, recorded on executions and confirmations. */
  taskId?: string;
  /** Correlation id for this one user turn; generated when the caller has none. */
  turnId?: string;
  /**
   * The client's idempotency key for this logical user turn, reused when it re-sends the same
   * turn (Retry). A completed turn is replayed instead of executed again; see claimTurn.
   */
  clientTurnId?: string;
  /** Aborted when the client goes away: no further model or tool call starts after that. */
  signal?: AbortSignal;
  /** How long the user wants replies to be (the client's "Answer length" setting). Absent: the model's normal length. */
  replyLength?: ReplyLength;
  /**
   * The phone actions the client can run itself (ids from capabilities/deviceActions.ts; the Android app sends the ones
   * it implements). The planner may hand one of them to the phone instead of describing manual steps; see TurnResult.deviceAction.
   */
  deviceActions?: string[];
  /**
   * The next step of a multi-step phone request (POST /device-result with `continueWith`): `utterance` is the planner's
   * instruction from continuationNote, not something the user said, so it is not stored, and the conversation must exist.
   */
  continuation?: boolean;
}

/** "Balanced" is the default and needs no instruction, so it is not a value here. */
export type ReplyLength = "short" | "detailed";

/** What the planner is told for each answer length. A preference, not a hard limit: a request that needs more still gets it. */
export const REPLY_LENGTH_GUIDANCE: Readonly<Record<ReplyLength, string>> = {
  short:
    "The user prefers short answers: two or three sentences, or a short list, unless they ask for more. " +
    "Skip introductions, recaps and offers of further help.",
  detailed:
    "The user prefers detailed answers: explain fully, with steps, examples or headings where they help, " +
    "and stay on the topic they asked about.",
};

export interface TurnToolCall {
  /** Unique per execution, so a client can tell two real executions from one rendered twice. */
  toolCallId: string;
  skillId: string;
  outcome: ToolExecutionOutcome;
  /** Blueprint §10 structured result for the same outcome. */
  result: StructuredToolResult;
}

export interface TurnResult {
  message: string;
  toolCalls: TurnToolCall[];
  conversationId: string;
  turnId: string;
  /** True when this is the stored result of an already-completed turn: nothing was executed. */
  replayed?: boolean;
  /**
   * The planner handed a phone action to the client (one it listed in TurnRequest.deviceActions). Nothing ran on the
   * server: the phone runs it through its own permission and confirmation flow and reports the real result to
   * POST /api/v1/orchestrator/device-result, which records it as the reply. `message` is then only what the model said
   * alongside (often empty).
   */
  deviceAction?: DeviceActionRequest;
  /**
   * Which AI provider wrote `message`, for the client's "answered by" label: its id (`groq`, `openrouter`,
   * `google`, `openai`) and whether it answered because the provider before it was unavailable (rate limited,
   * out of quota, down). Absent when no live model wrote the reply (a greeting, a fixed message, the development
   * mock). Nothing else about the call (model, keys, reasons, timings) leaves the server.
   */
  ai?: ReplyProvider;
}

export interface ReplyProvider {
  provider: string;
  fallback: boolean;
}

/**
 * The client-facing part of the gateway's call meta. A provider skipped only because it cannot do what the
 * request needs (no tool support) is routing, not an outage, so the answer is not labelled a fallback.
 */
export function replyProvider(meta: AICallMeta | undefined): ReplyProvider | undefined {
  if (!meta || meta.provider === "mock" || meta.provider === "none") return undefined;
  const routedByCapability = meta.fallbackReason?.endsWith("_CAPABILITY_UNSUPPORTED") ?? false;
  return { provider: meta.provider, fallback: meta.fallback && !routedByCapability };
}

/** The same logical turn (clientTurnId) is being executed by another request right now. */
export class TurnInProgressError extends Error {
  readonly code = "turn_in_progress";
  constructor() {
    super("This message is still being processed.");
    this.name = "TurnInProgressError";
  }
}

/** The client reused a clientTurnId for a different message (a client bug): nothing runs. */
export class ClientTurnIdReusedError extends Error {
  readonly code = "client_turn_id_reused";
  constructor() {
    super("This message id was already used for a different message.");
    this.name = "ClientTurnIdReusedError";
  }
}

/**
 * A `running` turn record older than this belongs to a request that died (a killed serverless
 * invocation, a crash): a retry may take it over. Longer than any bounded agent turn.
 */
const STALE_TURN_MS = 5 * 60 * 1000;

/** Real progress of a turn, emitted only when the stage actually happens (no simulated steps). */
export type TurnEvent =
  | { type: "conversation"; conversationId: string; projectId?: string; agentId?: string }
  | { type: "thinking"; step: number }
  | { type: "tool_started"; skillId: string; toolCallId: string; skillName?: string; riskLevel?: string; actionClass?: string; inputPreview?: Record<string, unknown> }
  | { type: "tool_stage"; skillId: string; toolCallId: string; stage: PipelineStage; action?: string }
  | { type: "tool_finished"; skillId: string; toolCallId: string; status: StructuredToolResult["status"]; summary?: string };

interface TurnStats {
  modelCalls: number;
  providerHttpRequests: number;
  providerResponseIds: string[];
  servedModels: string[];
  toolCalls: Array<{ toolCallId: string; skillId: string; reused?: boolean; chargedCredits?: number }>;
  /** Successful executions of this attempt, by request key; kept if the turn fails. */
  completedTools: Array<{ requestKey: string; call: TurnToolCall }>;
}

/** What a failed attempt leaves for its retry: the tool executions that already succeeded. */
interface FailedAttemptResult {
  completedTools?: Array<{ requestKey: string; call: TurnToolCall }>;
}

const MAX_AGENT_STEPS = 5;
const MAX_TOOL_RESULT_CHARS = 8000;

/**
 * Failures of the service behind a skill (not of the user's input). Re-running the same skill
 * in the same turn after one of these only repeats the failure — and, for an AI quota, spends
 * more of it — so the turn does not do that.
 */
const INFRASTRUCTURE_FAILURES = new Set([
  "handler_error",
  "ai_quota_exceeded",
  "ai_rate_limited",
  "ai_provider_unavailable",
  "search_provider_unavailable",
]);
/** After one of these no further model call can succeed in this turn either. */
const TURN_ENDING_FAILURES = new Set(["ai_quota_exceeded", "ai_rate_limited"]);

/**
 * ZARVIS Agent Core v1.
 *
 * A turn is now a bounded agent loop rather than a one-shot classifier:
 * model -> tool(s) -> real result -> model -> next tool(s) or final answer.
 *
 * The ToolPipeline remains the authoritative security boundary. The loop is deliberately
 * bounded so a bad model response can never create an unbounded server-side workflow.
 */
export class Orchestrator {
  constructor(
    private readonly registry: SkillRegistry,
    private readonly entitlementPort: EntitlementPort,
    private readonly pipeline: ToolPipeline,
    private readonly provider: AIProvider,
    private readonly modelConfig: ModelConfiguration,
    private readonly store: Store,
  ) {}

  async runTurn(request: TurnRequest, onEvent: (event: TurnEvent) => void = () => {}): Promise<TurnResult> {
    const turnId = request.turnId ?? randomUUID();
    const stats: TurnStats = { modelCalls: 0, providerHttpRequests: 0, providerResponseIds: [], servedModels: [], toolCalls: [], completedTools: [] };
    const startedAt = Date.now();
    const { clientTurnId } = request;
    let outcome = "error";
    let previousAttempt: TurnRecord | undefined;
    if (clientTurnId) {
      const now = new Date();
      const fingerprint = createHash("sha256").update(request.utterance.trim()).digest("hex");
      const claim = await this.store.claimTurn(request.accountId, clientTurnId, fingerprint, now, new Date(now.getTime() - STALE_TURN_MS));
      if (claim.kind === "conflict") {
        logger.warn("clientTurnId reused for a different message", { turnId, clientTurnId });
        throw new ClientTurnIdReusedError();
      }
      if (claim.kind === "in_progress") {
        logger.info("Turn duplicate rejected while in progress", { turnId, clientTurnId });
        throw new TurnInProgressError();
      }
      if (claim.kind === "completed") {
        const stored = claim.record.result as TurnResult | undefined;
        if (stored && typeof stored.message === "string") {
          // A re-sent turn that already finished (e.g. its stream dropped after the server
          // completed it): return what it produced. No model call, no tool, no charge.
          logger.info("Turn replayed from its stored result", { turnId, clientTurnId, originalTurnId: stored.turnId });
          onEvent({ type: "conversation", conversationId: stored.conversationId, ...(request.agentId ? { agentId: request.agentId } : {}) });
          return { ...stored, replayed: true };
        }
      }
      if (claim.kind === "claimed") previousAttempt = claim.previous;
    }
    const modelCallLog: ModelCallRecord[] = [];
    try {
      // The turn's ids are in scope for everything it causes (the gateway's log lines carry them).
      const result = await withModelCallLog(modelCallLog, () =>
        runWithCorrelation({ turnId, clientTurnId }, () => this.executeTurn({ ...request, turnId }, onEvent, stats, previousAttempt)),
      );
      outcome = "completed";
      if (clientTurnId) await this.recordTurn(request.accountId, clientTurnId, { status: "completed", result });
      return result;
    } catch (error) {
      outcome = error instanceof Error && error.name === "AbortError" ? "cancelled" : error instanceof Error ? error.name : "error";
      // Keep what already succeeded, so the user's Retry reuses it instead of running (and
      // charging) the same tool again.
      if (clientTurnId) {
        const kept: FailedAttemptResult = { completedTools: stats.completedTools };
        await this.recordTurn(request.accountId, clientTurnId, { status: "failed", result: kept });
      }
      throw error;
    } finally {
      // One line per user turn: how much real work it caused. A single message producing two
      // web.search executions or many provider requests is visible here.
      logger.info("Turn finished", {
        ...correlationFields(),
        turnId,
        clientTurnId,
        retryOfFailedAttempt: previousAttempt !== undefined,
        outcome,
        durationMs: Date.now() - startedAt,
        // Planner steps only; `aiCalls` below counts every provider call the turn caused,
        // skills' own calls (search grounding, generation) included.
        modelCalls: stats.modelCalls,
        aiCalls: modelCallLog.length,
        aiHttpRequests: modelCallLog.reduce((sum, call) => sum + call.httpRequests, 0),
        // Logical calls (a fallback adds a second record to the same modelCallId), the providers
        // that took part, and how many records answered a request the primary had failed.
        aiLogicalCalls: new Set(modelCallLog.map((call) => call.modelCallId)).size,
        aiProviders: [...new Set(modelCallLog.map((call) => call.provider).filter((provider): provider is string => !!provider))],
        aiFallbackCalls: modelCallLog.filter((call) => call.fallback).length,
        chargedCredits: stats.toolCalls.reduce((sum, call) => sum + (call.chargedCredits ?? 0), 0),
        aiCallLog: modelCallLog.slice(0, 20),
        providerHttpRequests: stats.providerHttpRequests,
        providerResponseIds: stats.providerResponseIds.slice(0, 10),
        configuredModel: this.modelConfig.model,
        servedModels: [...new Set(stats.servedModels)],
        toolCalls: stats.toolCalls,
      });
    }
  }

  /** Turn bookkeeping must never replace the turn's real outcome with a storage error. */
  private async recordTurn(
    accountId: string,
    clientTurnId: string,
    patch: { status?: "completed" | "failed"; conversationId?: string; result?: unknown },
  ): Promise<void> {
    try {
      await this.store.updateTurn(accountId, clientTurnId, patch, new Date());
    } catch (err) {
      logger.error("Could not record the turn's state", { clientTurnId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async executeTurn(
    request: TurnRequest & { turnId: string },
    onEvent: (event: TurnEvent) => void,
    stats: TurnStats,
    previousAttempt?: TurnRecord,
  ): Promise<TurnResult> {
    const { turnId, signal } = request;
    // A retry of a failed attempt continues in the conversation that attempt already wrote
    // the user's message to, even if the client never learned its id.
    const conversationId = previousAttempt?.conversationId ?? request.conversationId;
    const conversation = conversationId
      ? await this.store.getConversation(request.accountId, conversationId)
      : undefined;
    if (request.continuation && !conversation) throw new Error("A phone step can only continue an existing conversation.");
    // A new chat starts in the project the user opened it from, but only if that project is theirs.
    const requestedProject = !conversation && request.projectId
      ? await this.store.getProject(request.accountId, request.projectId)
      : undefined;
    const activeConversation = conversation ?? await this.store.createConversation(
      request.accountId,
      request.utterance.trim().slice(0, 80),
      requestedProject?.id,
    );
    const projectId = activeConversation.projectId;
    const agent = findAgent(request.agentId);
    const persistedMessages = await this.store.listConversationMessages(
      request.accountId,
      activeConversation.id,
      40,
    );
    if (!conversation && persistedMessages.length === 0 && request.history?.length) {
      // Compatibility bridge for an existing browser session: seed only the bounded,
      // user/assistant history once, then all subsequent turns come from the server.
      // Each message gets its own, later time: a database orders messages by time, and messages that
      // share one could come back in any order. They are dated just before now, so the current
      // message (stored next, at the present time) still comes after them.
      const seededAt = Date.now() - request.history.length;
      const seed = request.history.map((message, index) => ({
        id: randomUUID(),
        conversationId: activeConversation.id,
        role: message.role,
        content: message.content,
        createdAt: new Date(seededAt + index),
      } satisfies StoredConversationMessage));
      await this.store.appendConversationMessages(seed);
      persistedMessages.push(...seed);
    }

    onEvent({ type: "conversation", conversationId: activeConversation.id, ...(projectId ? { projectId } : {}), ...(agent ? { agentId: agent.id } : {}) });
    // The failed attempt being retried already stored this message: store it once. A phone step's instruction is not the
    // user's message and is never stored.
    const userMessageStored = request.continuation === true || previousAttempt?.conversationId === activeConversation.id;
    if (userMessageStored) {
      // History is read before the current message is added below; drop the stored copy so
      // the model sees this message once, as the current one.
      const last = persistedMessages[persistedMessages.length - 1];
      if (!request.continuation && last?.role === "user" && last.content === request.utterance.trim().slice(0, 12000)) persistedMessages.pop();
    } else {
      await this.store.appendConversationMessages([{
        id: randomUUID(),
        conversationId: activeConversation.id,
        role: "user",
        content: request.utterance.trim().slice(0, 12000),
        createdAt: new Date(),
      }]);
      if (request.clientTurnId) {
        await this.recordTurn(request.accountId, request.clientTurnId, { conversationId: activeConversation.id });
      }
    }

    // Greetings are conversational turns, not agent tasks. Do not expose the tool catalogue
    // to the model for a simple greeting: otherwise a model can incorrectly reuse a previous
    // conversation's developer/search context and execute a tool for "Hi". This fast path is
    // also provider-independent, so a greeting never consumes AI/tool credits.
    const greeting = request.continuation ? undefined : getSimpleGreetingResponse(request.utterance, request.locale);
    if (greeting) {
      await this.persistAssistantMessage(activeConversation.id, greeting);
      return { message: greeting, toolCalls: [], conversationId: activeConversation.id, turnId };
    }

    const profileResponse = request.continuation ? undefined : getZarvisProfileResponse(request.utterance, request.locale);
    if (profileResponse) {
      await this.persistAssistantMessage(activeConversation.id, profileResponse);
      return { message: profileResponse, toolCalls: [], conversationId: activeConversation.id, turnId };
    }

    const snapshot = await this.entitlementPort.snapshot(request.accountId);
    const now = new Date();
    const availableSkills = this.registry
      .all()
      .filter((skill) => !skill.executesOnDevice)
      .filter((skill) => resolveEntitlement(snapshot, skill, now).allowed)
      // "Ask Agent": the planner only sees the skills of the chosen agent's categories.
      .filter((skill) => !agent || agent.categories.includes(skill.category));

    const tools = availableSkills
      // A previous developer result is context, not permission to repeat the same action.
      // Only expose repository analysis when the CURRENT utterance explicitly asks to analyze,
      // inspect, check, debug, or scan a repository (or includes a GitHub URL).
      .filter((skill) => skill.id !== "developer.analyze_repo" || shouldAnalyzeRepository(request.utterance))
      .map((skill) => ({
        name: skill.id,
        description: skill.description,
        inputSchema: skill.inputSchema,
      }));
    // The phone's own actions, when the client runs them (the Android app). Not with an agent: an agent's planner sees
    // only that agent's skills.
    const deviceTools = agent ? [] : deviceActionTools(request.deviceActions);
    tools.push(...deviceTools);
    const offeredDeviceActions = new Set(deviceTools.map((tool) => tool.name));

    /** Only a skill that was offered this turn may run: a model can name any skill, and an unlisted one must not execute. */
    const offeredSkills = new Set(tools.map((tool) => tool.name));

    const context: SkillExecutionContext = {
      accountId: request.accountId,
      taskId: request.taskId,
      conversationId: activeConversation.id,
      ...(projectId ? { projectId } : {}),
      locale: request.locale ?? "en",
    };
    // Saved memory and the project's state, read now; a failure here must not stop the turn.
    let turnContext: TurnContextText = {};
    try {
      turnContext = await loadTurnContext(this.store, request.accountId, projectId);
    } catch (err) {
      logger.warn("Could not load saved memory for the turn", { turnId, error: err instanceof Error ? err.message : String(err) });
    }

    const results: TurnToolCall[] = [];
    const executedToolRequests = new Set<string>();
    /** Successful executions of the failed attempt being retried, reused for the same request. */
    const reusable = new Map(
      ((previousAttempt?.result as FailedAttemptResult | undefined)?.completedTools ?? []).map((entry) => [entry.requestKey, entry.call] as const),
    );
    /** Skills whose service already failed in this turn; they are not run again. */
    const failedSkills = new Set<string>();
    const trace = { httpRequests: 0, responseIds: [] as string[], servedModels: stats.servedModels };
    const messages: ConversationMessage[] = [
      ...persistedMessages.map((message) => ({
        role: message.role === "tool" ? "user" as const : message.role,
        content: message.role === "tool" ? "[Previous tool result] " + message.content : message.content,
      })),
      { role: "user", content: request.utterance },
    ];

    for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
      if (signal?.aborted) throw abortError();
      onEvent({ type: "thinking", step: step + 1 });
      stats.modelCalls += 1;
      let aiResponse;
      try {
        aiResponse = await this.provider.generate({
          modelCallId: randomUUID(),
          purpose: "planner",
          systemPrompt: buildSystemPrompt(request, step, results.length > 0, {
            context: turnContext,
            agentFocus: agent?.focus,
            phoneActionsOffered: offeredDeviceActions.size > 0,
          }),
          messages,
          tools,
          modelConfig: this.modelConfig,
          signal,
          trace,
        });
      } finally {
        stats.providerHttpRequests = trace.httpRequests;
        stats.providerResponseIds = trace.responseIds;
      }

      const toolCalls = aiResponse.toolCalls ?? [];
      if (toolCalls.length === 0) {
        const message = aiResponse.message.content?.trim();
        if (message) {
          await this.persistAssistantMessage(activeConversation.id, message);
          const ai = replyProvider(aiResponse.meta);
          return { message, toolCalls: results, conversationId: activeConversation.id, turnId, ...(ai ? { ai } : {}) };
        }
        const fallbackMessage = results.length > 0
          ? results.map((r) => explainOutcome(r.outcome)).join("\n")
          : "I couldn't produce a response. Please try again.";
        await this.persistAssistantMessage(activeConversation.id, fallbackMessage);
        return {
          message: fallbackMessage,
          toolCalls: results,
          conversationId: activeConversation.id,
          turnId,
        };
      }

      // Preserve the model's intermediate reasoning text as context without exposing it
      // directly to the user. Gemini's provider maps assistant messages to model turns.
      if (aiResponse.message.content?.trim()) {
        messages.push({ role: "assistant", content: aiResponse.message.content.trim() });
      }

      let executedAny = false;
      for (const call of toolCalls) {
        if (!offeredSkills.has(call.skillId)) {
          // A skill that was hidden (another agent's, one this plan does not include, or a name the model made up).
          // It is not run, charged or shown to the user as a tool call; the model is told, so it can answer another way.
          logger.warn("The model asked for a tool that was not offered this turn", { turnId, skillId: call.skillId.slice(0, 80) });
          messages.push({
            role: "tool",
            content: JSON.stringify({ skillId: call.skillId, result: "That tool is not available for this request. Answer without it.", success: false }).slice(0, MAX_TOOL_RESULT_CHARS),
          });
          executedAny = true;
          continue;
        }
        // A phone action ends the turn here: the server never runs it. The phone does, through its own permission and
        // confirmation flow, and reports the real result (POST /device-result), which becomes the reply.
        if (offeredDeviceActions.has(call.skillId)) {
          const action = findDeviceAction(call.skillId)!;
          const then = nextPhoneStep(call.input);
          const deviceAction: DeviceActionRequest = {
            toolCallId: randomUUID(),
            skillId: call.skillId,
            input: sanitizeDeviceInput(action, call.input),
            ...(then ? { then } : {}),
          };
          stats.toolCalls.push({ toolCallId: deviceAction.toolCallId, skillId: call.skillId, chargedCredits: 0 });
          onEvent({ type: "tool_started", skillId: call.skillId, toolCallId: deviceAction.toolCallId, inputPreview: previewInput(deviceAction.input) });
          logger.info("Phone action handed to the client", { turnId, skillId: call.skillId, toolCallId: deviceAction.toolCallId });
          return {
            message: aiResponse.message.content?.trim() ?? "",
            toolCalls: results,
            conversationId: activeConversation.id,
            turnId,
            deviceAction,
          };
        }
        // Prevent accidental duplicate execution of the exact same request inside one run.
        // A later step may still call the same skill with different arguments.
        const requestKey = call.skillId + ":" + stableJson(call.input);
        if (executedToolRequests.has(requestKey)) continue;
        // A reworded retry of a skill whose service just failed (e.g. a second web search
        // after the first hit a quota) would fail the same way: skip it.
        if (failedSkills.has(call.skillId)) continue;
        executedToolRequests.add(requestKey);
        if (signal?.aborted) throw abortError();

        const previous = reusable.get(requestKey);
        let outcome: ToolExecutionOutcome;
        if (previous) {
          // The failed attempt already ran this exact request successfully (and charged it):
          // use that result. Same toolCallId, because it is the same execution.
          outcome = previous.outcome;
          stats.toolCalls.push({ toolCallId: previous.toolCallId, skillId: call.skillId, reused: true, chargedCredits: 0 });
          results.push(previous);
          stats.completedTools.push({ requestKey, call: previous });
          onEvent({ type: "tool_finished", skillId: call.skillId, toolCallId: previous.toolCallId, status: previous.result.status });
        } else {
          const toolCall: ToolCall = {
            id: randomUUID(),
            skillId: call.skillId,
            input: { values: call.input },
          };
          const statEntry: TurnStats["toolCalls"][number] = { toolCallId: toolCall.id, skillId: call.skillId };
          stats.toolCalls.push(statEntry);
          const skill = this.registry.find(call.skillId);
          onEvent({
            type: "tool_started",
            skillId: call.skillId,
            toolCallId: toolCall.id,
            ...(skill ? { skillName: skill.name, riskLevel: skill.riskLevel, actionClass: skill.actionClass } : {}),
            inputPreview: previewInput(call.input),
          });
          outcome = await this.pipeline.execute(toolCall, context, {
            onStage: ({ stage, action }) => onEvent({ type: "tool_stage", skillId: call.skillId, toolCallId: toolCall.id, stage, ...(action ? { action } : {}) }),
          });
          // What this execution actually charged: a failed or blocked one is 0.
          statEntry.chargedCredits = outcome.kind === "success" ? outcome.chargedCredits : 0;
          const result = toStructuredResult(call.skillId, skill, outcome, explainOutcome(outcome));
          const executed = { toolCallId: toolCall.id, skillId: call.skillId, outcome, result };
          results.push(executed);
          if (outcome.kind === "success") stats.completedTools.push({ requestKey, call: executed });
          onEvent({ type: "tool_finished", skillId: call.skillId, toolCallId: toolCall.id, status: result.status, summary: result.userSafeMessage.replace(/\s+/g, " ").trim().slice(0, 240) });
        }
        executedAny = true;

        if (outcome.kind === "execution_failed" && INFRASTRUCTURE_FAILURES.has(outcome.result.reason)) {
          failedSkills.add(call.skillId);
          if (TURN_ENDING_FAILURES.has(outcome.result.reason)) {
            // The AI service is out of quota: another model call in this turn would fail the
            // same way. End honestly with what actually happened.
            const message = results.map((r) => explainOutcome(r.outcome)).join("\n");
            await this.persistAssistantMessage(activeConversation.id, message);
            return { message, toolCalls: results, conversationId: activeConversation.id, turnId };
          }
        }

        // A pending confirmation ends the turn: nothing else runs until the user approves or
        // declines that exact action, and the model gets no chance to re-plan around it.
        if (outcome.kind === "confirmation_required") {
          const message = results.map((r) => explainOutcome(r.outcome)).join("\n");
          await this.persistAssistantMessage(activeConversation.id, message);
          return { message, toolCalls: results, conversationId: activeConversation.id, turnId };
        }

        messages.push({
          role: "tool",
          content: JSON.stringify({
            skillId: call.skillId,
            result: explainOutcome(outcome),
            success: outcome.kind === "success",
          }).slice(0, MAX_TOOL_RESULT_CHARS),
        });
      }

      // If the provider repeatedly returns only duplicate calls, stop rather than spinning.
      if (!executedAny) {
        const fallbackMessage = results.length > 0
          ? results.map((r) => explainOutcome(r.outcome)).join("\n")
          : "I couldn't determine the next action. Please try again.";
        await this.persistAssistantMessage(activeConversation.id, fallbackMessage);
        return {
          message: fallbackMessage,
          toolCalls: results,
          conversationId: activeConversation.id,
          turnId,
        };
      }
    }

    // Hard safety/latency boundary. We do not claim completion merely because the loop limit
    // was reached; the user gets the authoritative results that actually happened.
    const fallback = results.length > 0
      ? results.map((r) => explainOutcome(r.outcome)).join("\n")
      : "I reached the maximum number of agent steps without completing the request.";
    await this.persistAssistantMessage(activeConversation.id, fallback);
    return { message: fallback, toolCalls: results, conversationId: activeConversation.id, turnId };
  }

  /**
   * Records what the phone reported for a phone action it ran (TurnResult.deviceAction) as the assistant's reply in that
   * conversation. Only the account's own conversation; false when it has no such conversation.
   */
  async recordDeviceResult(accountId: string, report: { conversationId: string; message: string }): Promise<boolean> {
    const conversation = await this.store.getConversation(accountId, report.conversationId);
    if (!conversation) return false;
    await this.persistAssistantMessage(conversation.id, report.message);
    return true;
  }

  private async persistAssistantMessage(conversationId: string, message: string): Promise<void> {
    await this.store.appendConversationMessages([{
      id: randomUUID(),
      conversationId,
      role: "assistant",
      content: message.slice(0, 12000),
      createdAt: new Date(),
    }]);
  }
}

function shouldAnalyzeRepository(utterance: string): boolean {
  const normalized = utterance.trim().toLocaleLowerCase();
  const hasGithubUrl = /https?:\/\/github\.com\/\S+/i.test(normalized);
  if (hasGithubUrl) return true;

  // Require an explicit repository/developer action in the current turn. A vague follow-up
  // such as "koi error hai kya?" must not re-run the previous repository-analysis tool.
  const repositoryTarget = /\b(repo(?:sitory)?|github|project|codebase|source\s*code|code)\b|रिपोजिटरी|रिपॉजिटरी|प्रोजेक्ट|कोड/.test(normalized);
  const analysisAction =
    /\b(analy[sz]e|analysis|inspect|review|scan|debug|check|audit|find\s+(?:any\s+)?(?:error|errors|issues|bugs)|look\s+(?:for|into))\b|विश्लेषण|जांच|चेक|स्कैन|डिबग|एरर|बग/.test(normalized);

  return repositoryTarget && analysisAction;
}

/** Identity questions (creator, owner, boss, where the creator is from, attempts to rewrite
 * the creator) get the trusted answer from config/zarvisProfile.ts, never a model's guess. */
function getZarvisProfileResponse(utterance: string, locale?: string): string | undefined {
  const kind = classifyIdentityQuestion(utterance);
  if (!kind) return undefined;
  return identityResponse(kind, detectReplyLanguage(utterance.trim().toLocaleLowerCase(), locale));
}

function getSimpleGreetingResponse(utterance: string, locale?: string): string | undefined {
  const normalized = utterance
    .trim()
    .toLocaleLowerCase()
    .replace(/[!,.?。！？]+$/g, "")
    .replace(/\s+/g, " ");

  const isGreeting =
    /^(?:hi|hello|hey|hiya|yo|namaste|namaskar|good morning|good afternoon|good evening|नमस्ते|नमस्कार|हाय|हेलो|सुप्रभात)$/.test(
      normalized,
    ) ||
    /^(?:hi|hello|hey|namaste|नमस्ते|हाय|हेलो)\s+(?:zarvis|jarvis|ज़ार्विस|जार्विस)$/.test(normalized);

  if (!isGreeting) return undefined;

  // The greeting's own language decides, as for every other reply: "नमस्ते" or "namaste" with an English app gets Hindi, and
  // a greeting with no language of its own ("hi", "hello") follows the app language.
  return detectReplyLanguage(normalized, locale) === "hi"
    ? "नमस्ते! 👋 मैं ZARVIS हूँ। मैं आपकी कैसे मदद कर सकता हूँ?"
    : "Hi! 👋 I'm ZARVIS. How can I help you today?";
}

/** Exported for tests only. */
export function buildSystemPrompt(
  request: TurnRequest,
  step: number,
  hasExecutedTools: boolean,
  extra: { context?: TurnContextText; agentFocus?: string; phoneActionsOffered?: boolean } = {},
): string {
  const replyLanguage = detectReplyLanguage(request.utterance, request.locale);
  let prompt =
    "You are ZARVIS, a general-purpose AI agent. Your job is to complete the user's goal, " +
    "not merely classify the request. You have access to tools and may use multiple tools " +
    "across multiple steps when the task requires it. Choose the next useful action, inspect " +
    "the real result, then either continue with another tool or give the final answer. " +
    "Never claim an action happened unless a tool result confirms it. Prefer the smallest " +
    "number of tool calls that fully completes the goal. Do not invent missing tool results. " +
    "Reply in the language of the user's CURRENT message, not merely the UI locale. " +
    "Treat Roman-script Hindi/Hinglish as Hindi/Hinglish: phrases such as 'aapko kisne banaya', " +
    "'kya haal hai', and 'kal ka weather kaisa rahega' should receive a natural Hindi/Hinglish " +
    "reply rather than an English-only reply. If the user mixes Hindi and English, preserve that " +
    "natural mix. Do not switch languages just because the browser locale is English.";

  prompt += " " + creatorIdentityForPrompt();
  prompt += " " + deviceCapabilitiesForPrompt(extra.phoneActionsOffered === true);

  prompt +=
    ` Respond in ${replyLanguage === "hi" ? "Hindi/Hinglish" : "English"} based on the current user message. ` +
    "Do not let an English UI locale override a Hindi/Hinglish current message.";
  prompt += ` This is agent step ${step + 1} of a maximum of ${MAX_AGENT_STEPS}.`;
  if (hasExecutedTools) {
    prompt +=
      " Previous tool results are in the conversation as [Tool result] messages. Treat those " +
      "results as authoritative and use them to decide the next step.";
  }

  if (extra.agentFocus) prompt += " " + extra.agentFocus;
  if (request.replyLength) prompt += " " + REPLY_LENGTH_GUIDANCE[request.replyLength];
  const saved = extra.context ? contextPrompt(extra.context) : "";
  if (saved) prompt += "\n\n" + saved + "\n\n";

  if (request.userName) {
    prompt +=
      ` The user's display name is ${request.userName}. Use it naturally only when appropriate; ` +
      "do not treat it as an identity or authorization claim.";
  }

  if (request.isFirstTurn) {
    prompt +=
      " This is the first turn of a new session. For a simple greeting, give a short polished " +
      "ZARVIS welcome and invite the user to ask for something. Do not dump a feature list. " +
      "For a real task, start working on the task immediately.";
  }

  return prompt;
}

export { explainOutcome } from "../tooling/explainOutcome.js";
