import { Router, type Response } from "express";
import { AuthError, type AuthService } from "../../auth/authService.js";

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
  res.status(500).json({ error: "Internal error" });
}
