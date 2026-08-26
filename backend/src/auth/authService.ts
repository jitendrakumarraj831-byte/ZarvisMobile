import type { Store } from "../store/store.js";
import { hashPassword, verifyPassword } from "./passwordHash.js";
import { signAccessToken, signRefreshToken, verifyToken } from "./jwt.js";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accountId: string;
}

export class AuthError extends Error {}

/**
 * Minimal email/password auth — see MASTER_SPEC.md §15 "AuthN". A real launch would add
 * OAuth providers and stronger password policy; this is enough to demonstrate the
 * account/entitlement wiring end to end (SUBSCRIPTIONS.md) without external dependencies.
 */
export class AuthService {
  constructor(private readonly store: Store) {}

  async signup(email: string, password: string): Promise<AuthTokens> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      throw new AuthError("Invalid email address");
    }
    if (password.length < 8) {
      throw new AuthError("Password must be at least 8 characters");
    }
    const existing = await this.store.findUserByEmail(normalizedEmail);
    if (existing) {
      throw new AuthError("An account with this email already exists");
    }
    const user = await this.store.createUser(normalizedEmail, hashPassword(password));
    const account = await this.store.createAccountForUser(user.id);
    return {
      accessToken: signAccessToken(user.id, account.id),
      refreshToken: signRefreshToken(user.id, account.id),
      accountId: account.id,
    };
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.store.findUserByEmail(email.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new AuthError("Invalid email or password");
    }
    const account = await this.store.getAccountByUserId(user.id);
    if (!account) {
      throw new AuthError("No account found for this user");
    }
    return {
      accessToken: signAccessToken(user.id, account.id),
      refreshToken: signRefreshToken(user.id, account.id),
      accountId: account.id,
    };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload;
    try {
      payload = verifyToken(refreshToken);
    } catch {
      throw new AuthError("Invalid or expired refresh token");
    }
    if (payload.type !== "refresh") {
      throw new AuthError("Not a refresh token");
    }
    const user = await this.store.findUserById(payload.sub);
    if (!user) {
      throw new AuthError("Unknown user");
    }
    return {
      accessToken: signAccessToken(payload.sub, payload.accountId),
      refreshToken: signRefreshToken(payload.sub, payload.accountId),
      accountId: payload.accountId,
    };
  }
}
