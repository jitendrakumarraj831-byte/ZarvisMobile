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

  it("rejects an oversized crafted email without slow regex backtracking", async () => {
    const crafted = `!@!.${"!.".repeat(50_000)}@`;
    const started = Date.now();
    await expect(authService.signup(crafted, "password123")).rejects.toThrow(AuthError);
    expect(Date.now() - started).toBeLessThan(100);
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

  describe("an account whose creation failed half way (a dropped database connection)", () => {
    function failingOnce(store: InMemoryStore): InMemoryStore {
      const original = store.createAccountForUser.bind(store);
      let failed = false;
      store.createAccountForUser = async (userId: string) => {
        if (!failed) {
          failed = true;
          throw new Error("Connection terminated unexpectedly");
        }
        return original(userId);
      };
      return store;
    }

    it("signing in creates the missing account instead of locking the email out", async () => {
      const store = failingOnce(new InMemoryStore());
      const service = new AuthService(store);
      await expect(service.signup("halfway@example.com", "password123")).rejects.toThrow(/Connection terminated/);
      await expect(service.signup("halfway@example.com", "password123")).rejects.toMatchObject({ code: "email_taken" });

      const tokens = await service.login("halfway@example.com", "password123");
      expect(tokens.accountId).toBeTruthy();
      const user = await store.findUserByEmail("halfway@example.com");
      expect((await store.getAccountByUserId(user!.id))?.id).toBe(tokens.accountId);
      expect(await store.getCreditBalance(tokens.accountId)).toBe(50);
      // The same account from now on.
      expect((await service.login("halfway@example.com", "password123")).accountId).toBe(tokens.accountId);
    });

    it("signing in with Google again creates the missing account", async () => {
      const store = failingOnce(new InMemoryStore());
      const service = new AuthService(store);
      const profile = { sub: "g-halfway", email: "halfway-google@example.com", name: "Half" };
      await expect(service.googleSignIn(profile)).rejects.toThrow(/Connection terminated/);
      const tokens = await service.googleSignIn(profile);
      expect(tokens.accountId).toBeTruthy();
      expect((await service.googleSignIn(profile)).accountId).toBe(tokens.accountId);
    });
  });
});
