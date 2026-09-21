import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface AccessTokenPayload {
  sub: string; // userId
  accountId: string;
  type: "access" | "refresh";
}

const ACCESS_TOKEN_TTL = "1h";
const REFRESH_TOKEN_TTL = "30d";
// Pinned explicitly (rather than relying on the library default) so verification can never
// be steered onto a different algorithm than every token here is actually signed with.
const JWT_ALGORITHM = "HS256";

export function signAccessToken(userId: string, accountId: string): string {
  return jwt.sign({ sub: userId, accountId, type: "access" } satisfies AccessTokenPayload, env.jwtSecret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function signRefreshToken(userId: string, accountId: string): string {
  return jwt.sign({ sub: userId, accountId, type: "refresh" } satisfies AccessTokenPayload, env.jwtSecret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: REFRESH_TOKEN_TTL,
  });
}

export function verifyToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtSecret, { algorithms: [JWT_ALGORITHM] }) as AccessTokenPayload;
}
