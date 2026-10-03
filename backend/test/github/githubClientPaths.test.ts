import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubApiError, RealGitHubClient } from "../../src/github/githubClient.js";

/**
 * File paths written by the Developer Agent come from the model, which reads repository
 * content (a prompt-injection surface). A "." or ".." segment survives encodeURIComponent and
 * is resolved by URL parsing, so it would aim the user's token at another GitHub endpoint.
 */
afterEach(() => vi.unstubAllGlobals());

describe("RealGitHubClient.applyImplementationFiles", () => {
  it.each(["../../../user/repos", "src/../../x", "./a", "a//b", "a/."])("refuses %s without any request", async (path) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = new RealGitHubClient("token", "https://api.github.com");
    await expect(client.applyImplementationFiles("https://github.com/o/r", "zarvis/b", [{ path, content: "x" }], "m"))
      .rejects.toBeInstanceOf(GitHubApiError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still writes an ordinary nested path", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return urls.length === 1 ? new Response("{}", { status: 404 }) : new Response(JSON.stringify({ commit: { sha: "abc" } }), { status: 201 });
    }));
    const client = new RealGitHubClient("token", "https://api.github.com");
    const result = await client.applyImplementationFiles("https://github.com/o/r", "zarvis/b", [{ path: "src/app file.ts", content: "x" }], "m");
    expect(result.commitShas).toEqual(["abc"]);
    expect(urls.every((u) => u.startsWith("https://api.github.com/repos/o/r/contents/src/app%20file.ts"))).toBe(true);
  });
});
