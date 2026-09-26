import { randomUUID } from "node:crypto";
import { resolveEntitlement } from "../domain/entitlementResolver.js";
import type { SkillExecutionContext, ToolCall, ToolExecutionOutcome } from "../domain/types.js";
import type { ConversationMessage as StoredConversationMessage, Store } from "../store/store.js";
import type { AIProvider, ConversationMessage, ModelConfiguration } from "../ai/provider.js";
import type { EntitlementPort } from "../tooling/ports.js";
import type { SkillRegistry } from "../tooling/skillRegistry.js";
import type { ToolPipeline } from "../tooling/toolPipeline.js";

export interface TurnRequest {
  accountId: string;
  utterance: string;
  confirmed?: boolean;
  locale?: string;
  /** Client-supplied display name; never an identity/auth claim. */
  userName?: string;
  /** True only for the first turn of a client session. */
  isFirstTurn?: boolean;
  /** Client fallback history used only when no server conversation exists yet. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Durable server-side conversation id. */
  conversationId?: string;
}

export interface TurnResult {
  message: string;
  toolCalls: Array<{ skillId: string; outcome: ToolExecutionOutcome }>;
  conversationId: string;
}

const MAX_AGENT_STEPS = 5;
const MAX_TOOL_RESULT_CHARS = 8000;

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

  async runTurn(request: TurnRequest): Promise<TurnResult> {
    const conversation = request.conversationId
      ? await this.store.getConversation(request.accountId, request.conversationId)
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

    await this.store.appendConversationMessages([{
      id: randomUUID(),
      conversationId: activeConversation.id,
      role: "user",
      content: request.utterance.trim().slice(0, 12000),
      createdAt: new Date(),
    }]);

    // Greetings are conversational turns, not agent tasks. Do not expose the tool catalogue
    // to the model for a simple greeting: otherwise a model can incorrectly reuse a previous
    // conversation's developer/search context and execute a tool for "Hi". This fast path is
    // also provider-independent, so a greeting never consumes AI/tool credits.
    const greeting = getSimpleGreetingResponse(request.utterance, request.locale);
    if (greeting) {
      await this.persistAssistantMessage(activeConversation.id, greeting);
      return { message: greeting, toolCalls: [], conversationId: activeConversation.id };
    }

    const snapshot = await this.entitlementPort.snapshot(request.accountId);
    const now = new Date();
    const availableSkills = this.registry
      .all()
      .filter((skill) => !skill.executesOnDevice)
      .filter((skill) => resolveEntitlement(snapshot, skill, now).allowed);

    const tools = availableSkills.map((skill) => ({
      name: skill.id,
      description: skill.description,
      inputSchema: skill.inputSchema,
    }));

    const context: SkillExecutionContext = {
      accountId: request.accountId,
      taskId: undefined,
      locale: request.locale ?? "en",
      confirmed: request.confirmed,
    };

    const results: Array<{ skillId: string; outcome: ToolExecutionOutcome }> = [];
    const executedToolRequests = new Set<string>();
    const messages: ConversationMessage[] = [
      ...persistedMessages.map((message) => ({
        role: message.role === "tool" ? "user" as const : message.role,
        content: message.role === "tool" ? "[Previous tool result] " + message.content : message.content,
      })),
      { role: "user", content: request.utterance },
    ];

    for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
      const aiResponse = await this.provider.generate({
        systemPrompt: buildSystemPrompt(request, step, results.length > 0),
        messages,
        tools,
        modelConfig: this.modelConfig,
      });

      const toolCalls = aiResponse.toolCalls ?? [];
      if (toolCalls.length === 0) {
        const message = aiResponse.message.content?.trim();
        if (message) {
          await this.persistAssistantMessage(activeConversation.id, message);
          return { message, toolCalls: results, conversationId: activeConversation.id };
        }
        const fallbackMessage = results.length > 0
          ? results.map((r) => explainOutcome(r.outcome)).join("\n")
          : "I couldn't produce a response. Please try again.";
        await this.persistAssistantMessage(activeConversation.id, fallbackMessage);
        return {
          message: fallbackMessage,
          toolCalls: results,
          conversationId: activeConversation.id,
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
        executedToolRequests.add(requestKey);

        const toolCall: ToolCall = {
          id: randomUUID(),
          skillId: call.skillId,
          input: { values: call.input },
        };
        const outcome = await this.pipeline.execute(toolCall, context);
        results.push({ skillId: call.skillId, outcome });
        executedAny = true;

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
        };
      }
    }

    // Hard safety/latency boundary. We do not claim completion merely because the loop limit
    // was reached; the user gets the authoritative results that actually happened.
    const fallback = results.length > 0
      ? results.map((r) => explainOutcome(r.outcome)).join("\n")
      : "I reached the maximum number of agent steps without completing the request.";
    await this.persistAssistantMessage(activeConversation.id, fallback);
    return { message: fallback, toolCalls: results, conversationId: activeConversation.id };
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

function buildSystemPrompt(request: TurnRequest, step: number, hasExecutedTools: boolean): string {
  let prompt =
    "You are ZARVIS, a general-purpose AI agent. Your job is to complete the user's goal, " +
    "not merely classify the request. You have access to tools and may use multiple tools " +
    "across multiple steps when the task requires it. Choose the next useful action, inspect " +
    "the real result, then either continue with another tool or give the final answer. " +
    "Never claim an action happened unless a tool result confirms it. Prefer the smallest " +
    "number of tool calls that fully completes the goal. Do not invent missing tool results.";

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
    case "confirmation_declined":
      return "This action needs your confirmation before I can proceed — please confirm and I'll go ahead.";
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

/**
 * Compact deterministic serialization used only to detect an exact duplicate tool request.
 * Tool outcomes can contain Dates or nested objects, so this intentionally handles the small
 * JSON-compatible shapes used by the domain without depending on object identity.
 */
function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stableJson(record[key])).join(",") + "}";
}