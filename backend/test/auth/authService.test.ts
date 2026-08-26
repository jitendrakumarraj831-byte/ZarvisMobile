import { beforeEach, describe, expect, it } from "vitest";
import { AuthError, AuthService } from "../../src/auth/authService.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";

describe("AuthService", () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService(new InMemoryStore());
  });

  it("signs up a new user and starts a trial account", async () => {
    const tokens = await authService.signup("new@example.com", "password123");
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.accountId).toBeTruthy();
  });

  it("rejects a duplicate signup email", async () => {
    await authService.signup("dupe@example.com", "password123");
    await expect(authService.signup("dupe@example.com", "password123")).rejects.toThrow(AuthError);
  });

  it("rejects a short password", async () => {
    await expect(authService.signup("short@example.com", "short")).rejects.toThrow(AuthError);
  });

  it("logs in with correct credentials", async () => {
    await authService.signup("login@example.com", "password123");
    const tokens = await authService.login("login@example.com", "password123");
    expect(tokens.accessToken).toBeTruthy();
  });

  it("rejects login with the wrong password", async () => {
    await authService.signup("wrong@example.com", "password123");
    await expect(authService.login("wrong@example.com", "wrong-password")).rejects.toThrow(AuthError);
  });

  it("issues a new token pair from a valid refresh token", async () => {
    const initial = await authService.signup("refresh@example.com", "password123");
    const refreshed = await authService.refresh(initial.refreshToken);
    expect(refreshed.accountId).toBe(initial.accountId);
    expect(refreshed.accessToken).toBeTruthy();
  });

  it("rejects an access token used as a refresh token", async () => {
    const initial = await authService.signup("misuse@example.com", "password123");
    await expect(authService.refresh(initial.accessToken)).rejects.toThrow(AuthError);
  });
});
