import { getProvider } from "../ai/providerFactory.js";
import { env } from "../config/env.js";
import { SkillRegistry } from "../tooling/skillRegistry.js";
import { MockGitHubClient } from "../github/githubClient.js";
import { AIContentGenerator, MockContentGenerator, type ContentGenerator } from "./business/contentGenerator.js";
import { BUSINESS_CUSTOMER_REPLY_SYSTEM_PROMPT, createBusinessCustomerReplySkill } from "./businessCustomerReply.js";
import { createBusinessDraftInvoiceSkill } from "./businessDraftInvoice.js";
import { BUSINESS_SOCIAL_POST_SYSTEM_PROMPT, createBusinessSocialPostSkill } from "./businessSocialPost.js";
import { createDeveloperAnalyzeRepoSkill } from "./developerAnalyzeRepo.js";
import { createDocsSummarizeSkill, NaiveSummarizer } from "./docsSummarize.js";
import { createWebSearchSkill, MockSearchProvider } from "./webSearch.js";

/**
 * Real generation via the configured provider (Gemini once `GEMINI_API_KEY` is set) when
 * available, an honestly-labeled deterministic mock otherwise — see
 * `business/contentGenerator.ts` for why this doesn't reuse `MockAIProvider`.
 */
function businessContentGenerator(label: string, systemPrompt: string): ContentGenerator {
  if (!env.geminiApiKey) return new MockContentGenerator(label);
  const modelConfig = { provider: "google", model: env.geminiModel };
  return new AIContentGenerator(getProvider(modelConfig), modelConfig, systemPrompt);
}

/**
 * Registers every backend-executed skill. See SKILLS.md "Current catalogue" — Research,
 * Creative, and Automation are intentionally not registered here yet (foundation-only in
 * this pass, MASTER_SPEC.md §29); adding one is exactly this pattern: write the
 * SkillDefinition, register it here, never touch the Orchestrator.
 */
export function buildSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  registry.register(createWebSearchSkill(new MockSearchProvider()));
  registry.register(createDocsSummarizeSkill(new NaiveSummarizer()));
  registry.register(createDeveloperAnalyzeRepoSkill(new MockGitHubClient()));
  registry.register(
    createBusinessSocialPostSkill(businessContentGenerator("social media post", BUSINESS_SOCIAL_POST_SYSTEM_PROMPT)),
  );
  registry.register(
    createBusinessCustomerReplySkill(businessContentGenerator("customer reply", BUSINESS_CUSTOMER_REPLY_SYSTEM_PROMPT)),
  );
  registry.register(createBusinessDraftInvoiceSkill());
  return registry;
}
