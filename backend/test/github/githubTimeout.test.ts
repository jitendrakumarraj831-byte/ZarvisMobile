import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { GitHubApiError, RealGitHubClient } from "../../src/github/githubClient.js";

/** A GitHub that stalls must become a clear error in a bounded time, never a request that hangs. */
let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function stalledGitHub(behaviour: "no-answer" | "stalled-body"): Promise<string> {
  server = createServer((_req, res) => {
    if (behaviour === "no-answer") return; // never answers
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"login":"al'); // starts the body, then goes quiet
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe("RealGitHubClient timeouts", () => {
  it("gives up on a GitHub that never answers a read", async () => {
    const client = new RealGitHubClient("token", await stalledGitHub("no-answer"), 150);
    const started = Date.now();
    const error = await client.getPullRequestStatus("https://github.com/o/r", 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).status).toBe(504);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("gives up on a GitHub that stops in the middle of an answer", async () => {
    const client = new RealGitHubClient("token", await stalledGitHub("stalled-body"), 150);
    const error = await client.getAuthenticatedUser().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).status).toBe(504);
  });

  it("gives up on a write that never answers instead of leaving the pull request half made", async () => {
    const client = new RealGitHubClient("token", await stalledGitHub("no-answer"), 150);
    const error = await client.createPullRequest("https://github.com/o/r", "zarvis/b", "t", "b").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).status).toBe(504);
  });
});
