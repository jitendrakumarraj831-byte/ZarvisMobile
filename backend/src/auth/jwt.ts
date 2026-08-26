import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface AccessTokenPayload {
  sub: string; // userId
  accountId: string;
  type: "access" | "refresh";
}

const ACCESS_TOKEN_TTL = "1h";
const REFRESH_TOKEN_TTL = "30d";

export function signAccessToken(userId: string, accountId: string): string {
  return jwt.sign({ sub: userId, accountId, type: "access" } satisfies AccessTokenPayload, env.jwtSecret, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function signRefreshToken(userId: string, accountId: string): string {
  return jwt.sign({ sub: userId, accountId, type: "refresh" } satisfies AccessTokenPayload, env.jwtSecret, {
    expiresIn: REFRESH_TOKEN_TTL,
  });
}

export function verifyToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
}
