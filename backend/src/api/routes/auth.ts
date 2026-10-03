import { Router, type Response } from "express";
import { AuthError, type AuthService } from "../../auth/authService.js";
import { logger } from "../../security/redact.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";

export function authRouter(authService: AuthService): Router {
  const router = Router();
  // Limiters are created per router so each app instance (and each test) has its own counters.
  const signupLimit = rateLimit({ name: "auth-signup", windowMs: 60 * 60 * 1000, max: 60, keyBy: "ip" });
  const loginLimit = rateLimit({ name: "auth-login", windowMs: 15 * 60 * 1000, max: 20, keyBy: "ip" });
  const refreshLimit = rateLimit({ name: "auth-refresh", windowMs: 60 * 1000, max: 30, keyBy: "ip" });
  const linkLimit = rateLimit({ name: "auth-link", windowMs: 15 * 60 * 1000, max: 10, keyBy: "account" });

  router.post("/signup", signupLimit, async (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== "string" || typeof password !== "string") {
        res.status(400).json({ error: "email and password are required", code: "invalid_request" });
        return;
      }
      res.status(201).json(await authService.signup(email, password));
    } catch (err) {
      handleAuthError(err, res);
    }
  });

  /** Creates a guest account for a device/browser. The client never chooses its credentials. */
  router.post("/guest", signupLimit, async (_req, res) => {
    try {
      res.status(201).json(await authService.createGuest());
    } catch (err) {
      handleAuthError(err, res);
    }
  });

  router.post("/login", loginLimit, async (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== "string" || typeof password !== "string") {
        res.status(400).json({ error: "email and password are required", code: "invalid_request" });
        return;
      }
      res.status(200).json(await authService.login(email, password));
    } catch (err) {
      handleAuthError(err, res);
    }
  });

  router.post("/refresh", refreshLimit, async (req, res) => {
    try {
      const { refreshToken } = req.body ?? {};
      if (typeof refreshToken !== "string") {
        res.status(400).json({ error: "refreshToken is required", code: "invalid_request" });
        return;
      }
      res.status(200).json(await authService.refresh(refreshToken));
    } catch (err) {
      handleAuthError(err, res);
    }
  });

  router.post(
    "/logout",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      await authService.logout(req.auth!.sessionId);
      res.status(204).end();
    }),
  );

  router.get(
    "/me",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        res.json(await authService.identity(req.auth!.userId, req.auth!.accountId));
      } catch (err) {
        handleAuthError(err, res);
      }
    }),
  );

  /** Adds a sign-in email/password to the current guest account so it can be used on other devices. */
  router.post(
    "/link",
    requireAuth,
    linkLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { email, password } = req.body ?? {};
      if (typeof email !== "string" || typeof password !== "string") {
        res.status(400).json({ error: "email and password are required", code: "invalid_request" });
        return;
      }
      try {
        res.json(await authService.linkGuest(req.auth!.userId, req.auth!.accountId, email, password));
      } catch (err) {
        handleAuthError(err, res);
      }
    }),
  );

  return router;
}

function handleAuthError(err: unknown, res: Response): void {
  if (err instanceof AuthError) {
    const status =
      err.code === "invalid_request" ? 400 : err.code === "email_taken" || err.code === "not_guest" ? 409 : 401;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  logger.error("Unhandled auth error", { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: "Internal error", code: "internal_error" });
}
