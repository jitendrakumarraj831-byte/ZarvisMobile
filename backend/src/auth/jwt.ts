import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface AccessTokenPayload {
  sub: string; // userId
  accountId: string;
  type: "access" | "refresh";
  /** Session id. Absent only on legacy tokens issued before sessions existed. */
  sid?: string;
  /** Refresh-token id; its sha256 is the session's current refresh hash. */
  jti?: string;
}

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
// Pinned explicitly (rather than relying on the library default) so verification can never
// be steered onto a different algorithm than every token here is actually signed with.
const JWT_ALGORITHM = "HS256";

export function signAccessToken(userId: string, accountId: string, sessionId: string): string {
  return jwt.sign(
    { sub: userId, accountId, type: "access", sid: sessionId } satisfies AccessTokenPayload,
    env.jwtSecret,
    { algorithm: JWT_ALGORITHM, expiresIn: ACCESS_TOKEN_TTL_SECONDS },
  );
}

export function signRefreshToken(userId: string, accountId: string, sessionId: string, tokenId: string): string {
  return jwt.sign(
    { sub: userId, accountId, type: "refresh", sid: sessionId, jti: tokenId } satisfies AccessTokenPayload,
    env.jwtSecret,
    { algorithm: JWT_ALGORITHM, expiresIn: REFRESH_TOKEN_TTL_SECONDS },
  );
}

export function verifyToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtSecret, { algorithms: [JWT_ALGORITHM] }) as AccessTokenPayload;
}
