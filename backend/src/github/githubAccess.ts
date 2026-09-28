import type { SecretBox } from "../security/secretBox.js";
import type { Store } from "../store/store.js";
import { GitHubApiError, type GitHubClient } from "./githubClient.js";

export type GitHubClientFactory = (token?: string) => GitHubClient;

export class GitHubConnectError extends Error {
  constructor(
    readonly code: "integration_unavailable" | "invalid_token" | "github_unreachable",
    message: string,
  ) {
    super(message);
    this.name = "GitHubConnectError";
  }
}

export interface GitHubConnectionStatus {
  available: boolean;
  connected: boolean;
  login: string | null;
  scopes: string | null;
  connectedAt: string | null;
}

/**
 * Per-user GitHub authorization (blueprint §13 Phase 20 safety, §18 per-user authorization):
 * each account connects its own token, stored encrypted; every Developer Agent request runs
 * as that user's GitHub identity, or anonymously (public repositories only) when none is
 * connected. There is deliberately no fallback to a shared server token.
 */
export class GitHubAccessService {
  constructor(
    private readonly store: Store,
    private readonly secretBox: SecretBox | null,
    private readonly clientFactory: GitHubClientFactory,
  ) {}

  get available(): boolean {
    return this.secretBox !== null;
  }

  async connect(accountId: string, token: string): Promise<GitHubConnectionStatus> {
    if (!this.secretBox) {
      throw new GitHubConnectError("integration_unavailable", "GitHub connection is not configured on this server.");
    }
    const trimmed = token.trim();
    if (!/^[A-Za-z0-9_]{20,255}$/.test(trimmed)) {
      throw new GitHubConnectError("invalid_token", "That doesn't look like a GitHub token.");
    }
    let user;
    try {
      user = await this.clientFactory(trimmed).getAuthenticatedUser();
    } catch (err) {
      if (err instanceof GitHubApiError && (err.status === 401 || err.status === 403)) {
        throw new GitHubConnectError("invalid_token", "GitHub rejected this token.");
      }
      throw new GitHubConnectError("github_unreachable", "Couldn't reach GitHub to verify the token. Try again.");
    }
    const connectedAt = new Date();
    await this.store.saveGitHubConnection({
      accountId,
      encryptedToken: this.secretBox.encrypt(trimmed),
      githubLogin: user.login,
      scopes: user.scopes,
      connectedAt,
    });
    return { available: true, connected: true, login: user.login, scopes: user.scopes, connectedAt: connectedAt.toISOString() };
  }

  async status(accountId: string): Promise<GitHubConnectionStatus> {
    const connection = await this.store.getGitHubConnection(accountId);
    return {
      available: this.available,
      connected: connection !== undefined,
      login: connection?.githubLogin ?? null,
      scopes: connection?.scopes ?? null,
      connectedAt: connection?.connectedAt.toISOString() ?? null,
    };
  }

  async disconnect(accountId: string): Promise<void> {
    await this.store.deleteGitHubConnection(accountId);
  }

  /** A client acting as this account's GitHub identity, or an anonymous one. */
  async clientFor(accountId: string): Promise<{ client: GitHubClient; login: string | null }> {
    const connection = await this.store.getGitHubConnection(accountId);
    if (!connection || !this.secretBox) return { client: this.clientFactory(undefined), login: null };
    return { client: this.clientFactory(this.secretBox.decrypt(connection.encryptedToken)), login: connection.githubLogin };
  }
}
