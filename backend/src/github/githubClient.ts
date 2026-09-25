/**
 * GitHub integration boundary for the Developer Agent.
 *
 * Public repositories are analyzed without credentials. If GITHUB_TOKEN is configured,
 * it is also sent for private repositories and higher API rate limits.
 */
export interface RepoStructure {
  repoUrl: string;
  primaryLanguage: string;
  buildSystem: string;
  hasTests: boolean;
  hasCi: boolean;
  fileCount: number;
  topLevelDirs: string[];
}

export interface GitHubClient {
  analyzeRepository(repoUrl: string): Promise<RepoStructure>;
  getImplementationContext(repoUrl: string, maxFiles?: number, maxBytes?: number): Promise<{
    repoUrl: string;
    defaultBranch: string;
    files: Array<{ path: string; content: string; sha: string }>;
  }>;
  createImplementationBranch(repoUrl: string, branch: string): Promise<{ branch: string }>;
  applyImplementationFiles(repoUrl: string, branch: string, files: Array<{ path: string; content: string }>, message: string): Promise<{ commitShas: string[] }>;
  createPullRequest(repoUrl: string, branch: string, title: string, body: string): Promise<{ number: number; url: string }>;
}

interface GitHubRepo {
  full_name: string;
  default_branch: string;
  language: string | null;
}

interface GitHubContent {
  name: string;
  type: "file" | "dir";
}

interface GitHubLanguages {
  [language: string]: number;
}

interface GitHubTree {
  tree?: Array<{ path: string; type: string }>;
}

export class RealGitHubClient implements GitHubClient {
  constructor(
    private readonly token?: string,
    private readonly baseUrl = "https://api.github.com",
  ) {}

  async analyzeRepository(repoUrl: string): Promise<RepoStructure> {
    const { owner, repo } = parseRepoUrl(repoUrl);
    const repoData = await this.request<GitHubRepo>(`/repos/${owner}/${repo}`);
    const [root, languages, tree] = await Promise.all([
      this.request<GitHubContent[]>(`/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(repoData.default_branch)}`),
      this.request<GitHubLanguages>(`/repos/${owner}/${repo}/languages`),
      this.request<GitHubTree>(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(repoData.default_branch)}?recursive=1`),
    ]);

    const languageEntries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
    const primaryLanguage = languageEntries[0]?.[0] || repoData.language || "Unknown";
    const paths = tree.tree ?? [];
    const names = paths.map((item) => item.path.toLowerCase());
    const fileCount = paths.filter((item) => item.type === "blob").length;
    const topLevelDirs = root.filter((item) => item.type === "dir").map((item) => item.name).sort();
    const hasTests = names.some((path) =>
      /(^|\/)(__tests__|tests?|specs?|test)(\/|$)|\.(test|spec)\.[a-z0-9]+$/.test(path),
    );
    const hasCi =
      names.some((path) => path.startsWith(".github/workflows/")) ||
      names.some((path) => /(^|\/)(\.circleci|\.github)(\/|$)/.test(path));

    return {
      repoUrl,
      primaryLanguage,
      buildSystem: detectBuildSystem(names, primaryLanguage),
      hasTests,
      hasCi,
      fileCount,
      topLevelDirs,
    };
  }

  async getImplementationContext(repoUrl: string, maxFiles = 24, maxBytes = 70000) {
    const { owner, repo } = parseRepoUrl(repoUrl);
    const repoData = await this.request<GitHubRepo>(`/repos/${owner}/${repo}`);
    const tree = await this.request<GitHubTree>(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(repoData.default_branch)}?recursive=1`);
    const candidates = (tree.tree ?? [])
      .filter((item) => item.type === "blob")
      .map((item) => item.path)
      .filter((path) => !/(^|\/)(node_modules|dist|build|\.git|coverage|\.gradle)(\/|$)/i.test(path))
      .filter((path) => /\.(ts|tsx|js|jsx|json|md|yml|yaml|html|css|kt|java|py|go|rs|toml)$/i.test(path))
      .sort((a, b) => scoreSourcePath(a) - scoreSourcePath(b))
      .slice(0, maxFiles);
    const files: Array<{ path: string; content: string; sha: string }> = [];
    let total = 0;
    for (const path of candidates) {
      if (total >= maxBytes) break;
      try {
        const data = await this.request<{ content?: string; encoding?: string; sha: string }>(
          `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(repoData.default_branch)}`,
        );
        if (!data.content || data.encoding !== "base64") continue;
        const content = Buffer.from(data.content.replace(/\\s/g, ""), "base64").toString("utf8");
        if (!content) continue;
        const remaining = maxBytes - total;
        const clipped = content.slice(0, remaining);
        files.push({ path, content: clipped, sha: data.sha });
        total += Buffer.byteLength(clipped, "utf8");
      } catch {
        // A single unreadable/generated file must not abort the whole planning pass.
      }
    }
    return { repoUrl, defaultBranch: repoData.default_branch, files };
  }

  async createImplementationBranch(repoUrl: string, branch: string) {
    if (!this.token) throw new Error("GITHUB_TOKEN is required for write-capable Developer Agent actions.");
    const { owner, repo } = parseRepoUrl(repoUrl);
    const repoData = await this.request<GitHubRepo & { default_branch: string }>(`/repos/${owner}/${repo}`);
    const ref = await this.request<{ object: { sha: string } }>(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(repoData.default_branch)}`);
    await this.requestRaw(`/repos/${owner}/${repo}/git/refs`, "POST", { ref: `refs/heads/${branch}`, sha: ref.object.sha });
    return { branch };
  }

  async applyImplementationFiles(repoUrl: string, branch: string, files: Array<{ path: string; content: string }>, message: string) {
    if (!this.token) throw new Error("GITHUB_TOKEN is required for write-capable Developer Agent actions.");
    const { owner, repo } = parseRepoUrl(repoUrl);
    const commitShas: string[] = [];
    for (const file of files) {
      const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
      let existingSha: string | undefined;
      try {
        const existing = await this.request<{ sha: string }>(
          `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
        );
        existingSha = existing.sha;
      } catch (error) {
        if (!String(error).includes("(404)")) throw error;
      }
      const payload: Record<string, unknown> = {
        message,
        content: Buffer.from(file.content, "utf8").toString("base64"),
        branch,
      };
      if (existingSha) payload.sha = existingSha;
      const result = await this.requestRaw<{ commit?: { sha?: string } }>(
        `/repos/${owner}/${repo}/contents/${encodedPath}`, "PUT", payload,
      );
      if (result.commit?.sha) commitShas.push(result.commit.sha);
    }
    return { commitShas };
  }

  async createPullRequest(repoUrl: string, branch: string, title: string, body: string) {
    if (!this.token) throw new Error("GITHUB_TOKEN is required for write-capable Developer Agent actions.");
    const { owner, repo } = parseRepoUrl(repoUrl);
    const pr = await this.requestRaw<{ number: number; html_url: string }>(
      `/repos/${owner}/${repo}/pulls`, "POST", { title, body, head: branch, base: (await this.request<GitHubRepo>(`/repos/${owner}/${repo}`)).default_branch },
    );
    return { number: pr.number, url: pr.html_url };
  }

  private async requestRaw<T>(path: string, method: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "ZarvisMobile-Developer-Agent",
      "x-github-api-version": "2022-11-28",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`GitHub write failed (${response.status}) ${detail}`.trim());
    }
    return (await response.json()) as T;
  }

  private async request<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "ZarvisMobile-Developer-Agent",
      "x-github-api-version": "2022-11-28",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(`${this.baseUrl}${path}`, { headers });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const hint =
        response.status === 404
          ? "Repository not found or private without a valid GITHUB_TOKEN."
          : response.status === 403
            ? "GitHub API rate limit or permission denied."
            : "GitHub API request failed.";
      throw new Error(`${hint} (${response.status}) ${detail}`.trim());
    }
    return (await response.json()) as T;
  }
}

function parseRepoUrl(value: string): { owner: string; repo: string } {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Please provide a valid GitHub repository URL."); }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    throw new Error("Only github.com repository URLs are supported.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("GitHub URL must look like https://github.com/owner/repository.");
  return { owner: parts[0]!, repo: parts[1]!.replace(/\.git$/, "") };
}

function detectBuildSystem(paths: string[], language: string): string {
  const markers: Array<[RegExp, string]> = [
    [/(^|\/)package\.json$/, "Node.js"],
    [/(^|\/)(pnpm-lock\.yaml|pnpm-workspace\.yaml)$/, "pnpm"],
    [/(^|\/)yarn\.lock$/, "Yarn"],
    [/(^|\/)package-lock\.json$/, "npm"],
    [/(^|\/)(build\.gradle|build\.gradle\.kts|settings\.gradle\.kts)$/, "Gradle"],
    [/(^|\/)pom\.xml$/, "Maven"],
    [/(^|\/)cargo\.toml$/, "Cargo"],
    [/(^|\/)(pyproject\.toml|requirements\.txt)$/, "Python"],
    [/(^|\/)go\.mod$/, "Go"],
    [/(^|\/)composer\.json$/, "Composer"],
  ];
  for (const [pattern, name] of markers) if (paths.some((path) => pattern.test(path))) return name;
  return language === "Unknown" ? "Unknown" : `${language} project`;
}


function scoreSourcePath(path: string): number {
  const p = path.toLowerCase();
  if (/^(package.json|readme.md|tsconfig.json|vite.config|next.config)/.test(p)) return 0;
  if (/(^|\/)(src|app|backend|server|api)(\/|$)/.test(p)) return 1;
  if (/(test|spec)/.test(p)) return 2;
  return 3;
}
