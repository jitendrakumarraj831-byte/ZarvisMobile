import { defaultModelConfig, getProvider } from "../ai/providerFactory.js";
import { env } from "../config/env.js";
import type { Store } from "../store/store.js";
import { TaskService } from "../tasks/taskService.js";
import { SkillRegistry } from "../tooling/skillRegistry.js";
import type { GitHubAccessService } from "../github/githubAccess.js";
import { AIContentGenerator, MockContentGenerator, UnavailableContentGenerator, type ContentGenerator } from "../ai/contentGenerator.js";
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
import { createDeveloperImplementSkill, DEVELOPER_IMPLEMENT_SYSTEM_PROMPT } from "./developerImplement.js";
import { AIContentSummarizer, createDocsSummarizeSkill, DOCS_SUMMARIZE_SYSTEM_PROMPT } from "./docsSummarize.js";
import { RESEARCH_COMPARE_SYSTEM_PROMPT, createResearchCompareSkill } from "./researchCompare.js";
import { RESEARCH_OUTLINE_SYSTEM_PROMPT, createResearchOutlineSkill } from "./researchOutline.js";
import { RESEARCH_REPORT_SYSTEM_PROMPT, createResearchReportSkill } from "./researchReport.js";
import { createWebSearchSkill, FallbackSearchProvider, GeminiSearchProvider, MockSearchProvider, OpenRouterSearchProvider, UnavailableSearchProvider, type SearchProvider } from "./webSearch.js";

/**
 * Real generation via the configured provider (Gemini once `GEMINI_API_KEY` is set) when
 * available, an honestly-labeled deterministic mock otherwise — see
 * `ai/contentGenerator.ts` for why this doesn't reuse `MockAIProvider`. Shared by every
 * generation-based skill regardless of category (Business, Creative, Research, ...), each
 * with its own [label]/[systemPrompt].
 */
function contentGenerator(label: string, systemPrompt: string): ContentGenerator {
  // Placeholders are for local development and tests only; production fails closed.
  if (!env.geminiApiKey && !env.openRouterApiKey) return env.isProduction ? new UnavailableContentGenerator(label) : new MockContentGenerator(label);
  const modelConfig = { ...defaultModelConfig };
  return new AIContentGenerator(getProvider(modelConfig), modelConfig, systemPrompt);
}

/** Gemini grounding first; OpenRouter's web search as fallback (or alone when Gemini isn't configured). */
function searchProvider(): SearchProvider {
  const openRouter = env.openRouterApiKey ? new OpenRouterSearchProvider(env.openRouterApiKey, env.openRouterModel) : undefined;
  if (env.geminiApiKey) {
    const gemini = new GeminiSearchProvider(env.geminiApiKey, env.geminiModel);
    return openRouter ? new FallbackSearchProvider(gemini, openRouter) : gemini;
  }
  if (openRouter) return openRouter;
  return env.isProduction ? new UnavailableSearchProvider() : new MockSearchProvider();
}

/**
 * Registers every backend-executed skill. See SKILLS.md "Current catalogue" for the full
 * status of each. Adding one is always this same pattern: write the SkillDefinition,
 * register it here, never touch the Orchestrator.
 */
export function buildSkillRegistry(store: Store, githubAccess: GitHubAccessService): SkillRegistry {
  const registry = new SkillRegistry();
  const taskService = new TaskService(store);

  registry.register(
    createWebSearchSkill(
      searchProvider(),
    ),
  );
  registry.register(
    createDocsSummarizeSkill(new AIContentSummarizer(contentGenerator("document summary", DOCS_SUMMARIZE_SYSTEM_PROMPT))),
  );
  registry.register(createDeveloperAnalyzeRepoSkill(githubAccess));
  registry.register(createDeveloperImplementSkill(githubAccess, contentGenerator("developer implementation", DEVELOPER_IMPLEMENT_SYSTEM_PROMPT)));
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
  registry.register(createResearchCompareSkill(contentGenerator("comparison", RESEARCH_COMPARE_SYSTEM_PROMPT)));
  registry.register(createResearchReportSkill(contentGenerator("research report", RESEARCH_REPORT_SYSTEM_PROMPT)));
  registry.register(createResearchOutlineSkill(contentGenerator("research outline", RESEARCH_OUTLINE_SYSTEM_PROMPT)));
  return registry;
}
