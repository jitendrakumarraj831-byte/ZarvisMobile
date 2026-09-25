import type { SkillDefinition } from "../domain/types.js";
import type { GitHubClient } from "../github/githubClient.js";
import type { ContentGenerator } from "../ai/contentGenerator.js";

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

export function createDeveloperImplementSkill(client: GitHubClient, generator: ContentGenerator): SkillDefinition {
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
    requiresConfirmation: true,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["repoUrl", "requirement"], properties: { repoUrl: "string", requirement: "string" } },
    handler: async (input) => {
      const repoUrl = String(input.values.repoUrl ?? "").trim();
      const requirement = String(input.values.requirement ?? "").trim();
      if (!repoUrl || !requirement) return { kind: "failure", reason: "missing_input", userMessage: "Repository URL and requirement are required." };
      const context = await client.getImplementationContext(repoUrl);
      const prompt = JSON.stringify({ requirement, repository: context }, null, 2);
      const raw = await generator.generate(prompt);
      let plan: { summary: string; steps: string[]; files: Array<{ path: string; content: string }>; tests: string[] };
      try {
        const cleaned = raw.replace(/^\s*\`\`\`(?:json)?/i, "").replace(/\`\`\`\s*$/i, "").trim();
        plan = JSON.parse(cleaned);
      } catch {
        return { kind: "failure", reason: "invalid_agent_output", userMessage: "The coding agent returned an invalid change plan. No repository changes were made." };
      }
      const files = Array.isArray(plan.files) ? plan.files.filter((f) =>
        f && typeof f.path === "string" && typeof f.content === "string" &&
        f.path.length > 0 && f.path.length < 220 &&
        !f.path.startsWith("/") && !f.path.includes("..") &&
        !/(^|\/)(node_modules|dist|build|\.git|coverage)(\/|$)/i.test(f.path) &&
        !/\.(png|jpe?g|gif|webp|zip|apk|aab|pdf)$/i.test(f.path)
      ).slice(0, 6) : [];
      const total = files.reduce((n, f) => n + Buffer.byteLength(f.content, "utf8"), 0);
      if (!files.length) return { kind: "failure", reason: "no_safe_changes", userMessage: plan.summary || "No safe code changes could be generated from the available repository context." };
      if (total > 60000) return { kind: "failure", reason: "change_too_large", userMessage: "Generated changes exceed the safety size limit; no repository changes were made." };
      const branch = `zarvis/agent-${Date.now()}`;
      await client.createImplementationBranch(repoUrl, branch);
      await client.applyImplementationFiles(repoUrl, branch, files, `feat(agent): ${requirement.slice(0, 72)}`);
      const pr = await client.createPullRequest(
        repoUrl, branch,
        `ZARVIS Agent: ${requirement.slice(0, 72)}`,
        `## ZARVIS Developer Agent\\n\\n${plan.summary}\\n\\n### Steps\\n${(plan.steps || []).map(s => `- ${s}`).join("\\n")}\\n\\n### Verification\\n${(plan.tests || []).map(s => `- ${s}`).join("\\n")}\\n\\nChanges were committed to **${branch}** for human review. ZARVIS does not auto-merge this PR.`,
      );
      return { kind: "success", output: { branch, pullRequest: pr, files: files.map(f => f.path), tests: plan.tests || [] }, summary: `Implemented ${files.length} file change(s) on ${branch} and opened PR #${pr.number}. Human review is required before merge.` };
    },
  };
}
