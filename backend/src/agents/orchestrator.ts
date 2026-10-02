import { randomUUID } from "node:crypto";
import { deviceCapabilitiesForPrompt } from "../capabilities/registry.js";
import { resolveEntitlement } from "../domain/entitlementResolver.js";
import type { SkillExecutionContext, ToolCall, ToolExecutionOutcome } from "../domain/types.js";
import { toStructuredResult, type StructuredToolResult } from "../tooling/toolResult.js";
import { stableJson } from "../util/stableJson.js";
import type { ConversationMessage as StoredConversationMessage, Store, TurnRecord } from "../store/store.js";
import type { AIProvider, ConversationMessage, ModelConfiguration } from "../ai/provider.js";
import type { EntitlementPort } from "../tooling/ports.js";
import type { SkillRegistry } from "../tooling/skillRegistry.js";
import type { ToolPipeline } from "../tooling/toolPipeline.js";
import { classifyIdentityQuestion, creatorIdentityForPrompt, identityResponse } from "../config/zarvisProfile.js";
import { abortError } from "../ai/geminiErrors.js";
import { logger } from "../security/redact.js";

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
  /** Correlation id for this one user turn; generated when the caller has none. */
  turnId?: string;
  /**
   * The client's idempotency key for this logical user turn, reused when it re-sends the same
   * turn (Retry). A completed turn is replayed instead of executed again; see claimTurn.
   */
  clientTurnId?: string;
  /** Aborted when the client goes away: no further model or tool call starts after that. */
  signal?: AbortSignal;
}

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
}

/** The same logical turn (clientTurnId) is being executed by another request right now. */
export class TurnInProgressError extends Error {
  readonly code = "turn_in_progress";
  constructor() {
    super("This message is still being processed.");
    this.name = "TurnInProgressError";
  }
}

/**
 * A `running` turn record older than this belongs to a request that died (a killed serverless
 * invocation, a crash): a retry may take it over. Longer than any bounded agent turn.
 */
const STALE_TURN_MS = 5 * 60 * 1000;

/** Real progress of a turn, emitted only when the stage actually happens (no simulated steps). */
export type TurnEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "thinking"; step: number }
  | { type: "tool_started"; skillId: string; toolCallId: string }
  | { type: "tool_finished"; skillId: string; toolCallId: string; status: StructuredToolResult["status"] };

interface TurnStats {
  modelCalls: number;
  providerHttpRequests: number;
  providerResponseIds: string[];
  toolCalls: Array<{ toolCallId: string; skillId: string }>;
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
    const stats: TurnStats = { modelCalls: 0, providerHttpRequests: 0, providerResponseIds: [], toolCalls: [] };
    const startedAt = Date.now();
    const { clientTurnId } = request;
    let outcome = "error";
    let previousAttempt: TurnRecord | undefined;
    if (clientTurnId) {
      const now = new Date();
      const claim = await this.store.claimTurn(request.accountId, clientTurnId, now, new Date(now.getTime() - STALE_TURN_MS));
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
          onEvent({ type: "conversation", conversationId: stored.conversationId });
          return { ...stored, replayed: true };
        }
      }
      if (claim.kind === "claimed") previousAttempt = claim.previous;
    }
    try {
      const result = await this.executeTurn({ ...request, turnId }, onEvent, stats, previousAttempt);
      outcome = "completed";
      if (clientTurnId) await this.recordTurn(request.accountId, clientTurnId, { status: "completed", result });
      return result;
    } catch (error) {
      outcome = error instanceof Error && error.name === "AbortError" ? "cancelled" : error instanceof Error ? error.name : "error";
      if (clientTurnId) await this.recordTurn(request.accountId, clientTurnId, { status: "failed" });
      throw error;
    } finally {
      // One line per user turn: how much real work it caused. A single message producing two
      // web.search executions or many provider requests is visible here.
      logger.info("Turn finished", {
        turnId,
        clientTurnId,
        retryOfFailedAttempt: previousAttempt !== undefined,
        outcome,
        durationMs: Date.now() - startedAt,
        modelCalls: stats.modelCalls,
        providerHttpRequests: stats.providerHttpRequests,
        providerResponseIds: stats.providerResponseIds.slice(0, 10),
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
    const activeConversation = conversation ?? await this.store.createConversation(
      request.accountId,
      request.utterance.trim().slice(0, 80),
    );
    const persistedMessages = await this.store.listConversationMessages(
      request.accountId,
      activeConversation.id,
      40,
    );
    if (!conversation && persistedMessages.length === 0 && request.history?.length) {
      // Compatibility bridge for an existing browser session: seed only the bounded,
      // user/assistant history once, then all subsequent turns come from the server.
      const seed = request.history.map((message) => ({
        id: randomUUID(),
        conversationId: activeConversation.id,
        role: message.role,
        content: message.content,
        createdAt: new Date(),
      } satisfies StoredConversationMessage));
      await this.store.appendConversationMessages(seed);
      persistedMessages.push(...seed);
    }

    onEvent({ type: "conversation", conversationId: activeConversation.id });
    // The failed attempt being retried already stored this message: store it once.
    const userMessageStored = previousAttempt?.conversationId === activeConversation.id;
    if (userMessageStored) {
      // History is read before the current message is added below; drop the stored copy so
      // the model sees this message once, as the current one.
      const last = persistedMessages[persistedMessages.length - 1];
      if (last?.role === "user" && last.content === request.utterance.trim().slice(0, 12000)) persistedMessages.pop();
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
    const greeting = getSimpleGreetingResponse(request.utterance, request.locale);
    if (greeting) {
      await this.persistAssistantMessage(activeConversation.id, greeting);
      return { message: greeting, toolCalls: [], conversationId: activeConversation.id, turnId };
    }

    const profileResponse = getZarvisProfileResponse(request.utterance, request.locale);
    if (profileResponse) {
      await this.persistAssistantMessage(activeConversation.id, profileResponse);
      return { message: profileResponse, toolCalls: [], conversationId: activeConversation.id, turnId };
    }

    const snapshot = await this.entitlementPort.snapshot(request.accountId);
    const now = new Date();
    const availableSkills = this.registry
      .all()
      .filter((skill) => !skill.executesOnDevice)
      .filter((skill) => resolveEntitlement(snapshot, skill, now).allowed);

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

    const context: SkillExecutionContext = {
      accountId: request.accountId,
      taskId: undefined,
      conversationId: activeConversation.id,
      locale: request.locale ?? "en",
    };

    const results: TurnToolCall[] = [];
    const executedToolRequests = new Set<string>();
    /** Skills whose service already failed in this turn; they are not run again. */
    const failedSkills = new Set<string>();
    const trace = { httpRequests: 0, responseIds: [] as string[] };
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
          systemPrompt: buildSystemPrompt(request, step, results.length > 0),
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
          return { message, toolCalls: results, conversationId: activeConversation.id, turnId };
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
        // Prevent accidental duplicate execution of the exact same request inside one run.
        // A later step may still call the same skill with different arguments.
        const requestKey = call.skillId + ":" + stableJson(call.input);
        if (executedToolRequests.has(requestKey)) continue;
        // A reworded retry of a skill whose service just failed (e.g. a second web search
        // after the first hit a quota) would fail the same way: skip it.
        if (failedSkills.has(call.skillId)) continue;
        executedToolRequests.add(requestKey);
        if (signal?.aborted) throw abortError();

        const toolCall: ToolCall = {
          id: randomUUID(),
          skillId: call.skillId,
          input: { values: call.input },
        };
        stats.toolCalls.push({ toolCallId: toolCall.id, skillId: call.skillId });
        onEvent({ type: "tool_started", skillId: call.skillId, toolCallId: toolCall.id });
        const outcome = await this.pipeline.execute(toolCall, context);
        const result = toStructuredResult(call.skillId, this.registry.find(call.skillId), outcome, explainOutcome(outcome));
        results.push({ toolCallId: toolCall.id, skillId: call.skillId, outcome, result });
        onEvent({ type: "tool_finished", skillId: call.skillId, toolCallId: toolCall.id, status: result.status });
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

function detectReplyLanguage(utterance: string, locale?: string): "hi" | "en" {
  if (/[\u0900-\u097f]/.test(utterance)) return "hi";

  const normalized = utterance.toLocaleLowerCase();
  const romanHindiMarkers =
    /\b(?:aap|ap|aapko|aapke|aapki|aapka|tum|tumhe|tumhein|mujhe|mera|meri|mere|kya|kaise|kaisa|kaisi|kyu|kyon|kyunki|hai|hain|ho|tha|thi|the|raha|rahi|rahe|batao|bataye|banaya|banai|kisne|kaun|kon|kahan|kab|kal|aaj|abhi|bahut|accha|achha|acha|haal|chal|karna|karo|kar|chahiye|hoga|hogi|denge|do|lo|wala|wali|wale)\b/;
  const englishMarkers =
    /\b(?:what|why|when|where|who|how|which|can|could|would|should|is|are|was|were|do|does|did|tell|show|find|search|explain|help|please|thanks|thank|weather|today|tomorrow|latest|create|build|design|develop)\b/;

  const romanHindiScore = (normalized.match(romanHindiMarkers) || []).length;
  const englishScore = (normalized.match(englishMarkers) || []).length;

  if (romanHindiScore > 0 && romanHindiScore >= englishScore) return "hi";
  if (englishScore > 0) return "en";

  return locale?.toLowerCase().startsWith("hi") ? "hi" : "en";
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

  return locale?.toLowerCase().startsWith("hi")
    ? "नमस्ते! 👋 मैं ZARVIS हूँ। मैं आपकी कैसे मदद कर सकता हूँ?"
    : "Hi! 👋 I'm ZARVIS. How can I help you today?";
}

/** Exported for tests only. */
export function buildSystemPrompt(request: TurnRequest, step: number, hasExecutedTools: boolean): string {
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
  prompt += " " + deviceCapabilitiesForPrompt();

  prompt +=
    ` Respond in ${replyLanguage === "hi" ? "Hindi/Hinglish" : "English"} based on the current user message. ` +
    "Do not let an English UI locale override a Hindi/Hinglish current message.";
  prompt += ` This is agent step ${step + 1} of a maximum of ${MAX_AGENT_STEPS}.`;
  if (hasExecutedTools) {
    prompt +=
      " Previous tool results are in the conversation as [Tool result] messages. Treat those " +
      "results as authoritative and use them to decide the next step.";
  }

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

/** Maps every pipeline outcome to an honest, user-facing explanation. */
export function explainOutcome(outcome: ToolExecutionOutcome): string {
  switch (outcome.kind) {
    case "success":
      return outcome.result.summary;
    case "skill_not_found":
      return "I don't have a skill for that yet.";
    case "validation_failed":
      return `I'm missing some details before I can do that: ${outcome.missingFields.join(", ")}.`;
    case "permission_denied":
      return `This needs a permission that isn't granted yet: ${outcome.missing.join(", ")}.`;
    case "entitlement_denied":
      return explainEntitlementDenial(outcome.decision);
    case "confirmation_required":
      return `I need your confirmation before I do this: ${outcome.confirmation.action} — approve or decline it below. Nothing has been done yet.`;
    case "confirmation_declined":
      return "You declined this action, so it was not performed.";
    case "execution_failed":
      return outcome.result.userMessage;
    case "verification_failed":
      return "Something went wrong while I was verifying the result, so I did not complete this action.";
  }
}

function explainEntitlementDenial(
  decision: Extract<ToolExecutionOutcome, { kind: "entitlement_denied" }>[ "decision" ],
): string {
  switch (decision.reason) {
    case "TRIAL_EXPIRED":
      return `Your trial has ended — upgrade to ${decision.upgradeTo ?? "a paid plan"} to keep using this.`;
    case "PLAN_TOO_LOW":
      return `This needs the ${decision.upgradeTo ?? "next"} plan.`;
    case "OUT_OF_CREDITS":
      return "You're out of credits for this action right now.";
  }
}
