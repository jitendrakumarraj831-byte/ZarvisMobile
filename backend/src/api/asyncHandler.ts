import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does not catch a rejected promise thrown by an `async` route handler — it
 * becomes an unhandled rejection and crashes the whole process, taking down every other
 * in-flight request with it. This was found live: a Gemini API error (a retired model
 * name) inside `orchestrator.ts`'s `/turn` handler killed the entire backend rather than
 * returning a 500 to the one caller. Wrapping every route with `asyncHandler` forwards the
 * rejection to Express's error middleware (`server.ts`) instead, which logs it and returns
 * an honest error response (Product Principle #4, "Never fake success") without crashing.
 */
export function asyncHandler<Req extends Request = Request>(
  handler: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req as Req, res, next).catch(next);
  };
}
