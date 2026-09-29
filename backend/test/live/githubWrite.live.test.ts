import { describe, expect, it } from "vitest";
import { RealGitHubClient, parseRepoUrl } from "../../src/github/githubClient.js";

/**
 * Live check of the Developer Agent's authorized GitHub write path against the real GitHub API:
 * identity → push permission → branch → commit → pull request, then cleanup (the PR is closed
 * and the branch deleted). Opt-in only, and only against a throwaway repository you own:
 *
 *   ZARVIS_LIVE_TESTS=1 ZARVIS_LIVE_GITHUB_TOKEN=<fine-grained token scoped to that repo only>
 *   ZARVIS_LIVE_GITHUB_TEST_REPO=https://github.com/<you>/<sandbox-repo> \
 *     npx vitest run test/live/githubWrite.live.test.ts
 *
 * Refuses to run against the ZARVIS repository itself. Skipped (never passed) without the
 * variables.
 */
const token = process.env.ZARVIS_LIVE_GITHUB_TOKEN;
const repoUrl = process.env.ZARVIS_LIVE_GITHUB_TEST_REPO;
const enabled = process.env.ZARVIS_LIVE_TESTS === "1" && !!token && !!repoUrl;

describe.skipIf(!enabled)("LIVE GitHub authorized write", () => {
  it("creates a branch, commits and opens a PR only with push access, then cleans up", async () => {
    const { owner, repo } = parseRepoUrl(repoUrl!);
    expect(repo.toLowerCase(), "never run against the product repository").not.toBe("zarvismobile");

    const client = new RealGitHubClient(token);
    const me = await client.getAuthenticatedUser();
    const access = await client.getRepoAccess(repoUrl!);
    console.log(`ZARVIS_LIVE github user=${me.login} repo=${owner}/${repo} push=${access.canPush}`);
    expect(access.canPush, "the test token must have push access to the sandbox repo").toBe(true);

    const branch = `zarvis-live-check-${Date.now()}`;
    await client.createImplementationBranch(repoUrl!, branch);
    const { commitShas } = await client.applyImplementationFiles(
      repoUrl!, branch,
      [{ path: `zarvis-live-check/${branch}.md`, content: "ZARVIS live GitHub write check. Safe to delete.\n" }],
      "ZARVIS live GitHub write check",
    );
    expect(commitShas.length).toBeGreaterThan(0);
    const pr = await client.createPullRequest(repoUrl!, branch, "ZARVIS live check (auto-closed)", "Created and closed by test/live/githubWrite.live.test.ts.");
    expect(pr.number).toBeGreaterThan(0);
    console.log(`ZARVIS_LIVE github pr=${pr.url} commits=${commitShas.length}`);

    // Cleanup: close the PR and delete the branch.
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
    const closed = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}`, {
      method: "PATCH", headers, body: JSON.stringify({ state: "closed" }),
    });
    expect(closed.ok).toBe(true);
    const deleted = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, { method: "DELETE", headers });
    expect(deleted.status).toBe(204);
  }, 120_000);
});
