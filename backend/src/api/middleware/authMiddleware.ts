import type { NextFunction, Request, Response } from "express";
import { AuthError, type AuthService } from "../../auth/authService.js";
import { verifyToken } from "../../auth/jwt.js";

export interface AuthenticatedRequest extends Request {
  auth?: { userId: string; accountId: string; sessionId?: string };
}

/**
 * Requires a valid Bearer access token AND a live server-side session (so logout and refresh
 * reuse revocation take effect immediately). The AuthService is read from `app.locals`, set by
 * buildServer, so every router shares the same session validation without global state.
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing bearer token", code: "unauthenticated" });
    return;
  }
  let payload;
  try {
    payload = verifyToken(header.slice("Bearer ".length));
  } catch {
    res.status(401).json({ error: "Invalid or expired token", code: "access_token_invalid" });
    return;
  }
  if (payload.type !== "access") {
    res.status(401).json({ error: "Not an access token", code: "access_token_invalid" });
    return;
  }
  const authService = req.app.locals.authService as AuthService | undefined;
  if (!authService) {
    next(new Error("authService is not configured on app.locals"));
    return;
  }
  authService.validateAccess(payload).then(
    (auth) => {
      req.auth = auth;
      next();
    },
    (err) => {
      if (err instanceof AuthError) {
        res.status(401).json({ error: err.message, code: err.code });
        return;
      }
      next(err);
    },
  );
}
