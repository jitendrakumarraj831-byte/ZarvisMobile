import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildContainer } from "../../src/container.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const app = () => buildServer(buildContainer(new InMemoryStore()));

/** Local files the page pulls in: `<script src>` and `<link href>` (stylesheet, manifest). */
function referencedFiles(): string[] {
  const html = readFileSync(join(repo, "web/index.html"), "utf8");
  const found = new Set<string>();
  const patterns = [/<script[^>]+src="\.?\/?([\w.-]+\.js)"/g, /<link[^>]+rel="(?:stylesheet|manifest)"[^>]+href="\.?\/?([\w.-]+\.(?:css|webmanifest))"/g];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/**
 * Every file the page references has to be reachable in all three places it can be served from
 * (this Express server, the Vercel routes, the service worker's offline shell). shell.js once
 * lived in the page but not in vercel.json, so on Vercel the catch-all answered it with
 * index.html and the search palette, notifications and account menu silently never loaded.
 */
describe("web client files are registered everywhere they are served", () => {
  const files = referencedFiles();

  it("finds the scripts and styles the page uses", () => {
    expect(files).toEqual(expect.arrayContaining(["app.js", "logic.js", "shell.js", "feature-pages.js", "theme-init.js", "styles.css", "manifest.webmanifest"]));
  });

  it.each(files)("%s: Express serves it with a real content type (not the index.html fallback)", async (file) => {
    const res = await request(app()).get("/" + file);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(file.endsWith(".js") ? /javascript/ : file.endsWith(".css") ? /css/ : /json|manifest/);
  });

  const vercel = JSON.parse(readFileSync(join(repo, "vercel.json"), "utf8")) as {
    routes: { src: string; dest: string }[];
    headers: { source: string }[];
  };

  it.each(files)("%s: vercel.json routes it to its own file, before the catch-all", (file) => {
    const route = vercel.routes.find((r) => new RegExp(r.src).test("/" + file));
    expect(route?.dest, `no route for /${file}`).toBe("/web/" + file);
  });

  it.each(files.filter((f) => f.endsWith(".js") || f.endsWith(".css")))("%s: vercel.json sends it with no-store like the other app files", (file) => {
    expect(vercel.headers.some((h) => new RegExp("^" + h.source + "$").test("/" + file) && h.source !== "/(.*)"), `no cache header rule for /${file}`).toBe(true);
  });

  it.each(files)("%s: the service worker precaches it for the offline shell", (file) => {
    const sw = readFileSync(join(repo, "web/sw.js"), "utf8");
    expect(sw).toContain(`"/${file}"`);
  });
});
