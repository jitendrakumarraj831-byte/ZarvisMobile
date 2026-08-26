import type { SkillDefinition } from "../domain/types.js";

export interface Summarizer {
  summarize(text: string): Promise<string>;
}

/**
 * No live AI provider is wired in this pass (see AI_ARCHITECTURE.md); this mock does a
 * simple extractive summary (first sentence + a length note) so the pipeline is exercised
 * for real without an external call. A real summarizer would call [AIProvider] instead —
 * see AI_ARCHITECTURE.md's tool-calling loop.
 */
export class NaiveSummarizer implements Summarizer {
  async summarize(text: string): Promise<string> {
    const firstSentence = text.split(/(?<=[.!?])\s+/)[0]?.trim() || text.trim();
    return `${firstSentence} [mock summary of ${text.length} characters — no live summarization provider configured]`;
  }
}

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
