/**
 * GitHub integration boundary for the Developer Agent.
 *
 * Authorization model: every request is made with the *calling user's own* GitHub token (if
 * they connected one) or with no token at all (public repositories only). There is no shared
 * server token for user requests, so a user can only read what their own GitHub identity can
 * read and can only write where GitHub itself reports they have push access.
 */

/** Thrown for GitHub API errors; `status` lets callers map to an honest user message. */
export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export interface RepoAccess {
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  canPush: boolean;
}

export interface GitHubUser {
  login: string;
  scopes: string;
}
export interface RepoStructure {
  repoUrl: string;
  primaryLanguage: string;
  buildSystem: string;
  hasTests: boolean;
  hasCi: boolean;
  fileCount: number;
  topLevelDirs: string[];
}

export interface PullRequestCheck {
  name: string;
  status: string;
  conclusion: string | null;
  url: string | null;
}

/** What GitHub itself reports about a pull request and the checks that ran on its latest commit. */
export interface PullRequestStatus {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  merged: boolean;
  draft: boolean;
  headSha: string;
  headRef: string;
  baseRef: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  checks: PullRequestCheck[];
}

export interface GitHubClient {
  /** The authenticated user behind this client's token (fails for an anonymous client). */
  getAuthenticatedUser(): Promise<GitHubUser>;
  /** What this client's identity may do on the repository, as reported by GitHub. */
  getRepoAccess(repoUrl: string): Promise<RepoAccess>;
  analyzeRepository(repoUrl: string): Promise<RepoStructure>;
  getImplementationContext(repoUrl: string, maxFiles?: number, maxBytes?: number): Promise<{
    repoUrl: string;
    defaultBranch: string;
    files: Array<{ path: string; content: string; sha: string }>;
  }>;
  createImplementationBranch(repoUrl: string, branch: string): Promise<{ branch: string }>;
  applyImplementationFiles(repoUrl: string, branch: string, files: Array<{ path: string; content: string }>, message: string): Promise<{ commitShas: string[] }>;
  createPullRequest(repoUrl: string, branch: string, title: string, body: string): Promise<{ number: number; url: string }>;
  /** Read-only: the pull request and the check runs / commit statuses GitHub reports for its head commit. */
  getPullRequestStatus(repoUrl: string, number: number): Promise<PullRequestStatus>;
}

interface GitHubRepo {
  full_name: string;
  default_branch: string;
  language: string | null;
  private?: boolean;
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
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

  async getAuthenticatedUser(): Promise<GitHubUser> {
    if (!this.token) throw new GitHubApiError(401, "No GitHub token");
    const response = await fetch(`${this.baseUrl}/user`, { headers: this.headers() });
    if (!response.ok) throw new GitHubApiError(response.status, `GitHub /user failed (${response.status})`);
    const body = (await response.json()) as { login?: string };
    if (!body.login) throw new GitHubApiError(502, "GitHub /user returned no login");
    return { login: body.login, scopes: response.headers.get("x-oauth-scopes") ?? "" };
  }

  async getRepoAccess(repoUrl: string): Promise<RepoAccess> {
    const { owner, repo } = parseRepoUrl(repoUrl);
    const data = await this.request<GitHubRepo>(`/repos/${owner}/${repo}`);
    return {
      fullName: data.full_name,
      isPrivate: data.private === true,
      defaultBranch: data.default_branch,
      // GitHub only includes `permissions` for an authenticated caller; absent means no push.
      canPush: this.token !== undefined && data.permissions?.push === true,
    };
  }

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
        const content = Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8");
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
    if (!this.token) throw new GitHubApiError(401, "A connected GitHub account is required for write actions.");
    const { owner, repo } = parseRepoUrl(repoUrl);
    const repoData = await this.request<GitHubRepo & { default_branch: string }>(`/repos/${owner}/${repo}`);
    const ref = await this.request<{ object: { sha: string } }>(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(repoData.default_branch)}`);
    await this.requestRaw(`/repos/${owner}/${repo}/git/refs`, "POST", { ref: `refs/heads/${branch}`, sha: ref.object.sha });
    return { branch };
  }

  async applyImplementationFiles(repoUrl: string, branch: string, files: Array<{ path: string; content: string }>, message: string) {
    if (!this.token) throw new GitHubApiError(401, "A connected GitHub account is required for write actions.");
    const { owner, repo } = parseRepoUrl(repoUrl);
    const commitShas: string[] = [];
    for (const file of files) {
      // encodeURIComponent leaves "." and ".." intact and URL parsing resolves them, so such a
      // segment would send this write (with the user's token) to a different GitHub endpoint.
      const segments = file.path.split("/");
      if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
        throw new GitHubApiError(422, `Refusing an unsafe repository path: ${JSON.stringify(file.path.slice(0, 120))}`);
      }
      const encodedPath = segments.map(encodeURIComponent).join("/");
      let existingSha: string | undefined;
      try {
        const existing = await this.request<{ sha: string }>(
          `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
        );
        existingSha = existing.sha;
      } catch (error) {
        if (!(error instanceof GitHubApiError && error.status === 404)) throw error;
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
    if (!this.token) throw new GitHubApiError(401, "A connected GitHub account is required for write actions.");
    const { owner, repo } = parseRepoUrl(repoUrl);
    const pr = await this.requestRaw<{ number: number; html_url: string }>(
      `/repos/${owner}/${repo}/pulls`, "POST", { title, body, head: branch, base: (await this.request<GitHubRepo>(`/repos/${owner}/${repo}`)).default_branch },
    );
    return { number: pr.number, url: pr.html_url };
  }

  async getPullRequestStatus(repoUrl: string, number: number): Promise<PullRequestStatus> {
    const { owner, repo } = parseRepoUrl(repoUrl);
    if (!Number.isInteger(number) || number < 1) throw new GitHubApiError(400, "A pull request number is required.");
    const pr = await this.request<{
      number: number; title: string; html_url: string; state: "open" | "closed"; merged?: boolean; draft?: boolean;
      head: { sha: string; ref: string }; base: { ref: string }; changed_files?: number; additions?: number; deletions?: number;
    }>(`/repos/${owner}/${repo}/pulls/${number}`);
    const sha = encodeURIComponent(pr.head.sha);
    // A repository without any CI answers both with empty lists; a failing lookup is not "no checks".
    const [runs, combined] = await Promise.all([
      this.request<{ check_runs?: Array<{ name: string; status: string; conclusion: string | null; html_url?: string | null }> }>(`/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=50`),
      this.request<{ statuses?: Array<{ context: string; state: string; target_url?: string | null }> }>(`/repos/${owner}/${repo}/commits/${sha}/status`),
    ]);
    const checks: PullRequestCheck[] = [
      ...(runs.check_runs ?? []).map((run) => ({ name: run.name, status: run.status, conclusion: run.conclusion ?? null, url: run.html_url ?? null })),
      ...(combined.statuses ?? []).map((status) => ({
        name: status.context,
        status: status.state === "pending" ? "in_progress" : "completed",
        conclusion: status.state === "pending" ? null : status.state === "success" ? "success" : "failure",
        url: status.target_url ?? null,
      })),
    ];
    return {
      number: pr.number, title: pr.title, url: pr.html_url, state: pr.state, merged: pr.merged === true, draft: pr.draft === true,
      headSha: pr.head.sha, headRef: pr.head.ref, baseRef: pr.base.ref,
      changedFiles: pr.changed_files ?? 0, additions: pr.additions ?? 0, deletions: pr.deletions ?? 0, checks,
    };
  }

  private headers(json = false): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "ZarvisMobile-Developer-Agent",
      "x-github-api-version": "2022-11-28",
    };
    if (json) headers["content-type"] = "application/json";
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    return headers;
  }

  private async requestRaw<T>(path: string, method: string, body?: unknown): Promise<T> {
    const headers = this.headers(true);
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new GitHubApiError(response.status, `GitHub write failed (${response.status}) ${detail.slice(0, 200)}`.trim());
    }
    return (await response.json()) as T;
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const hint =
        response.status === 404
          ? "Repository not found, or it is private and this GitHub identity cannot read it."
          : response.status === 403
            ? "GitHub API rate limit or permission denied."
            : "GitHub API request failed.";
      throw new GitHubApiError(response.status, `${hint} (${response.status}) ${detail.slice(0, 200)}`.trim());
    }
    return (await response.json()) as T;
  }
}


/** Deterministic in-memory GitHub client used by unit tests. Never wired in production. */
export class MockGitHubClient implements GitHubClient {
  constructor(
    private readonly options: { token?: string; login?: string; canPush?: boolean; missingRepos?: string[] } = {},
  ) {}

  async getAuthenticatedUser(): Promise<GitHubUser> {
    if (!this.options.token) throw new GitHubApiError(401, "No GitHub token");
    return { login: this.options.login ?? "mock-user", scopes: "repo" };
  }

  async getRepoAccess(repoUrl: string): Promise<RepoAccess> {
    const { owner, repo } = parseRepoUrl(repoUrl);
    if (this.options.missingRepos?.includes(`${owner}/${repo}`)) throw new GitHubApiError(404, "Not Found");
    return { fullName: `${owner}/${repo}`, isPrivate: false, defaultBranch: "main", canPush: this.options.token !== undefined && this.options.canPush === true };
  }

  async analyzeRepository(repoUrl: string): Promise<RepoStructure> {
    const { owner, repo } = parseRepoUrl(repoUrl);
    if (this.options.missingRepos?.includes(`${owner}/${repo}`)) throw new GitHubApiError(404, "Not Found");
    return {
      repoUrl,
      primaryLanguage: "Kotlin",
      buildSystem: "Gradle",
      hasTests: true,
      hasCi: true,
      fileCount: 12,
      topLevelDirs: ["app", "domain"],
    };
  }

  async getImplementationContext(repoUrl: string, maxFiles = 24, maxBytes = 70000) {
    return {
      repoUrl,
      defaultBranch: "main",
      files: [
        {
          path: "README.md",
          content: "# Mock repository\n",
          sha: "mock-readme-sha",
        },
      ].slice(0, Math.min(maxFiles, 1)).map((file) => ({
        ...file,
        content: file.content.slice(0, maxBytes),
      })),
    };
  }

  async createImplementationBranch(_repoUrl: string, branch: string) {
    return { branch };
  }

  async applyImplementationFiles(
    _repoUrl: string,
    _branch: string,
    files: Array<{ path: string; content: string }>,
    _message: string,
  ) {
    return { commitShas: files.map((_, index) => `mock-commit-${index + 1}`) };
  }

  async createPullRequest(_repoUrl: string, _branch: string, _title: string, _body: string) {
    return { number: 1, url: "https://github.com/example/demo/pull/1" };
  }

  async getPullRequestStatus(repoUrl: string, number: number): Promise<PullRequestStatus> {
    const { owner, repo } = parseRepoUrl(repoUrl);
    return {
      number, title: "Mock pull request", url: `https://github.com/${owner}/${repo}/pull/${number}`, state: "open", merged: false, draft: false,
      headSha: "mock-head-sha", headRef: "zarvis/agent-mock", baseRef: "main", changedFiles: 1, additions: 2, deletions: 0,
      checks: [{ name: "mock-ci", status: "completed", conclusion: "success", url: null }],
    };
  }
}

export function parseRepoUrl(value: string): { owner: string; repo: string } {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Please provide a valid GitHub repository URL."); }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    throw new Error("Only github.com repository URLs are supported.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("GitHub URL must look like https://github.com/owner/repository.");
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/, "");
  // Only characters GitHub allows in owner/repo names — keeps user input from altering API paths.
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || repo === "." || repo === "..") {
    throw new Error("That doesn't look like a valid GitHub owner/repository name.");
  }
  return { owner, repo };
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
