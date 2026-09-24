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
