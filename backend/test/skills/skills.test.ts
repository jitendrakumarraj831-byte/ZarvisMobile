import { describe, expect, it } from "vitest";
import { createDocsSummarizeSkill, NaiveSummarizer } from "../../src/skills/docsSummarize.js";
import { createWebSearchSkill, MockSearchProvider } from "../../src/skills/webSearch.js";
import { createDeveloperAnalyzeRepoSkill } from "../../src/skills/developerAnalyzeRepo.js";
import { MockGitHubClient } from "../../src/github/githubClient.js";

const context = { accountId: "acc-1" };

describe("web.search skill", () => {
  const skill = createWebSearchSkill(new MockSearchProvider());

  it("fails cleanly when the query is empty", async () => {
    const result = await skill.handler({ values: { query: "" } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_query" });
  });

  it("returns sourced results with a URL for the top hit", async () => {
    const result = await skill.handler({ values: { query: "best phone" } }, context);
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.summary).toContain("https://");
    }
  });
});

describe("docs.summarize skill", () => {
  const skill = createDocsSummarizeSkill(new NaiveSummarizer());

  it("fails cleanly when there is no text", async () => {
    const result = await skill.handler({ values: { text: "  " } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_text" });
  });

  it("summarizes provided text", async () => {
    const result = await skill.handler({ values: { text: "This is a report. It has details." } }, context);
    expect(result.kind).toBe("success");
  });
});

describe("developer.analyze_repo skill", () => {
  const skill = createDeveloperAnalyzeRepoSkill(new MockGitHubClient());

  it("fails cleanly when no repo URL is given", async () => {
    const result = await skill.handler({ values: { repoUrl: "" } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_repo_url" });
  });

  it("returns a structural summary for a repo URL", async () => {
    const result = await skill.handler({ values: { repoUrl: "https://github.com/example/demo" } }, context);
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.summary).toContain("Kotlin");
    }
  });
});
