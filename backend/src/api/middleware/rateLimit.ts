import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "./authMiddleware.js";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Distinguishes limiters so they never share counters. */
  name: string;
  windowMs: number;
  max: number;
  /** "ip" for unauthenticated routes; "account" (falls back to ip) after requireAuth. */
  keyBy: "ip" | "account";
}

const MAX_TRACKED_KEYS = 50_000;

/**
 * Fixed-window rate limiter. Honest limitation: counters are per server instance (in-process
 * memory), so on a serverless host with many warm instances the effective limit is
 * `max × instances`. It still bounds abuse from a single client hitting one instance, and
 * the store/limit seam is here for a shared (Postgres/Redis) counter later.
 */
export function rateLimit(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const auth = (req as AuthenticatedRequest).auth;
    const subject = options.keyBy === "account" && auth ? `acct:${auth.accountId}` : `ip:${req.ip ?? "unknown"}`;
    const key = `${options.name}:${subject}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= MAX_TRACKED_KEYS) {
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
        if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
      }
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "Too many requests. Please wait and try again.", code: "rate_limited", retryAfterSeconds });
      return;
    }
    next();
  };
}
