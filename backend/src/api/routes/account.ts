import { Router } from "express";
import type { Store } from "../../store/store.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

/** DELETE /api/v1/account — cascading account deletion. See MASTER_SPEC.md §17 "Memory Architecture". */
export function accountRouter(store: Store): Router {
  const router = Router();

  router.delete(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      await store.deleteAccount(req.auth!.accountId);
      res.status(204).end();
    }),
  );

  return router;
}
