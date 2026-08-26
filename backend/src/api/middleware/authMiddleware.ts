import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../../auth/jwt.js";

export interface AuthenticatedRequest extends Request {
  auth?: { userId: string; accountId: string };
}

/** Requires a valid Bearer access token — see MASTER_SPEC.md §15 "AuthZ". */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  try {
    const payload = verifyToken(header.slice("Bearer ".length));
    if (payload.type !== "access") {
      res.status(401).json({ error: "Not an access token" });
      return;
    }
    req.auth = { userId: payload.sub, accountId: payload.accountId };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
