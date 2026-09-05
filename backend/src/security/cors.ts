import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

/**
 * Minimal CORS handling for the browser web client (MASTER_SPEC.md §12a) — allows only the
 * origins configured in `CORS_ORIGINS` (defaults to the product domain, zarvismobile.com,
 * plus local dev hosts; see .env.example), rather than a permissive `*`, since requests
 * carry a bearer access token (see authMiddleware.ts).
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin && env.corsOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}
