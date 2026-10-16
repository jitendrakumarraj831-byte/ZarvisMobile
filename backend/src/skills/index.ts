import { getModelGateway } from "../ai/providerFactory.js";
import type { ModelGateway } from "../ai/modelGateway.js";
import type { Capability } from "../ai/capabilities.js";
import { resolveOpenRouterBaseUrl } from "../config/aiConfig.js";
import { env } from "../config/env.js";
import type { Store } from "../store/store.js";
import { TaskService } from "../tasks/taskService.js";
import { SkillRegistry } from "../tooling/skillRegistry.js";
import type { GitHubAccessService } from "../github/githubAccess.js";
import { createContentGenerator, type ContentGenerator } from "../ai/contentGenerator.js";
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
 * Real generation through the AI Model Gateway when a provider is configured, an honestly-labeled
 * deterministic mock otherwise (never in production) — see `ai/contentGenerator.ts` for why this
 * doesn't reuse `MockAIProvider`. Shared by every generation-based skill regardless of category
 * (Business, Creative, Research, ...), each with its own [label]/[systemPrompt]. `requires` names
 * capabilities the skill needs beyond text, e.g. repository changes need a `coding` model.
 */
function contentGenerator(gateway: ModelGateway, label: string, systemPrompt: string, requires?: Capability[]): ContentGenerator {
  return createContentGenerator(gateway, label, systemPrompt, { isProduction: env.isProduction, requires });
}

export interface SearchProviderSettings {
  geminiApiKey?: string;
  geminiModel: string;
  openRouterApiKey?: string;
  openRouterModel?: string;
  /** Raw `OPENROUTER_BASE_URL` / `OPENROUTER_DATA_COLLECTION`: search follows the same address and data policy as chat. */
  openRouterBaseUrl?: string;
  openRouterDataCollection?: string;
  /** Raw `AI_FALLBACK_PROVIDER`: a chain that leaves OpenRouter out (or `none`) means a query must not go to OpenRouter. */
  aiFallbackProvider?: string;
  /** Raw `AI_PRIMARY_PROVIDER`: OpenRouter as the primary is always allowed. */
  aiPrimaryProvider?: string;
  isProduction: boolean;
}

/** Whether the gateway settings let a user's text go to OpenRouter while Gemini is configured. */
function openRouterAllowed(settings: Pick<SearchProviderSettings, "aiFallbackProvider" | "aiPrimaryProvider">): boolean {
  if (settings.aiPrimaryProvider?.trim().toLowerCase() === "openrouter") return true;
  const chain = settings.aiFallbackProvider?.trim().toLowerCase();
  if (!chain) return true; // the default chain includes OpenRouter
  return chain.split(/[\s,]+/).includes("openrouter");
}

/**
 * Gemini grounding first; OpenRouter's web search as fallback, or alone when Gemini isn't configured.
 * Search is not routed through the gateway (only Gemini's grounding returns real sources), so it honours
 * the one gateway switch that is about where a user's text may go: when `AI_FALLBACK_PROVIDER` leaves
 * OpenRouter out (`none`, or a chain such as `openai`), a search query is never sent to OpenRouter while
 * Gemini is configured.
 */
export function searchProvider(settings: SearchProviderSettings = env): SearchProvider {
  const dataCollection = settings.openRouterDataCollection?.trim().toLowerCase();
  const openRouter = settings.openRouterApiKey
    ? new OpenRouterSearchProvider(settings.openRouterApiKey, settings.openRouterModel?.trim() || undefined, {
        baseUrl: settings.openRouterBaseUrl?.trim() ? resolveOpenRouterBaseUrl(settings.openRouterBaseUrl) : undefined,
        ...(dataCollection === "allow" || dataCollection === "deny" ? { dataCollection } : {}),
      })
    : undefined;
  if (settings.geminiApiKey) {
    const gemini = new GeminiSearchProvider(settings.geminiApiKey, settings.geminiModel);
    return openRouter && openRouterAllowed(settings) ? new FallbackSearchProvider(gemini, openRouter) : gemini;
  }
  if (openRouter) return openRouter;
  return settings.isProduction ? new UnavailableSearchProvider() : new MockSearchProvider();
}

/**
 * Registers every backend-executed skill. See SKILLS.md "Current catalogue" for the full
 * status of each. Adding one is always this same pattern: write the SkillDefinition,
 * register it here, never touch the Orchestrator.
 */
export function buildSkillRegistry(
  store: Store,
  githubAccess: GitHubAccessService,
  gateway: ModelGateway = getModelGateway(),
  taskService: TaskService = new TaskService(store),
): SkillRegistry {
  const registry = new SkillRegistry();

  registry.register(
    createWebSearchSkill(
      searchProvider(),
    ),
  );
  registry.register(
    createDocsSummarizeSkill(new AIContentSummarizer(contentGenerator(gateway, "document summary", DOCS_SUMMARIZE_SYSTEM_PROMPT))),
  );
  registry.register(createDeveloperAnalyzeRepoSkill(githubAccess));
  registry.register(createDeveloperImplementSkill(githubAccess, contentGenerator(gateway, "developer implementation", DEVELOPER_IMPLEMENT_SYSTEM_PROMPT, ["coding"])));
  registry.register(
    createBusinessSocialPostSkill(contentGenerator(gateway, "social media post", BUSINESS_SOCIAL_POST_SYSTEM_PROMPT)),
  );
  registry.register(
    createBusinessCustomerReplySkill(contentGenerator(gateway, "customer reply", BUSINESS_CUSTOMER_REPLY_SYSTEM_PROMPT)),
  );
  registry.register(createBusinessDraftInvoiceSkill());
  registry.register(createCreativeWriteMessageSkill(contentGenerator(gateway, "message", CREATIVE_WRITE_MESSAGE_SYSTEM_PROMPT)));
  registry.register(createCreativeWritePoemSkill(contentGenerator(gateway, "poem", CREATIVE_WRITE_POEM_SYSTEM_PROMPT)));
  registry.register(createCreativeBrainstormSkill(contentGenerator(gateway, "brainstorm", CREATIVE_BRAINSTORM_SYSTEM_PROMPT)));
  registry.register(createAutomationCreateWorkflowSkill(taskService));
  registry.register(createAutomationListWorkflowsSkill(taskService));
  registry.register(createAutomationCancelWorkflowSkill(taskService));
  registry.register(createResearchCompareSkill(contentGenerator(gateway, "comparison", RESEARCH_COMPARE_SYSTEM_PROMPT)));
  registry.register(createResearchReportSkill(contentGenerator(gateway, "research report", RESEARCH_REPORT_SYSTEM_PROMPT)));
  registry.register(createResearchOutlineSkill(contentGenerator(gateway, "research outline", RESEARCH_OUTLINE_SYSTEM_PROMPT)));
  return registry;
}
