import type { SkillDefinition } from "../domain/types.js";
import type { GitHubClient } from "../github/githubClient.js";

/**
 * `developer.analyze_repo` reference skill — the Repository Agent's read-only structural
 * analysis. See DEVELOPER_AGENT.md: read-only analysis is always LOW risk and requires no
 * confirmation; only later stages (Coding/Testing/Deployment agents, not implemented in
 * this pass — see MASTER_SPEC.md §29) touch the repository.
 */
export function createDeveloperAnalyzeRepoSkill(client: GitHubClient): SkillDefinition {
  return {
    id: "developer.analyze_repo",
    name: "Analyze Repository",
    description: "Read-only structural analysis of a GitHub repository, e.g. \"check my GitHub project for errors\".",
    category: "DEVELOPER",
    capabilities: ["analyze", "check my project", "github", "repository", "repo"],
    requiredPermissions: [],
    requiredEntitlement: "FREE",
    usageCost: { value: 3, unit: "credits" },
    riskLevel: "LOW",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["repoUrl"], properties: { repoUrl: "string" } },
    handler: async (input) => {
      const repoUrl = String(input.values.repoUrl ?? "").trim();
      if (!repoUrl) {
        return { kind: "failure", reason: "missing_repo_url", userMessage: "Which repository should I analyze?" };
      }
      const structure = await client.analyzeRepository(repoUrl);
      return {
        kind: "success",
        output: { structure },
        summary:
          `Analyzed ${repoUrl}: primarily ${structure.primaryLanguage}, built with ${structure.buildSystem}, ` +
          `${structure.hasTests ? "has" : "has no"} tests, ${structure.hasCi ? "has" : "has no"} CI configured.`,
      };
    },
  };
}
