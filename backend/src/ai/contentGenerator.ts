import { SkillUserError } from "../tooling/toolPipeline.js";
import type { Capability } from "./capabilities.js";
import { AIProviderError, providerErrorUserMessage } from "./geminiErrors.js";
import type { ModelGateway } from "./modelGateway.js";
import type { AIProvider, ModelConfiguration } from "./provider.js";

export interface ContentGenerator {
  generate(prompt: string): Promise<string>;
}

/**
 * Real generation via a configured [AIProvider] (Gemini once `GEMINI_API_KEY` is set — see
 * AI_ARCHITECTURE.md). A plain one-shot completion, not the Orchestrator's tool-calling
 * loop, so no `tools` are passed — this is content drafting, not skill selection.
 *
 * Deliberately does NOT reuse `MockAIProvider` for the zero-credential case the way the
 * Orchestrator does: that provider is shaped for *tool selection* (it returns a
 * "not sure which skill can help" message whenever no tool matches, which is exactly what
 * happens when it's asked to just generate text) — [MockContentGenerator] below is each
 * generation-based skill's own honestly-labeled placeholder instead, the same pattern
 * `docsSummarize.ts`'s `NaiveSummarizer` and `webSearch.ts`'s `MockSearchProvider` already
 * use for their own zero-credential defaults. Shared across skill categories (Business,
 * Creative, ...) rather than living under one of them — see SKILLS.md.
 */
export class AIContentGenerator implements ContentGenerator {
  /**
   * `provider` is the ModelGateway in production (any AIProvider works). `requires` names
   * capabilities beyond plain text that this skill needs, e.g. `["coding"]`: the gateway then
   * only routes the request to a model that declares them.
   */
  constructor(
    private readonly provider: AIProvider,
    private readonly modelConfig: ModelConfiguration,
    private readonly systemPrompt: string,
    private readonly requires?: Capability[],
  ) {}

  async generate(prompt: string): Promise<string> {
    try {
      const response = await this.provider.generate({
        purpose: "generation",
        systemPrompt: this.systemPrompt,
        messages: [{ role: "user", content: prompt }],
        modelConfig: this.modelConfig,
        ...(this.requires ? { requires: this.requires } : {}),
      });
      return response.message.content.trim();
    } catch (error) {
      // Report a provider failure the way web search does, so the agent loop knows WHY the skill
      // failed (an exhausted quota ends the turn; a plain handler error would not) and the user
      // gets the honest message instead of "ran into an error".
      if (error instanceof AIProviderError) throw skillErrorFor(error);
      throw error;
    }
  }
}

function skillErrorFor(error: AIProviderError): SkillUserError {
  const reason =
    error.kind === "AI_PROVIDER_QUOTA_EXCEEDED" ? "ai_quota_exceeded" : error.kind === "AI_PROVIDER_RATE_LIMIT" ? "ai_rate_limited" : "ai_provider_unavailable";
  return new SkillUserError(reason, providerErrorUserMessage(error), error.retryable);
}

/**
 * The generator every generation skill gets: the gateway when a real provider is configured, the
 * honestly-labelled development placeholder otherwise (never in production, where it fails
 * closed). Evaluated per call, so it follows the credentials actually present.
 */
export function createContentGenerator(
  gateway: ModelGateway,
  label: string,
  systemPrompt: string,
  options: { isProduction: boolean; requires?: Capability[] },
): ContentGenerator {
  const live = new AIContentGenerator(gateway, gateway.defaultModelConfig(), systemPrompt, options.requires);
  const offline: ContentGenerator = options.isProduction ? new UnavailableContentGenerator(label) : new MockContentGenerator(label);
  return { generate: (prompt) => (gateway.hasLiveProvider() ? live.generate(prompt) : offline.generate(prompt)) };
}

/** Deterministic, zero-credential default — see the class doc above for why this exists
 * instead of reusing `MockAIProvider`. */
export class MockContentGenerator implements ContentGenerator {
  constructor(private readonly label: string) {}

  async generate(prompt: string): Promise<string> {
    return `[Mock ${this.label} — no live AI provider configured, see AI_ARCHITECTURE.md] Draft based on: "${prompt}"`;
  }
}

/**
 * Production without a live AI provider: fail honestly instead of returning a placeholder as
 * a completed (and charged) result. The pipeline reports it as FAILED and charges nothing.
 */
export class UnavailableContentGenerator implements ContentGenerator {
  constructor(private readonly label: string) {}

  async generate(): Promise<string> {
    throw new SkillUserError(
      "ai_provider_unavailable",
      `ZARVIS can't write a ${this.label} right now: no AI provider is configured on this server. Nothing was generated or charged.`,
    );
  }
}
