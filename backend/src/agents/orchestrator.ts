import { randomUUID } from "node:crypto";
import { resolveEntitlement } from "../domain/entitlementResolver.js";
import type { SkillExecutionContext, ToolCall, ToolExecutionOutcome } from "../domain/types.js";
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
  /** Recent user/assistant turns supplied by the client and capped by the API route. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface TurnResult {
  message: string;
  toolCalls: Array<{ skillId: string; outcome: ToolExecutionOutcome }>;
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
  ) {}

  async runTurn(request: TurnRequest): Promise<TurnResult> {
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
    const messages: ConversationMessage[] = [
      ...(request.history ?? []),
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
        if (message) return { message, toolCalls: results };
        return {
          message: results.length > 0
            ? results.map((r) => explainOutcome(r.outcome)).join("\n")
            : "I couldn't produce a response. Please try again.",
          toolCalls: results,
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
        const duplicate = results.some(
          (previous) =>
            previous.skillId === call.skillId &&
            stableJson(previous.outcome) === stableJson(call.input),
        );
        if (duplicate) continue;

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
        return {
          message: results.length > 0
            ? results.map((r) => explainOutcome(r.outcome)).join("\n")
            : "I couldn't determine the next action. Please try again.",
          toolCalls: results,
        };
      }
    }

    // Hard safety/latency boundary. We do not claim completion merely because the loop limit
    // was reached; the user gets the authoritative results that actually happened.
    const fallback = results.length > 0
      ? results.map((r) => explainOutcome(r.outcome)).join("\n")
      : "I reached the maximum number of agent steps without completing the request.";
    return { message: fallback, toolCalls: results };
  }
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
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stableJson(record[key])).join(",") + "}";
}
