import type { SkillDefinition } from "../domain/types.js";
import type { ContentGenerator } from "../ai/contentGenerator.js";

const SYSTEM_PROMPT =
  "You brainstorm creative ideas on request — names, themes, gift ideas, party concepts, " +
  "captions, anything open-ended. Given the topic, reply with a numbered list of 5-8 " +
  "distinct, genuinely varied ideas. Reply with just the list, nothing else.";

/** `creative.brainstorm` reference skill — see SKILLS.md "Current catalogue". */
export function createCreativeBrainstormSkill(generator: ContentGenerator): SkillDefinition {
  return {
    id: "creative.brainstorm",
    name: "Brainstorm Ideas",
    description: "Brainstorm ideas for something, e.g. \"brainstorm names for my new puppy\".",
    category: "CREATIVE",
    capabilities: ["brainstorm", "ideas", "suggest", "names for", "theme ideas"],
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
        return { kind: "failure", reason: "missing_prompt", userMessage: "What would you like ideas for?" };
      }
      const ideas = await generator.generate(prompt);
      return { kind: "success", output: { ideas }, summary: ideas };
    },
  };
}

export { SYSTEM_PROMPT as CREATIVE_BRAINSTORM_SYSTEM_PROMPT };
