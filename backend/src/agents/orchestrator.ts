import { randomUUID } from "node:crypto";
import { resolveEntitlement } from "../domain/entitlementResolver.js";
import type { SkillExecutionContext, ToolCall, ToolExecutionOutcome } from "../domain/types.js";
import type { AIProvider, ModelConfiguration } from "../ai/provider.js";
import type { EntitlementPort } from "../tooling/ports.js";
import type { SkillRegistry } from "../tooling/skillRegistry.js";
import type { ToolPipeline } from "../tooling/toolPipeline.js";

export interface TurnRequest {
  accountId: string;
  utterance: string;
  confirmed?: boolean;
  locale?: string;
  /** Client-supplied display name (see api/routes/orchestrator.ts) — used only to let the
   * model address the user naturally; never an identity/auth claim (the account is already
   * authenticated via the bearer token, see authMiddleware.ts). */
  userName?: string;
  /** True only for the first turn of a client session — asks for a warmer, one-time
   * welcome-style reply instead of the terser tone every later turn uses. */
  isFirstTurn?: boolean;
}

export interface TurnResult {
  message: string;
  toolCalls: Array<{ skillId: string; outcome: ToolExecutionOutcome }>;
}

/**
 * The backend half of the tool-calling loop described in AI_ARCHITECTURE.md: build the
 * entitlement-filtered tool catalogue, ask the [AIProvider] to plan, run any resulting
 * tool call through the authoritative [ToolPipeline], and turn the outcome into an honest
 * user-facing message (MASTER_SPEC.md Product Principle #4, "Never fake success").
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

    const aiResponse = await this.provider.generate({
      systemPrompt: buildSystemPrompt(request),
      messages: [{ role: "user", content: request.utterance }],
      tools: availableSkills.map((skill) => ({
        name: skill.id,
        description: skill.description,
        inputSchema: skill.inputSchema,
      })),
      modelConfig: this.modelConfig,
    });

    if (aiResponse.toolCalls.length === 0) {
      return { message: aiResponse.message.content, toolCalls: [] };
    }

    const context: SkillExecutionContext = {
      accountId: request.accountId,
      taskId: undefined,
      locale: request.locale ?? "en",
      confirmed: request.confirmed,
    };

    const results: Array<{ skillId: string; outcome: ToolExecutionOutcome }> = [];
    for (const call of aiResponse.toolCalls) {
      const toolCall: ToolCall = { id: randomUUID(), skillId: call.skillId, input: { values: call.input } };
      const outcome = await this.pipeline.execute(toolCall, context);
      results.push({ skillId: call.skillId, outcome });
    }

    // Gemini frequently returns conversational text *alongside* a tool call (e.g. an
    // opening greeting, or "let me check that for you") — discarding it here would also
    // silently drop the first-turn welcome instruction above whenever the model reasonably
    // combined the greeting with actually doing the work, which is the common case, not an
    // edge case.
    const toolMessage = results.map((r) => explainOutcome(r.outcome)).join("\n");
    const message = aiResponse.message.content ? `${aiResponse.message.content}\n\n${toolMessage}` : toolMessage;
    return { message, toolCalls: results };
  }
}

/**
 * Builds the system prompt for one turn. The base instruction never changes; `userName`
 * and `isFirstTurn` add short, optional clauses only when the client actually sent them —
 * see TurnRequest's doc comments for why each exists and its trust boundary.
 */
function buildSystemPrompt(request: TurnRequest): string {
  let prompt =
    "You are ZARVIS, a universal AI digital agent. Select at most one tool that " +
    "accomplishes the user's request, or reply directly if no tool applies.";
  if (request.userName) {
    prompt +=
      ` The user's name is ${request.userName} — address them by name when it feels ` +
      "natural (e.g. an opening greeting), not in every single reply.";
  }
  if (request.isFirstTurn) {
    prompt +=
      " This is the very first message of a new conversation session: open with one " +
      "short, warm, energetic welcome/introduction as ZARVIS before addressing what they " +
      "asked — not a generic template, and never longer than a sentence or two. This " +
      "applies even when you also select a tool to fulfill the request: always include " +
      "that short greeting as your own text response alongside the tool call, never a " +
      "tool call with no accompanying text on this first turn. Every later reply in this " +
      "session should be direct and concise, without repeating the introduction.";
  }
  return prompt;
}

/** Maps every pipeline outcome to an honest, user-facing explanation — never a fake success. */
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

function explainEntitlementDenial(decision: Extract<ToolExecutionOutcome, { kind: "entitlement_denied" }>["decision"]): string {
  switch (decision.reason) {
    case "TRIAL_EXPIRED":
      return `Your trial has ended — upgrade to ${decision.upgradeTo ?? "a paid plan"} to keep using this.`;
    case "PLAN_TOO_LOW":
      return `This needs the ${decision.upgradeTo ?? "next"} plan.`;
    case "OUT_OF_CREDITS":
      return "You're out of credits for this action right now.";
  }
}
