import { getProvider } from "../ai/providerFactory.js";
import { env } from "../config/env.js";
import type { Store } from "../store/store.js";
import { TaskService } from "../tasks/taskService.js";
import { SkillRegistry } from "../tooling/skillRegistry.js";
import { MockGitHubClient } from "../github/githubClient.js";
import { AIContentGenerator, MockContentGenerator, type ContentGenerator } from "../ai/contentGenerator.js";
import { createAutomationCancelWorkflowSkill } from "./automationCancelWorkflow.js";
import { createAutomationCreateWorkflowSkill } from "./automationCreateWorkflow.js";
import { createAutomationListWorkflowsSkill } from "./automationListWorkflows.js";
import { BUSINESS_CUSTOMER_REPLY_SYSTEM_PROMPT, createBusinessCustomerReplySkill } from "./businessCustomerReply.js";
import { createBusinessDraftInvoiceSkill } from "./businessDraftInvoice.js";
import { BUSINESS_SOCIAL_POST_SYSTEM_PROMPT, createBusinessSocialPostSkill } from "./businessSocialPost.js";
import { CREATIVE_BRAINSTORM_SYSTEM_PROMPT, createCreativeBrainstormSkill } from "./creativeBrainstorm.js";
import { CREATIVE_WRITE_MESSAGE_SYSTEM_PROMPT, createCreativeWriteMessageSkill } from "./creativeWriteMessage.js";
import { CREATIVE_WRITE_POEM_SYSTEM_PROMPT, createCreativeWritePoemSkill } from "./creativeWritePoem.js";
import { createDeveloperAnalyzeRepoSkill } from "./developerAnalyzeRepo.js";
import { createDocsSummarizeSkill, NaiveSummarizer } from "./docsSummarize.js";
import { createWebSearchSkill, MockSearchProvider } from "./webSearch.js";

/**
 * Real generation via the configured provider (Gemini once `GEMINI_API_KEY` is set) when
 * available, an honestly-labeled deterministic mock otherwise — see
 * `ai/contentGenerator.ts` for why this doesn't reuse `MockAIProvider`. Shared by every
 * generation-based skill regardless of category (Business, Creative, ...), each with its
 * own [label]/[systemPrompt].
 */
function contentGenerator(label: string, systemPrompt: string): ContentGenerator {
  if (!env.geminiApiKey) return new MockContentGenerator(label);
  const modelConfig = { provider: "google", model: env.geminiModel };
  return new AIContentGenerator(getProvider(modelConfig), modelConfig, systemPrompt);
}

/**
 * Registers every backend-executed skill. See SKILLS.md "Current catalogue" — Research is
 * intentionally not registered here yet (foundation-only in this pass, MASTER_SPEC.md §29);
 * adding one is exactly this pattern: write the SkillDefinition, register it here, never
 * touch the Orchestrator.
 */
export function buildSkillRegistry(store: Store): SkillRegistry {
  const registry = new SkillRegistry();
  const taskService = new TaskService(store);

  registry.register(createWebSearchSkill(new MockSearchProvider()));
  registry.register(createDocsSummarizeSkill(new NaiveSummarizer()));
  registry.register(createDeveloperAnalyzeRepoSkill(new MockGitHubClient()));
  registry.register(
    createBusinessSocialPostSkill(contentGenerator("social media post", BUSINESS_SOCIAL_POST_SYSTEM_PROMPT)),
  );
  registry.register(
    createBusinessCustomerReplySkill(contentGenerator("customer reply", BUSINESS_CUSTOMER_REPLY_SYSTEM_PROMPT)),
  );
  registry.register(createBusinessDraftInvoiceSkill());
  registry.register(createCreativeWriteMessageSkill(contentGenerator("message", CREATIVE_WRITE_MESSAGE_SYSTEM_PROMPT)));
  registry.register(createCreativeWritePoemSkill(contentGenerator("poem", CREATIVE_WRITE_POEM_SYSTEM_PROMPT)));
  registry.register(createCreativeBrainstormSkill(contentGenerator("brainstorm", CREATIVE_BRAINSTORM_SYSTEM_PROMPT)));
  registry.register(createAutomationCreateWorkflowSkill(taskService));
  registry.register(createAutomationListWorkflowsSkill(taskService));
  registry.register(createAutomationCancelWorkflowSkill(taskService));
  return registry;
}
