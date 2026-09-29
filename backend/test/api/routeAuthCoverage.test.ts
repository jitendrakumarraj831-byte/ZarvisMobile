import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildContainer } from "../../src/container.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";

/**
 * Walks every route Express actually has mounted and checks that each one refuses an
 * unauthenticated request with 401 — so a route added later without `requireAuth` fails here
 * instead of shipping. Only the endpoints that must work before sign-in are public.
 */
const PUBLIC = new Set([
  "GET /health",
  "POST /api/v1/auth/signup",
  "POST /api/v1/auth/guest",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/refresh",
  // The capability registry is public product information (what ZARVIS can and cannot do).
  "GET /api/v1/capabilities/",
]);

interface Layer {
  name: string;
  regexp: RegExp;
  route?: { path: string; methods: Record<string, boolean> };
  handle: { stack?: Layer[] };
}

function mountPath(layer: Layer): string {
  // Express 4 compiles "/api/v1/auth" to /^\/api\/v1\/auth\/?(?=\/|$)/i
  return layer.regexp.source
    .replace(/^\^/, "")
    .replace("\\/?(?=\\/|$)", "")
    .replace(/\\\//g, "/");
}

function routes(app: Express): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) out.push({ method: method.toUpperCase(), path: prefix + layer.route.path });
      } else if (layer.name === "router" && layer.handle.stack) {
        walk(layer.handle.stack, prefix + mountPath(layer));
      }
    }
  };
  walk((app as unknown as { _router: { stack: Layer[] } })._router.stack, "");
  return out;
}

describe("route authentication coverage", () => {
  const app = buildServer(buildContainer(new InMemoryStore()));
  const all = routes(app).filter((r) => r.path.startsWith("/api/") || r.path === "/health");

  it("finds the mounted API routes", () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it("every non-public route rejects a request without a token (401), before reading the body", async () => {
    const leaks: string[] = [];
    for (const { method, path } of all) {
      const key = `${method} ${path}`;
      if (PUBLIC.has(key)) continue;
      const concrete = path.replace(/:[A-Za-z_]+/g, "x");
      const call = request(app)[method.toLowerCase() as "get"](concrete).send({});
      const res = await call;
      if (res.status !== 401) leaks.push(`${key} -> ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it("the lazily-mounted documents router is not reachable without a token", async () => {
    const res = await request(app).post("/api/v1/documents/extract").send({});
    expect([401, 503]).toContain(res.status);
  });
});
