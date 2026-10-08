import { randomUUID } from "node:crypto";
import { Router } from "express";
import { explainOutcome } from "../../agents/orchestrator.js";
import { GitHubApiError, parseRepoUrl, type PullRequestCheck } from "../../github/githubClient.js";
import type { GitHubAccessService } from "../../github/githubAccess.js";
import type { ToolPipeline } from "../../tooling/toolPipeline.js";
import type { SkillRegistry } from "../../tooling/skillRegistry.js";
import { toStructuredResult } from "../../tooling/toolResult.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";

/**
 * POST /api/v1/developer/analyze — read-only repository analysis.
 * POST /api/v1/developer/implement — always returns `confirmation_required` first; the
 * change only runs after POST /api/v1/confirmations/:id/approve for that exact request.
 */
export function developerRouter(pipeline: ToolPipeline, registry: SkillRegistry, github?: GitHubAccessService): Router {
  const router = Router();
  const limit = rateLimit({ name: "developer", windowMs: 60 * 1000, max: 10, keyBy: "account" });

  router.post(
    "/analyze",
    requireAuth,
    limit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { repoUrl } = req.body ?? {};
      if (typeof repoUrl !== "string" || repoUrl.trim().length === 0) {
        res.status(400).json({ error: "repoUrl is required" });
        return;
      }
      const outcome = await pipeline.execute(
        { id: randomUUID(), skillId: "developer.analyze_repo", input: { values: { repoUrl: repoUrl.trim() } } },
        { accountId: req.auth!.accountId },
      );
      res.json({ ...outcome, structured: toStructuredResult("developer.analyze_repo", registry.find("developer.analyze_repo"), outcome, explainOutcome(outcome)) });
    }),
  );

  router.post(
    "/implement",
    requireAuth,
    limit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { repoUrl, requirement } = req.body ?? {};
      if (typeof repoUrl !== "string" || typeof requirement !== "string" || !repoUrl.trim() || !requirement.trim()) {
        res.status(400).json({ error: "repoUrl and requirement are required" });
        return;
      }
      const outcome = await pipeline.execute(
        {
          id: randomUUID(),
          skillId: "developer.implement",
          input: { values: { repoUrl: repoUrl.trim(), requirement: requirement.trim().slice(0, 4000) } },
        },
        { accountId: req.auth!.accountId },
      );
      res.json({ ...outcome, structured: toStructuredResult("developer.implement", registry.find("developer.implement"), outcome, explainOutcome(outcome)) });
    }),
  );

  // What GitHub reports for a pull request and its checks. ZARVIS runs no tests of its own, so this is the only
  // test evidence there is: the repository's own CI, read back from GitHub with the user's identity.
  const readLimit = rateLimit({ name: "developer-pr-status", windowMs: 60 * 1000, max: 30, keyBy: "account" });
  router.get(
    "/pr-status",
    requireAuth,
    readLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      if (!github) {
        res.status(503).json({ error: "GitHub isn't available on this server.", code: "integration_unavailable" });
        return;
      }
      const repoUrl = typeof req.query.repoUrl === "string" ? req.query.repoUrl.trim() : "";
      const number = Number.parseInt(String(req.query.number ?? ""), 10);
      try {
        parseRepoUrl(repoUrl);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Invalid repository URL.", code: "invalid_repo_url" });
        return;
      }
      if (!Number.isInteger(number) || number < 1) {
        res.status(400).json({ error: "number must be a pull request number.", code: "invalid_request" });
        return;
      }
      try {
        const { client } = await github.clientFor(req.auth!.accountId);
        const pr = await client.getPullRequestStatus(repoUrl, number);
        res.json({ pullRequest: pr, summary: summarizeChecks(pr.checks), source: "github", testsRunByZarvis: false });
      } catch (err) {
        if (err instanceof GitHubApiError) {
          const status = err.status === 404 || err.status === 401 ? 404 : err.status === 403 ? 429 : 502;
          res.status(status).json({
            error: status === 404 ? "GitHub can't show that pull request to this account." : status === 429 ? "GitHub refused the request (rate limit or permission). Try again later." : "GitHub could not be reached.",
            code: status === 404 ? "pull_request_unavailable" : "github_unavailable",
          });
          return;
        }
        throw err;
      }
    }),
  );

  return router;
}

const PASSED = new Set(["success", "neutral", "skipped"]);
const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"]);

/** Counts of the checks GitHub returned. `total: 0` means no CI reported anything, which is not a pass. */
export function summarizeChecks(checks: PullRequestCheck[]) {
  const passed = checks.filter((c) => c.status === "completed" && c.conclusion !== null && PASSED.has(c.conclusion)).length;
  const failed = checks.filter((c) => c.status === "completed" && c.conclusion !== null && FAILED.has(c.conclusion)).length;
  return { total: checks.length, passed, failed, pending: checks.length - passed - failed };
}
