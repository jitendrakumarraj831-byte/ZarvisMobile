import type { SkillDefinition } from "../domain/types.js";
import type { ContentGenerator } from "./business/contentGenerator.js";

const SYSTEM_PROMPT =
  "You write short, engaging social media posts for small businesses. Given a business " +
  "description and what they want to promote, write one ready-to-post caption (with " +
  "relevant hashtags if appropriate). Reply with just the post text, nothing else.";

/** `business.social_post` reference skill — see SKILLS.md "Current catalogue". */
export function createBusinessSocialPostSkill(generator: ContentGenerator): SkillDefinition {
  return {
    id: "business.social_post",
    name: "Social Media Post",
    description:
      "Draft a social media post for your business, e.g. \"write today's Instagram post for my bakery's new cupcake flavor\".",
    category: "BUSINESS",
    capabilities: ["social media", "post", "caption", "instagram", "promote"],
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
        return {
          kind: "failure",
          reason: "missing_prompt",
          userMessage: "Tell me a bit about your business and what you'd like to promote.",
        };
      }
      const post = await generator.generate(prompt);
      return { kind: "success", output: { post }, summary: post };
    },
  };
}

export { SYSTEM_PROMPT as BUSINESS_SOCIAL_POST_SYSTEM_PROMPT };
