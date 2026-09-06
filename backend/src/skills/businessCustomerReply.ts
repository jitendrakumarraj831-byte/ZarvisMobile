import type { SkillDefinition } from "../domain/types.js";
import type { ContentGenerator } from "./business/contentGenerator.js";

const SYSTEM_PROMPT =
  "You draft polite, professional replies to customer messages for a small business owner. " +
  "Given the customer's message, write one ready-to-send reply that addresses their concern " +
  "and keeps a friendly, professional tone. Reply with just the message text, nothing else. " +
  "This is a draft for the business owner to review before sending — never claim to have " +
  "already sent anything.";

/** `business.customer_reply` reference skill — see SKILLS.md "Current catalogue". */
export function createBusinessCustomerReplySkill(generator: ContentGenerator): SkillDefinition {
  return {
    id: "business.customer_reply",
    name: "Customer Reply",
    description:
      "Draft a reply to a customer message or review, e.g. \"draft a reply to this customer complaint about a late delivery\".",
    category: "BUSINESS",
    capabilities: ["customer", "reply", "respond", "complaint", "review"],
    requiredPermissions: [],
    requiredEntitlement: "FREE",
    usageCost: { value: 1, unit: "credits" },
    riskLevel: "LOW",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["customerMessage"], properties: { customerMessage: "string" } },
    handler: async (input) => {
      const customerMessage = String(input.values.customerMessage ?? "").trim();
      if (!customerMessage) {
        return {
          kind: "failure",
          reason: "missing_customer_message",
          userMessage: "What did the customer say? Share their message and I'll draft a reply.",
        };
      }
      const reply = await generator.generate(customerMessage);
      return { kind: "success", output: { reply }, summary: reply };
    },
  };
}

export { SYSTEM_PROMPT as BUSINESS_CUSTOMER_REPLY_SYSTEM_PROMPT };
