import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EmailTakenError, type Account, type Store, type User } from "../store/store.js";
import type { ClockPort } from "../tooling/ports.js";
import { systemClockPort } from "../tooling/ports.js";
import { hashPassword, verifyPassword } from "./passwordHash.js";
import {
  REFRESH_TOKEN_TTL_SECONDS,
  signAccessToken,
  signRefreshToken,
  verifyToken,
  type AccessTokenPayload,
} from "./jwt.js";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  isGuest: boolean;
  /** The sign-in email for a linked account; null for a guest. */
  email: string | null;
}

export interface AccountIdentity {
  accountId: string;
  isGuest: boolean;
  email: string | null;
}

/**
 * Stable machine-readable codes. Clients use them to tell "your session is gone, sign in
 * again" (session_*) apart from a transient network/server failure — the difference between
 * asking the user what to do and silently replacing their account.
 */
export type AuthErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "email_taken"
  | "not_guest"
  | "session_invalid"
  | "session_revoked"
  | "refresh_token_reused";

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GUEST_EMAIL_DOMAIN = "device.zarvismobile.local";
const LEGACY_GUEST_EMAIL = /^guest-[0-9a-f-]{36}@device\.zarvismobile\.(local|com)$/;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Email/password + guest accounts with server-side rotating sessions.
 *
 * - Every sign-in creates a session; access and refresh tokens carry its id.
 * - Refresh tokens rotate on every use. Only the newest one is accepted; presenting an older
 *   one (a replay/theft signal) revokes the whole session.
 * - Logout revokes the session server-side; access tokens for it stop working immediately.
 * - A guest can be linked to a real email/password, after which the same account can be
 *   signed into from Web and Android — the basis of cross-device continuity.
 */
export class AuthService {
  constructor(
    private readonly store: Store,
    private readonly clock: ClockPort = systemClockPort,
  ) {}

  async signup(email: string, password: string): Promise<AuthTokens> {
    const normalizedEmail = normalizeEmail(email);
    // Compatibility: app builds released before POST /auth/guest existed bootstrap guests by
    // signing up with a generated `guest-<uuid>@device.zarvismobile.*` address. Keep those
    // working, but record them as guests (they can later be linked to a real email).
    const legacyGuest = LEGACY_GUEST_EMAIL.test(normalizedEmail);
    if (!legacyGuest) validateCredentials(normalizedEmail, password);
    else if (password.length < 8) throw new AuthError("invalid_request", "Password must be at least 8 characters");
    const existing = await this.store.findUserByEmail(normalizedEmail);
    if (existing) {
      throw new AuthError("email_taken", "An account with this email already exists");
    }
    let user: User;
    try {
      user = await this.store.createUser(normalizedEmail, hashPassword(password), legacyGuest);
    } catch (err) {
      if (err instanceof EmailTakenError) throw new AuthError("email_taken", err.message);
      throw err;
    }
    const account = await this.store.createAccountForUser(user.id);
    return this.startSession(user, account);
  }

  /** A device-bootstrapped account with no email. The password is random and never returned. */
  async createGuest(): Promise<AuthTokens> {
    const email = `guest-${randomUUID()}@${GUEST_EMAIL_DOMAIN}`;
    const user = await this.store.createUser(email, hashPassword(randomBytes(32).toString("hex")), true);
    const account = await this.store.createAccountForUser(user.id);
    return this.startSession(user, account);
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.store.findUserByEmail(normalizeEmail(email));
    if (!user || user.isGuest || !verifyPassword(password, user.passwordHash)) {
      throw new AuthError("invalid_credentials", "Invalid email or password");
    }
    const account = await this.store.getAccountByUserId(user.id);
    if (!account) {
      throw new AuthError("invalid_credentials", "Invalid email or password");
    }
    return this.startSession(user, account);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: AccessTokenPayload;
    try {
      payload = verifyToken(refreshToken);
    } catch {
      throw new AuthError("session_invalid", "Invalid or expired refresh token");
    }
    if (payload.type !== "refresh") {
      throw new AuthError("session_invalid", "Not a refresh token");
    }
    const { user, account } = await this.requireOwnedAccount(payload.sub, payload.accountId);

    if (!payload.sid || !payload.jti) {
      // Legacy token from before server-side sessions: migrate it once into a real session so
      // existing installs are not logged out (and never silently given a new account).
      return this.startSession(user, account);
    }

    const session = await this.store.getSession(payload.sid);
    const now = this.clock.now();
    if (!session || session.accountId !== account.id || session.userId !== user.id) {
      throw new AuthError("session_invalid", "Session not found");
    }
    if (session.revokedAt) {
      throw new AuthError("session_revoked", "This session was signed out");
    }
    if (session.expiresAt <= now) {
      throw new AuthError("session_invalid", "Session expired");
    }
    const presentedHash = sha256(payload.jti);
    if (presentedHash !== session.refreshTokenHash) {
      // An older refresh token was replayed: treat the session as compromised.
      await this.store.revokeSession(session.id, now);
      throw new AuthError("refresh_token_reused", "Refresh token was already used; session revoked");
    }
    const nextTokenId = randomUUID();
    const rotated = await this.store.rotateSession(
      session.id,
      presentedHash,
      sha256(nextTokenId),
      new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      now,
    );
    if (!rotated) {
      // Lost a race with a concurrent refresh of the same token — also a reuse.
      await this.store.revokeSession(session.id, now);
      throw new AuthError("refresh_token_reused", "Refresh token was already used; session revoked");
    }
    return this.tokens(user, account, session.id, nextTokenId);
  }

  async logout(sessionId: string | undefined): Promise<void> {
    if (sessionId) await this.store.revokeSession(sessionId, this.clock.now());
  }

  /** Links a guest account to a real email/password. The account id, data and credits are unchanged. */
  async linkGuest(userId: string, accountId: string, email: string, password: string): Promise<AccountIdentity> {
    const { user } = await this.requireOwnedAccount(userId, accountId);
    if (!user.isGuest) {
      throw new AuthError("not_guest", "This account already has a sign-in email");
    }
    const normalizedEmail = normalizeEmail(email);
    validateCredentials(normalizedEmail, password);
    try {
      const updated = await this.store.updateUserCredentials(user.id, normalizedEmail, hashPassword(password));
      return { accountId, isGuest: updated.isGuest, email: updated.email };
    } catch (err) {
      if (err instanceof EmailTakenError) throw new AuthError("email_taken", err.message);
      throw err;
    }
  }

  async identity(userId: string, accountId: string): Promise<AccountIdentity> {
    const { user } = await this.requireOwnedAccount(userId, accountId);
    return { accountId, isGuest: user.isGuest, email: user.isGuest ? null : user.email };
  }

  /**
   * Validates an access token's session on every authenticated request, so logout and
   * refresh-reuse revocation take effect immediately rather than when the token expires.
   */
  async validateAccess(payload: AccessTokenPayload): Promise<{ userId: string; accountId: string; sessionId?: string }> {
    if (payload.sid) {
      const session = await this.store.getSession(payload.sid);
      if (!session || session.revokedAt || session.expiresAt <= this.clock.now()) {
        throw new AuthError("session_revoked", "Session is no longer valid");
      }
      if (session.accountId !== payload.accountId || session.userId !== payload.sub) {
        throw new AuthError("session_invalid", "Session does not match token");
      }
      return { userId: payload.sub, accountId: payload.accountId, sessionId: session.id };
    }
    // Every access token is issued with a session id; one without cannot be revoked by
    // logout or refresh-reuse detection, so it is not accepted.
    throw new AuthError("session_invalid", "Access token has no session");
  }

  private async requireOwnedAccount(userId: string, accountId: string): Promise<{ user: User; account: Account }> {
    const user = await this.store.findUserById(userId);
    const account = user ? await this.store.getAccount(accountId) : undefined;
    if (!user || !account || account.userId !== user.id) {
      throw new AuthError("session_invalid", "Unknown account");
    }
    return { user, account };
  }

  private async startSession(user: User, account: Account): Promise<AuthTokens> {
    const now = this.clock.now();
    const sessionId = randomUUID();
    const tokenId = randomUUID();
    await this.store.createSession({
      id: sessionId,
      userId: user.id,
      accountId: account.id,
      refreshTokenHash: sha256(tokenId),
      createdAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      lastUsedAt: now,
    });
    return this.tokens(user, account, sessionId, tokenId);
  }

  private tokens(user: User, account: Account, sessionId: string, tokenId: string): AuthTokens {
    return {
      accessToken: signAccessToken(user.id, account.id, sessionId),
      refreshToken: signRefreshToken(user.id, account.id, sessionId, tokenId),
      accountId: account.id,
      isGuest: user.isGuest,
      email: user.isGuest ? null : user.email,
    };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateCredentials(email: string, password: string): void {
  // Length first: EMAIL_PATTERN backtracks polynomially on long crafted input (~7 s for a
  // 100 KB body), so it must only ever see an RFC-sized (≤254) string.
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new AuthError("invalid_request", "Invalid email address");
  }
  if (email.endsWith(`@${GUEST_EMAIL_DOMAIN}`) || email.endsWith("@device.zarvismobile.com")) {
    throw new AuthError("invalid_request", "This email domain is reserved");
  }
  if (password.length < 8 || password.length > 256) {
    throw new AuthError("invalid_request", "Password must be 8–256 characters");
  }
}
