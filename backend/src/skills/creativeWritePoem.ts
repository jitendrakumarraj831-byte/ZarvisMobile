import type { SkillDefinition } from "../domain/types.js";
import type { ContentGenerator } from "../ai/contentGenerator.js";

const SYSTEM_PROMPT =
  "You write short, original poems (a few stanzas at most) on a given theme or subject, in " +
  "whatever language or mix of languages (English, Hindi, Hinglish) the request itself is " +
  "written in. Reply with just the poem text, nothing else.";

/** `creative.write_poem` reference skill — see SKILLS.md "Current catalogue". */
export function createCreativeWritePoemSkill(generator: ContentGenerator): SkillDefinition {
  return {
    id: "creative.write_poem",
    name: "Write Poem",
    description: "Write a short poem on a theme, e.g. \"write a poem about the monsoon\".",
    category: "CREATIVE",
    capabilities: ["poem", "poetry", "verse", "shayari", "kavita"],
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
        return { kind: "failure", reason: "missing_prompt", userMessage: "What should the poem be about?" };
      }
      const poem = await generator.generate(prompt);
      return { kind: "success", output: { poem }, summary: poem };
    },
  };
}

export { SYSTEM_PROMPT as CREATIVE_WRITE_POEM_SYSTEM_PROMPT };
