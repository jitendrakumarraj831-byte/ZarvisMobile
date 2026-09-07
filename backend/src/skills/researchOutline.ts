import type { SkillDefinition } from "../domain/types.js";
import type { ContentGenerator } from "../ai/contentGenerator.js";

const SYSTEM_PROMPT =
  "You plan research: given a topic or question, break it down into 4-6 concrete " +
  "sub-questions worth investigating, ordered sensibly. This is a planning artifact, not an " +
  "attempt to answer the questions. Reply with just the numbered list of sub-questions, " +
  "nothing else.";

/** `research.outline` reference skill — a planning artifact (what to investigate), distinct
 * from `research.report` (a general-knowledge overview) — see SKILLS.md "Current catalogue". */
export function createResearchOutlineSkill(generator: ContentGenerator): SkillDefinition {
  return {
    id: "research.outline",
    name: "Research Outline",
    description: "Break a topic down into sub-questions worth researching, e.g. \"outline what I'd need to research before switching careers to data science\".",
    category: "RESEARCH",
    capabilities: ["research plan", "research outline", "what should I research", "break down"],
    requiredPermissions: [],
    requiredEntitlement: "FREE",
    usageCost: { value: 1, unit: "credits" },
    riskLevel: "LOW",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["prompt"], properties: { prompt: "string" } },
    handler: async (input) => {
      const prompt = String(input.values.prompt ?? "").trim();
      if (!prompt) {
        return { kind: "failure", reason: "missing_prompt", userMessage: "What topic or question should I plan research for?" };
      }
      const outline = await generator.generate(prompt);
      return { kind: "success", output: { outline }, summary: outline };
    },
  };
}

export { SYSTEM_PROMPT as RESEARCH_OUTLINE_SYSTEM_PROMPT };
