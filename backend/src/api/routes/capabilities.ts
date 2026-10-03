import { Router } from "express";
import { CAPABILITIES } from "../../capabilities/registry.js";

/**
 * GET /api/v1/capabilities — the Phase 1 Capability Registry with each capability's truthful
 * Web and Android status. Public (no account data) so clients can explain access before
 * sign-in; identical content to shared/capability-registry.json.
 */
export function capabilitiesRouter(): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ capabilities: CAPABILITIES });
  });
  return router;
}
