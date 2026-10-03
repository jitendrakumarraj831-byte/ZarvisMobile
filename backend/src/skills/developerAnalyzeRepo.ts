import type { SkillDefinition } from "../domain/types.js";
import type { GitHubAccessService } from "../github/githubAccess.js";
import { GitHubApiError, parseRepoUrl } from "../github/githubClient.js";
import { SkillUserError } from "../tooling/toolPipeline.js";

/**
 * `developer.analyze_repo` — read-only structural analysis. Runs as the caller's own GitHub
 * identity when they connected one, otherwise anonymously (public repositories only). A
 * private repository is only readable by someone whose own GitHub account can read it.
 */
export function createDeveloperAnalyzeRepoSkill(github: GitHubAccessService): SkillDefinition {
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
    actionClass: "READ_ONLY",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["repoUrl"], properties: { repoUrl: "string" } },
    handler: async (input, context) => {
      const repoUrl = String(input.values.repoUrl ?? "").trim();
      try {
        parseRepoUrl(repoUrl);
      } catch (err) {
        throw new SkillUserError("invalid_repo_url", err instanceof Error ? err.message : "Please provide a GitHub repository URL.");
      }
      const { client, login } = await github.clientFor(context.accountId);
      let structure;
      try {
        structure = await client.analyzeRepository(repoUrl);
      } catch (err) {
        if (err instanceof GitHubApiError && (err.status === 404 || err.status === 401)) {
          throw new SkillUserError(
            "repo_unavailable",
            login
              ? `I couldn't open ${repoUrl} as ${login}. It may not exist, or your GitHub account can't read it.`
              : `I couldn't open ${repoUrl}. It may not exist, or it's private — connect a GitHub account that can read it in Developer settings.`,
          );
        }
        if (err instanceof GitHubApiError && err.status === 403) {
          throw new SkillUserError("github_rate_limited", "GitHub refused the request (rate limit or permission). Try again later.", true);
        }
        throw err;
      }
      return {
        kind: "success",
        output: { structure, githubLogin: login },
        summary:
          `Analyzed ${repoUrl}: primarily ${structure.primaryLanguage}, built with ${structure.buildSystem}, ` +
          `${structure.hasTests ? "has" : "has no"} tests, ${structure.hasCi ? "has" : "has no"} CI configured.`,
      };
    },
  };
}
