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
  constructor(
    private readonly provider: AIProvider,
    private readonly modelConfig: ModelConfiguration,
    private readonly systemPrompt: string,
  ) {}

  async generate(prompt: string): Promise<string> {
    const response = await this.provider.generate({
      systemPrompt: this.systemPrompt,
      messages: [{ role: "user", content: prompt }],
      modelConfig: this.modelConfig,
    });
    return response.message.content.trim();
  }
}

/** Deterministic, zero-credential default — see the class doc above for why this exists
 * instead of reusing `MockAIProvider`. */
export class MockContentGenerator implements ContentGenerator {
  constructor(private readonly label: string) {}

  async generate(prompt: string): Promise<string> {
    return `[Mock ${this.label} — no live AI provider configured, see AI_ARCHITECTURE.md] Draft based on: "${prompt}"`;
  }
}
