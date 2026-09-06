import type { SkillDefinition } from "../domain/types.js";
import type { ContentGenerator } from "../ai/contentGenerator.js";

const SYSTEM_PROMPT =
  "You write short, warm, occasion-appropriate messages for people to send (birthday, " +
  "anniversary, congratulations, thank-you, condolence, apology, etc.). Given a description " +
  "of the occasion and recipient, write one ready-to-send message. Reply with just the " +
  "message text, nothing else.";

/** `creative.write_message` reference skill — see SKILLS.md "Current catalogue" and
 * MASTER_SPEC.md §1's own example: "मेरे लिए एक अच्छा birthday message तैयार करो।" */
export function createCreativeWriteMessageSkill(generator: ContentGenerator): SkillDefinition {
  return {
    id: "creative.write_message",
    name: "Write Message",
    description:
      "Write a message for an occasion, e.g. \"write a warm birthday message for my mom who loves gardening\".",
    category: "CREATIVE",
    capabilities: ["message", "birthday", "anniversary", "congratulations", "thank you", "condolence", "apology", "greeting"],
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
          userMessage: "What's the occasion, and who's it for?",
        };
      }
      const message = await generator.generate(prompt);
      return { kind: "success", output: { message }, summary: message };
    },
  };
}

export { SYSTEM_PROMPT as CREATIVE_WRITE_MESSAGE_SYSTEM_PROMPT };
