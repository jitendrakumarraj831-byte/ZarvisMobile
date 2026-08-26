/**
 * Single seam for every GitHub operation — see DEVELOPER_AGENT.md "GitHub integration
 * boundary" and MASTER_SPEC.md §14. The mobile app never calls this directly; only the
 * backend's Developer Agent skills do.
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

/**
 * No GitHub App/OAuth credential is wired in this pass (MASTER_SPEC.md §29, §32). This
 * mock returns a plausible, clearly-labeled structure so `developer.analyze_repo` and the
 * Repository Agent's read-only flow (DEVELOPER_AGENT.md) can be demoed and tested end to
 * end. Swapping in a real GitHub App-backed client is additive: implement [GitHubClient].
 */
export class MockGitHubClient implements GitHubClient {
  async analyzeRepository(repoUrl: string): Promise<RepoStructure> {
    return {
      repoUrl,
      primaryLanguage: "Kotlin",
      buildSystem: "Gradle",
      hasTests: true,
      hasCi: false,
      fileCount: 128,
      topLevelDirs: ["android", "backend", "docs"],
    };
  }
}
