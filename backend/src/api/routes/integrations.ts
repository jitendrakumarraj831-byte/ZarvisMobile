import { Router } from "express";
import { GitHubConnectError, type GitHubAccessService } from "../../github/githubAccess.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";

/**
 * GET    /api/v1/integrations/github — connection status (never returns the token).
 * POST   /api/v1/integrations/github — { token }: verified with GitHub, stored encrypted.
 * DELETE /api/v1/integrations/github — disconnects and deletes the stored token.
 */
export function integrationsRouter(github: GitHubAccessService): Router {
  const router = Router();
  const connectLimit = rateLimit({ name: "github-connect", windowMs: 15 * 60 * 1000, max: 10, keyBy: "account" });

  router.get(
    "/github",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      res.json(await github.status(req.auth!.accountId));
    }),
  );

  router.post(
    "/github",
    requireAuth,
    connectLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { token } = req.body ?? {};
      if (typeof token !== "string" || !token.trim()) {
        res.status(400).json({ error: "token is required", code: "invalid_request" });
        return;
      }
      try {
        res.json(await github.connect(req.auth!.accountId, token));
      } catch (err) {
        if (err instanceof GitHubConnectError) {
          const status = err.code === "integration_unavailable" ? 503 : err.code === "invalid_token" ? 400 : 502;
          res.status(status).json({ error: err.message, code: err.code });
          return;
        }
        throw err;
      }
    }),
  );

  router.delete(
    "/github",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      await github.disconnect(req.auth!.accountId);
      res.status(204).end();
    }),
  );

  return router;
}
