import type { SkillDefinition } from "../domain/types.js";
import type { ContentGenerator } from "../ai/contentGenerator.js";

const SYSTEM_PROMPT =
  "You compare multiple options (products, services, approaches) against relevant criteria. " +
  "Given a request naming what to compare, reply with a short structured comparison (a " +
  "compact table or bullet list). Since you have no live web search or pricing data, base " +
  "the comparison on general knowledge only, and explicitly say so in one closing line " +
  "recommending the user verify current specifics (price, availability) with a live search " +
  "before deciding. Never present this as sourced or current data. Reply with just the " +
  "comparison and that closing line, nothing else.";

/** `research.compare` reference skill — distinct from `web.search` (fetches live results) —
 * see SKILLS.md "Current catalogue". */
export function createResearchCompareSkill(generator: ContentGenerator): SkillDefinition {
  return {
    id: "research.compare",
    name: "Compare Options",
    description: "Compare multiple options against criteria, e.g. \"compare iPhone 15 and Galaxy S24 on price, camera, and battery\".",
    category: "RESEARCH",
    capabilities: ["compare options", "vs", "which is better", "pros and cons"],
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
        return { kind: "failure", reason: "missing_prompt", userMessage: "What would you like me to compare, and on what criteria?" };
      }
      const comparison = await generator.generate(prompt);
      return { kind: "success", output: { comparison }, summary: comparison };
    },
  };
}

export { SYSTEM_PROMPT as RESEARCH_COMPARE_SYSTEM_PROMPT };
