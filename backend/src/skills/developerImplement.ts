import type { SkillDefinition } from "../domain/types.js";
import type { ContentGenerator } from "../ai/contentGenerator.js";
import type { GitHubAccessService } from "../github/githubAccess.js";
import { GitHubApiError, parseRepoUrl } from "../github/githubClient.js";
import { SkillUserError } from "../tooling/toolPipeline.js";

export const DEVELOPER_IMPLEMENT_SYSTEM_PROMPT = `
You are ZARVIS Developer Agent. Analyze the supplied repository context and user requirement.
Return ONLY valid JSON, with this exact shape:
{
  "summary": "short implementation summary",
  "steps": ["ordered step", "..."],
  "files": [{"path":"repo-relative/path","content":"complete UTF-8 file content"}],
  "tests": ["specific test command or verification"]
}
Rules:
- Only return complete text files you can safely derive from the supplied context.
- Never include secrets, tokens, credentials, binaries, lockfile rewrites, node_modules, dist, build, or generated assets.
- Prefer small, targeted changes. Maximum 6 files and 60000 total output characters.
- Preserve existing conventions.
- If the context is insufficient for a safe implementation, return files: [] and explain why in summary.
`;

/**
 * `developer.implement` — writes a branch and opens a pull request. Authorization:
 * 1. the user must have connected their own GitHub account (no shared server token), and
 * 2. GitHub must report that identity has push access to the repository, and
 * 3. the ToolPipeline requires a server-issued confirmation for this exact repo + requirement.
 * It never merges.
 */
export function createDeveloperImplementSkill(github: GitHubAccessService, generator: ContentGenerator): SkillDefinition {
  return {
    id: "developer.implement",
    name: "Implement Repository Change",
    description: "Analyze a GitHub repository, generate a bounded code change, commit it to a new branch, and open a pull request.",
    category: "DEVELOPER",
    capabilities: ["implement", "code", "fix project", "developer agent", "github coding"],
    requiredPermissions: [],
    requiredEntitlement: "PRO",
    usageCost: { value: 10, unit: "credits" },
    riskLevel: "HIGH",
    actionClass: "EXTERNAL_COMMUNICATION",
    requiresConfirmation: true,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["repoUrl", "requirement"], properties: { repoUrl: "string", requirement: "string" } },
    describeAction: (input) =>
      `Using your connected GitHub account, create a new branch in ${String(input.values.repoUrl ?? "").trim()}, ` +
      `commit AI-generated changes (at most 6 text files) for: "${String(input.values.requirement ?? "").trim()}", ` +
      `and open a pull request for your review. Nothing is merged.`,
    handler: async (input, context) => {
      const repoUrl = String(input.values.repoUrl ?? "").trim();
      const requirement = String(input.values.requirement ?? "").trim();
      try {
        parseRepoUrl(repoUrl);
      } catch (err) {
        throw new SkillUserError("invalid_repo_url", err instanceof Error ? err.message : "Please provide a GitHub repository URL.");
      }
      const { client, login } = await github.clientFor(context.accountId);
      if (!login) {
        throw new SkillUserError(
          "github_not_connected",
          "Connect your own GitHub account in Developer settings first. ZARVIS only writes to repositories your GitHub account can push to.",
        );
      }
      let access;
      try {
        access = await client.getRepoAccess(repoUrl);
      } catch (err) {
        if (err instanceof GitHubApiError && (err.status === 404 || err.status === 401 || err.status === 403)) {
          throw new SkillUserError("repo_unavailable", `${login} can't access ${repoUrl}. No changes were made.`);
        }
        throw err;
      }
      if (!access.canPush) {
        throw new SkillUserError(
          "not_authorized",
          `GitHub reports that ${login} does not have write access to ${access.fullName}. No changes were made.`,
        );
      }

      const repoContext = await client.getImplementationContext(repoUrl);
      const raw = await generator.generate(JSON.stringify({ requirement, repository: repoContext }, null, 2));
      let plan: { summary: string; steps: string[]; files: Array<{ path: string; content: string }>; tests: string[] };
      try {
        const cleaned = raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
        plan = JSON.parse(cleaned);
      } catch {
        return { kind: "failure", reason: "invalid_agent_output", userMessage: "The coding agent returned an invalid change plan. No repository changes were made." };
      }
      const files = Array.isArray(plan.files) ? plan.files.filter((f) =>
        f && typeof f.path === "string" && typeof f.content === "string" &&
        f.path.length > 0 && f.path.length < 220 &&
        !f.path.startsWith("/") && !f.path.includes("..") &&
        !/(^|\/)(node_modules|dist|build|\.git|\.github|coverage)(\/|$)/i.test(f.path) &&
        !/\.(png|jpe?g|gif|webp|zip|apk|aab|pdf)$/i.test(f.path)
      ).slice(0, 6) : [];
      const total = files.reduce((n, f) => n + Buffer.byteLength(f.content, "utf8"), 0);
      if (!files.length) return { kind: "failure", reason: "no_safe_changes", userMessage: plan.summary || "No safe code changes could be generated from the available repository context." };
      if (total > 60000) return { kind: "failure", reason: "change_too_large", userMessage: "Generated changes exceed the safety size limit; no repository changes were made." };
      const branch = `zarvis/agent-${Date.now()}`;
      await client.createImplementationBranch(repoUrl, branch);
      await client.applyImplementationFiles(repoUrl, branch, files, `feat(agent): ${requirement.slice(0, 72)}`);
      const body = [
        "## ZARVIS Developer Agent",
        "",
        plan.summary,
        "",
        "### Steps",
        ...(plan.steps || []).map((s) => `- ${s}`),
        "",
        "### Suggested verification (not run by ZARVIS)",
        ...(plan.tests || []).map((s) => `- ${s}`),
        "",
        `Changes were committed to **${branch}** by ${login} via ZARVIS for human review. ZARVIS does not merge this PR and has not run these tests.`,
      ].join("\n");
      const pr = await client.createPullRequest(repoUrl, branch, `ZARVIS Agent: ${requirement.slice(0, 72)}`, body);
      return {
        kind: "success",
        output: { branch, pullRequest: pr, files: files.map((f) => f.path), suggestedTests: plan.tests || [] },
        summary: `Committed ${files.length} file change(s) to ${branch} and opened PR #${pr.number} (${pr.url}). Tests were not run; human review is required before merge.`,
      };
    },
  };
}
