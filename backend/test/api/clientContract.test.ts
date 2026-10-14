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


/**
 * The API paths a web file calls: `apiFetch("/x")` and the workspace's `call("/x/" + encodeURIComponent(id))`. A part of the
 * expression that is not a string literal stands for one path segment when it follows a "/" and is otherwise a query suffix.
 */
function webApiPaths(source: string): string[] {
  const out = new Set<string>();
  for (const match of source.matchAll(/(?<![\w.])(?:host\.)?(?:apiFetch|call)\(\s*/g)) {
    let i = match.index + match[0].length;
    const first = source[i];
    if (first !== '"' && first !== "'" && first !== "`") continue; // a variable path (a wrapper's own parameter)
    let depth = 0;
    let quote = "";
    let end = i;
    for (; end < source.length; end += 1) {
      const c = source[end]!;
      if (quote) {
        if (c === "\\") end += 1;
        else if (c === quote) quote = "";
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(" || c === "[" || c === "{") depth += 1;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) break;
        depth -= 1;
      } else if (c === "," && depth === 0) break;
    }
    const expression = source.slice(i, end);
    // Split on top-level "+" into literals and non-literals.
    const parts: string[] = [];
    let current = "";
    quote = "";
    depth = 0;
    for (let k = 0; k < expression.length; k += 1) {
      const c = expression[k]!;
      if (quote) {
        current += c;
        if (c === "\\") { current += expression[k + 1] ?? ""; k += 1; } else if (c === quote) quote = "";
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; current += c; }
      else if (c === "(" || c === "[" || c === "{") { depth += 1; current += c; }
      else if (c === ")" || c === "]" || c === "}") { depth -= 1; current += c; }
      else if (c === "+" && depth === 0) { parts.push(current.trim()); current = ""; }
      else current += c;
    }
    parts.push(current.trim());
    let path = "";
    for (const part of parts) {
      const literal = /^(["'`])(.*)\1$/s.exec(part);
      if (literal) path += (literal[2] ?? "").replace(/\$\{[^}]+\}/g, VAR);
      else if (path.endsWith("/")) path += VAR;
    }
    path = path.split("?")[0]!.replace(/\/+$/, "");
    if (path.startsWith("/") && !path.includes(" ")) out.add("/api/v1" + path);
  }
  return [...out];
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

  it("every web API path exists (app.js, workspace.js, exec-cards.js, chat-kit.js, shell.js, feature-pages.js)", async () => {
    const paths = new Set<string>();
    for (const file of ["app.js", "workspace.js", "exec-cards.js", "chat-kit.js", "shell.js", "feature-pages.js"]) {
      for (const path of webApiPaths(readFileSync(join(repo, "web", file), "utf8"))) paths.add(path);
    }
    expect(paths.size).toBeGreaterThan(30);
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

  it("the web files call the workspace endpoints this phase added", () => {
    const all = new Set<string>();
    for (const file of ["workspace.js", "exec-cards.js"]) for (const path of webApiPaths(readFileSync(join(repo, "web", file), "utf8"))) all.add(path);
    for (const expected of ["/api/v1/projects", "/api/v1/notes", "/api/v1/memory", "/api/v1/files", "/api/v1/executions", "/api/v1/agents", "/api/v1/usage/summary", "/api/v1/developer/pr-status"]) {
      expect([...all].some((p) => p.startsWith(expected)), expected).toBe(true);
    }
  });
});
