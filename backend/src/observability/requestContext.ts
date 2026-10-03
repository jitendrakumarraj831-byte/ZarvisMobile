import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Correlation ids, so one log query answers "which request, which turn": `requestId` for one HTTP
 * request, `turnId` for one orchestrator turn, `clientTurnId` for the client's logical turn (the
 * same across Retry). `vercelId` is the platform's own request id, to find the same request in
 * Vercel's logs.
 *
 * Why this is not an AsyncLocalStorage set once by a middleware: Node does not carry an async
 * context across callbacks fired by a resource created earlier (the socket behind the body parser
 * or multer), so a context established in the first middleware can be lost by the time the route
 * handler runs. The middleware therefore records the ids against the request, and the code that
 * does AI work enters the context explicitly with {@link runWithCorrelation}, where it is kept
 * for everything downstream of that call.
 */
export interface CorrelationContext {
  requestId?: string;
  vercelId?: string;
  turnId?: string;
  clientTurnId?: string;
}

const scope = new AsyncLocalStorage<CorrelationContext>();

/** Runs `fn` with `fields` merged over the ids already in scope (undefined values are ignored). */
export function runWithCorrelation<T>(fields: CorrelationContext, fn: () => T): T {
  const merged: CorrelationContext = { ...scope.getStore() };
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string" && value) merged[key as keyof CorrelationContext] = value;
  }
  return scope.run(merged, fn);
}

/** The ids in scope, for a log line. Empty outside any scope. */
export function correlationFields(): CorrelationContext {
  return { ...scope.getStore() };
}

/**
 * The ids of each request, keyed by the request object itself: no global state, nothing leaks
 * between requests, and no Express type augmentation (two copies of @types/express-serve-static-core
 * exist when the root and `backend/` are type-checked together, and TypeScript cannot match a
 * module augmentation across them; routes here use `AuthenticatedRequest` for the same reason).
 */
const requestIds = new WeakMap<object, CorrelationContext>();

/** Platform ids are `region::region::hash`-like; anything else is ignored rather than logged. */
const PLATFORM_ID = /^[\w:.-]{1,200}$/;

/** Assigns every request an id, answers it in `X-Request-Id`, and keeps Vercel's own id. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ids: CorrelationContext = { requestId: randomUUID() };
  const platformId = req.headers["x-vercel-id"];
  if (typeof platformId === "string" && PLATFORM_ID.test(platformId)) ids.vercelId = platformId;
  requestIds.set(req, ids);
  res.setHeader("X-Request-Id", ids.requestId!);
  next();
}

/** The correlation ids of a request, ready for {@link runWithCorrelation}. */
export function correlationOf(req: Request): CorrelationContext {
  return { ...requestIds.get(req) };
}
