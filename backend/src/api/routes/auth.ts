import { Router, type Response } from "express";
import { AuthError, type AuthService } from "../../auth/authService.js";
import { logger } from "../../security/redact.js";

export function authRouter(authService: AuthService): Router {
  const router = Router();

  router.post("/signup", async (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== "string" || typeof password !== "string") {
        res.status(400).json({ error: "email and password are required" });
        return;
      }
      const tokens = await authService.signup(email, password);
      res.status(201).json(tokens);
    } catch (err) {
      handleAuthError(err, res);
    }
  });

  router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== "string" || typeof password !== "string") {
        res.status(400).json({ error: "email and password are required" });
        return;
      }
      const tokens = await authService.login(email, password);
      res.status(200).json(tokens);
    } catch (err) {
      handleAuthError(err, res);
    }
  });

  router.post("/refresh", async (req, res) => {
    try {
      const { refreshToken } = req.body ?? {};
      if (typeof refreshToken !== "string") {
        res.status(400).json({ error: "refreshToken is required" });
        return;
      }
      const tokens = await authService.refresh(refreshToken);
      res.status(200).json(tokens);
    } catch (err) {
      handleAuthError(err, res);
    }
  });

  return router;
}

function handleAuthError(err: unknown, res: Response): void {
  if (err instanceof AuthError) {
    res.status(401).json({ error: err.message });
    return;
  }
  // An AuthError is an expected rejection (bad password, unknown user) and is safe to hand
  // straight to the client above; anything else here is unexpected (e.g. the database was
  // unreachable) and was previously swallowed into a bare 500 with no server-side trace at
  // all — logged now so a real failure shows up in the deployment's logs instead of just
  // "Internal error" with nothing to go on.
  logger.error("Unhandled auth error", { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: "Internal error" });
}
