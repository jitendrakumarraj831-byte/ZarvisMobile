import { describe, expect, it, vi } from "vitest";
import { createDeveloperImplementSkill } from "../../src/skills/developerImplement.js";
import { createDeveloperAnalyzeRepoSkill } from "../../src/skills/developerAnalyzeRepo.js";
import type { ContentGenerator } from "../../src/ai/contentGenerator.js";
import { GitHubAccessService } from "../../src/github/githubAccess.js";
import { GitHubApiError, type GitHubClient } from "../../src/github/githubClient.js";
import { SecretBox } from "../../src/security/secretBox.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { SkillUserError } from "../../src/tooling/toolPipeline.js";

const REPO = "https://github.com/acme/demo";

function client(options: { canPush?: boolean; token?: string } = {}): GitHubClient {
  return {
    getAuthenticatedUser: vi.fn(async () => {
      if (!options.token) throw new GitHubApiError(401, "no token");
      return { login: "alice", scopes: "repo" };
    }),
    getRepoAccess: vi.fn(async () => ({ fullName: "acme/demo", isPrivate: false, defaultBranch: "main", canPush: options.canPush === true })),
    analyzeRepository: vi.fn(async () => {
      throw new GitHubApiError(404, "Not Found");
    }),
    getImplementationContext: vi.fn(async () => ({
      repoUrl: REPO,
      defaultBranch: "main",
      files: [{ path: "package.json", content: "{}", sha: "sha" }],
    })),
    createImplementationBranch: vi.fn(async () => ({ branch: "zarvis/agent-test" })),
    applyImplementationFiles: vi.fn(async () => ({ commitShas: ["commit"] })),
    createPullRequest: vi.fn(async () => ({ number: 7, url: "https://github.com/acme/demo/pull/7" })),
    getPullRequestStatus: vi.fn(async () => {
      throw new GitHubApiError(404, "Not Found");
    }),
  };
}

/** Builds access where account "a1" has connected token "ghp_..." and every client is `github`. */
async function access(github: GitHubClient, connect = true): Promise<{ service: GitHubAccessService; tokens: Array<string | undefined> }> {
  const tokens: Array<string | undefined> = [];
  const connectClient = client({ token: "x" });
  const service = new GitHubAccessService(new InMemoryStore(), SecretBox.fromEnv(undefined, "test-secret", false), (token) => {
    tokens.push(token);
    return tokens.length === 1 && connect ? connectClient : github;
  });
  if (connect) await service.connect("a1", "ghp_" + "a".repeat(36));
  return { service, tokens };
}

const validPlan = JSON.stringify({ summary: "ok", steps: ["edit"], tests: ["npm test"], files: [{ path: "src/a.ts", content: "x" }] });

describe("developer.implement skill", () => {
  it("is explicitly high-risk, external, confirmation-gated and describes the exact action", async () => {
    const { service } = await access(client({ canPush: true }));
    const skill = createDeveloperImplementSkill(service, { generate: vi.fn() } as unknown as ContentGenerator);
    expect(skill.riskLevel).toBe("HIGH");
    expect(skill.actionClass).toBe("EXTERNAL_COMMUNICATION");
    expect(skill.requiresConfirmation).toBe(true);
    expect(skill.requiredEntitlement).toBe("PRO");
    expect(await skill.prepare!({ values: { repoUrl: REPO, requirement: "fix login" } }, { accountId: "a1" })).toEqual({
      kind: "ready",
      description: expect.stringContaining('As GitHub user alice, create a new branch in acme/demo'),
    });
  });

  it("prepare refuses before any confirmation when the user can't push", async () => {
    const { service } = await access(client({ canPush: false }));
    const skill = createDeveloperImplementSkill(service, { generate: vi.fn() } as unknown as ContentGenerator);
    await expect(skill.prepare!({ values: { repoUrl: REPO, requirement: "x" } }, { accountId: "a1" })).rejects.toMatchObject({ reason: "not_authorized" });
  });

  it("refuses when the user has not connected their own GitHub account (no shared server token)", async () => {
    const github = client({ canPush: true });
    const { service } = await access(github, false);
    const skill = createDeveloperImplementSkill(service, { generate: vi.fn(async () => validPlan) } as unknown as ContentGenerator);
    await expect(skill.handler({ values: { repoUrl: REPO, requirement: "fix it" } }, { accountId: "a1" })).rejects.toMatchObject({
      reason: "github_not_connected",
    });
    expect(github.createImplementationBranch).not.toHaveBeenCalled();
  });

  it("refuses when GitHub reports the user's identity has no push access", async () => {
    const github = client({ canPush: false });
    const { service } = await access(github);
    const skill = createDeveloperImplementSkill(service, { generate: vi.fn(async () => validPlan) } as unknown as ContentGenerator);
    await expect(skill.handler({ values: { repoUrl: REPO, requirement: "fix it" } }, { accountId: "a1" })).rejects.toBeInstanceOf(
      SkillUserError,
    );
    expect(github.createImplementationBranch).not.toHaveBeenCalled();
    expect(github.applyImplementationFiles).not.toHaveBeenCalled();
  });

  it("uses the connected user's own token and opens a PR when they can push", async () => {
    const github = client({ canPush: true });
    const { service, tokens } = await access(github);
    const skill = createDeveloperImplementSkill(service, { generate: vi.fn(async () => validPlan) } as unknown as ContentGenerator);
    const result = await skill.handler({ values: { repoUrl: REPO, requirement: "fix it" } }, { accountId: "a1" });
    expect(result.kind).toBe("success");
    expect(tokens.at(-1)).toBe("ghp_" + "a".repeat(36));
    const body = (github.createPullRequest as ReturnType<typeof vi.fn>).mock.calls[0]![3] as string;
    expect(body).toContain("\n### Steps\n");
    expect(body).not.toContain("\\n");
  });

  it("rejects malformed model output without touching GitHub", async () => {
    const github = client({ canPush: true });
    const { service } = await access(github);
    const skill = createDeveloperImplementSkill(service, { generate: vi.fn(async () => "not json") } as unknown as ContentGenerator);
    const result = await skill.handler({ values: { repoUrl: REPO, requirement: "fix it" } }, { accountId: "a1" });
    expect(result.kind).toBe("failure");
    expect(github.createImplementationBranch).not.toHaveBeenCalled();
  });

  it("filters unsafe paths and refuses an empty safe patch", async () => {
    const github = client({ canPush: true });
    const { service } = await access(github);
    const generate = vi.fn(async () =>
      JSON.stringify({ summary: "unsafe", steps: [], tests: [], files: [{ path: "../secret.txt", content: "x" }, { path: ".github/workflows/x.yml", content: "x" }] }),
    );
    const skill = createDeveloperImplementSkill(service, { generate } as unknown as ContentGenerator);
    const result = await skill.handler({ values: { repoUrl: REPO, requirement: "fix it" } }, { accountId: "a1" });
    expect(result.kind).toBe("failure");
    expect(github.createImplementationBranch).not.toHaveBeenCalled();
  });
});

describe("developer.analyze_repo skill", () => {
  it("reports a private/missing repo honestly instead of throwing a raw error", async () => {
    const { service } = await access(client(), false);
    const skill = createDeveloperAnalyzeRepoSkill(service);
    await expect(skill.handler({ values: { repoUrl: REPO } }, { accountId: "a1" })).rejects.toMatchObject({ reason: "repo_unavailable" });
  });

  it("rejects a URL whose owner/repo could alter API paths", async () => {
    const { service } = await access(client(), false);
    const skill = createDeveloperAnalyzeRepoSkill(service);
    await expect(skill.handler({ values: { repoUrl: "https://github.com/acme/..%2F..%2Fuser" } }, { accountId: "a1" })).rejects.toMatchObject({
      reason: "invalid_repo_url",
    });
  });
});
