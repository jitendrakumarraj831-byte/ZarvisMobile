import type { SkillDefinition } from "../domain/types.js";
import type { ContentGenerator } from "../ai/contentGenerator.js";

export interface Summarizer {
  summarize(text: string): Promise<string>;
}

const SYSTEM_PROMPT =
  "You write short, faithful summaries of whatever text the user shares (an article, a " +
  "document, notes). Preserve the key facts and any numbers/names; drop filler. Match the " +
  "language of the source text unless the user's own message (which may be included before " +
  "the document) asks for a different one, e.g. \"summarize this in simple Hindi\". Reply " +
  "with just the summary, nothing else.";

/**
 * No live AI provider is wired in this pass (see AI_ARCHITECTURE.md); this mock does a
 * simple extractive summary (first sentence + a length note) so the pipeline is exercised
 * for real without an external call. See [AIContentSummarizer] below for the real path.
 */
export class NaiveSummarizer implements Summarizer {
  async summarize(text: string): Promise<string> {
    const firstSentence = text.split(/(?<=[.!?])\s+/)[0]?.trim() || text.trim();
    return `${firstSentence} [mock summary of ${text.length} characters — no live summarization provider configured]`;
  }
}

/**
 * Real summarization via a configured [ContentGenerator] (Gemini once `GEMINI_API_KEY` is
 * set — see AI_ARCHITECTURE.md), following the exact same pattern every other
 * generation-based skill (Business/Creative/Research) already uses instead of a bespoke
 * mock. `skills/index.ts` wires this in by default now, so `docs.summarize` degrades to
 * `MockContentGenerator`'s own honestly-labeled placeholder (not [NaiveSummarizer]) when no
 * key is configured, same as every other content-generation skill.
 */
export class AIContentSummarizer implements Summarizer {
  constructor(private readonly generator: ContentGenerator) {}

  async summarize(text: string): Promise<string> {
    return this.generator.generate(text);
  }
}

export { SYSTEM_PROMPT as DOCS_SUMMARIZE_SYSTEM_PROMPT };

/** `docs.summarize` reference skill — see SKILLS.md "Current catalogue". */
export function createDocsSummarizeSkill(summarizer: Summarizer): SkillDefinition {
  return {
    id: "docs.summarize",
    name: "Summarize Document",
    description: "Summarize a document or block of text, e.g. \"summarize this PDF in simple Hindi\".",
    category: "DOCUMENTS",
    capabilities: ["summarize", "explain", "shorten", "tl;dr", "samjhao"],
    requiredPermissions: [],
    requiredEntitlement: "FREE",
    usageCost: { value: 1, unit: "credits" },
    riskLevel: "LOW",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["text"], properties: { text: "string" } },
    handler: async (input) => {
      const text = String(input.values.text ?? "").trim();
      if (!text) {
        return { kind: "failure", reason: "missing_text", userMessage: "Please share the text or document you want summarized." };
      }
      const summary = await summarizer.summarize(text);
      return { kind: "success", output: { summary }, summary };
    },
  };
}
