import { SkillRegistry } from "../tooling/skillRegistry.js";
import { MockGitHubClient } from "../github/githubClient.js";
import { createDeveloperAnalyzeRepoSkill } from "./developerAnalyzeRepo.js";
import { createDocsSummarizeSkill, NaiveSummarizer } from "./docsSummarize.js";
import { createWebSearchSkill, MockSearchProvider } from "./webSearch.js";

/**
 * Registers every backend-executed skill. See SKILLS.md "Current catalogue" — Phone,
 * Business, Research, Creative, and Automation are intentionally not registered here yet
 * (foundation-only in this pass, MASTER_SPEC.md §29); adding one is exactly this pattern:
 * write the SkillDefinition, register it here, never touch the Orchestrator.
 */
export function buildSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  registry.register(createWebSearchSkill(new MockSearchProvider()));
  registry.register(createDocsSummarizeSkill(new NaiveSummarizer()));
  registry.register(createDeveloperAnalyzeRepoSkill(new MockGitHubClient()));
  return registry;
}
