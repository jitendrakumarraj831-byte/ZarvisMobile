import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildContainer } from "../../src/container.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";

/**
 * Client ↔ backend contract: every endpoint the Android app (Retrofit `ZarvisApi.kt`) and the
 * web client (`apiFetch(...)` in web/app.js) call must be a route the backend actually serves,
 * so a renamed or removed route fails here instead of on a phone.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

interface Layer {
  name: string;
  regexp: RegExp;
  route?: { path: string; methods: Record<string, boolean> };
  handle: { stack?: Layer[] };
}

/** A client-side path variable ({id}, ${taskId}) — matches any single route segment. */
const VAR = "\u0000";

function served(app: Express): Array<{ method: string; segments: string[] }> {
  const out: Array<{ method: string; segments: string[] }> = [];
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        const segments = (prefix + layer.route.path).split("/").filter(Boolean);
        for (const method of Object.keys(layer.route.methods)) out.push({ method: method.toUpperCase(), segments });
      } else if (layer.name === "router" && layer.handle.stack) {
        const mount = layer.regexp.source.replace(/^\^/, "").replace("\\/?(?=\\/|$)", "").replace(/\\\//g, "/");
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  walk((app as unknown as { _router: { stack: Layer[] } })._router.stack, "");
  return out;
}

const app = buildServer(buildContainer(new InMemoryStore()));
const routes = served(app);
const segmentMatches = (route: string, client: string) => route.startsWith(":") || client === VAR || route === client;
const isServed = (method: string | null, path: string) => {
  const client = path.split("/").filter(Boolean);
  return routes.some((r) => (method === null || r.method === method) && r.segments.length === client.length && r.segments.every((seg, i) => segmentMatches(seg, client[i] ?? "")));
};

describe("client ↔ backend API contract", () => {
  it("every Android ZarvisApi endpoint exists with the same HTTP method", () => {
    const source = readFileSync(join(repo, "android/data/data-remote/src/main/kotlin/com/zarvismobile/data/remote/ZarvisApi.kt"), "utf8");
    const calls = [...source.matchAll(/@(GET|POST|PUT|PATCH|DELETE)\("([^"]+)"\)/g)].map((m) => ({
      method: m[1] ?? "",
      path: "/" + (m[2] ?? "").replace(/\{[^}]+\}/g, VAR),
    }));
    expect(calls.length).toBeGreaterThan(15);
    const missing = calls.filter((c) => !isServed(c.method, c.path)).map((c) => `${c.method} ${c.path.replaceAll(VAR, "{var}")}`);
    expect(missing).toEqual([]);
  });

  it("every web apiFetch path exists", async () => {
    const source = readFileSync(join(repo, "web/app.js"), "utf8");
    const paths = [...new Set([...source.matchAll(/apiFetch\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => "/api/v1" + (m[1] ?? "").split("?")[0]!.replace(/\$\{[^}]+\}/g, VAR)))];
    expect(paths.length).toBeGreaterThan(10);
    const missing: string[] = [];
    for (const path of paths) {
      if (isServed(null, path)) continue;
      // The documents router is mounted lazily; probe it instead of reading its routes.
      if (path.startsWith("/api/v1/documents/")) {
        const res = await request(app).post(path.replaceAll(VAR, "x")).send({});
        if (res.status !== 404) continue;
      }
      missing.push(path.replaceAll(VAR, "{var}"));
    }
    expect(missing).toEqual([]);
  });
});
