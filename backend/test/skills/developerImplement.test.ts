import { describe, expect, it, vi } from "vitest";
import { createDeveloperImplementSkill } from "../../src/skills/developerImplement.js";
import type { ContentGenerator } from "../../src/ai/contentGenerator.js";
import type { GitHubClient } from "../../src/github/githubClient.js";

function client(): GitHubClient {
  return {
    analyzeRepository: vi.fn(),
    getImplementationContext: vi.fn(async () => ({
      repoUrl: "https://github.com/acme/demo",
      defaultBranch: "main",
      files: [{ path: "package.json", content: "{}", sha: "sha" }],
    })),
    createImplementationBranch: vi.fn(async () => ({ branch: "zarvis/agent-test" })),
    applyImplementationFiles: vi.fn(async () => ({ commitShas: ["commit"] })),
    createPullRequest: vi.fn(async () => ({ number: 7, url: "https://github.com/acme/demo/pull/7" })),
  };
}

describe("developer.implement skill", () => {
  it("is explicitly high-risk and confirmation-gated", () => {
    const skill = createDeveloperImplementSkill(client(), { generate: vi.fn() } as unknown as ContentGenerator);
    expect(skill.riskLevel).toBe("HIGH");
    expect(skill.requiresConfirmation).toBe(true);
    expect(skill.requiredEntitlement).toBe("PRO");
  });

  it("rejects malformed model output without touching GitHub", async () => {
    const github = client();
    const generate = vi.fn(async () => "not json");
    const skill = createDeveloperImplementSkill(github, { generate } as unknown as ContentGenerator);
    const result = await skill.handler(
      { values: { repoUrl: "https://github.com/acme/demo", requirement: "fix it" } },
      { accountId: "a1", confirmed: true },
    );
    expect(result.kind).toBe("failure");
    expect(github.createImplementationBranch).not.toHaveBeenCalled();
    expect(github.applyImplementationFiles).not.toHaveBeenCalled();
  });

  it("filters unsafe paths and refuses an empty safe patch", async () => {
    const github = client();
    const generate = vi.fn(async () => JSON.stringify({
      summary: "unsafe",
      steps: [],
      tests: [],
      files: [{ path: "../secret.txt", content: "x" }, { path: "image.png", content: "x" }],
    }));
    const skill = createDeveloperImplementSkill(github, { generate } as unknown as ContentGenerator);
    const result = await skill.handler(
      { values: { repoUrl: "https://github.com/acme/demo", requirement: "fix it" } },
      { accountId: "a1", confirmed: true },
    );
    expect(result.kind).toBe("failure");
    expect(github.createImplementationBranch).not.toHaveBeenCalled();
  });
});
