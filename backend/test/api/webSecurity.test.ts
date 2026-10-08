import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildContainer } from "../../src/container.js";
import { CONTENT_SECURITY_POLICY } from "../../src/security/headers.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";

const app = () => buildServer(buildContainer(new InMemoryStore()));

describe("web client delivery and response headers", () => {
  it("serves the shipped client files with the security headers", async () => {
    for (const path of ["/", "/app.js", "/logic.js", "/shell.js", "/chat-kit.js", "/feature-pages.js", "/styles.css", "/sw.js", "/manifest.webmanifest", "/icons/icon-192.png"]) {
      const res = await request(app()).get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers["content-security-policy"], path).toBe(CONTENT_SECURITY_POLICY);
      expect(res.headers["x-content-type-options"], path).toBe("nosniff");
      expect(res.headers["x-frame-options"], path).toBe("DENY");
    }
    expect((await request(app()).get("/app.js")).headers["content-type"]).toMatch(/javascript/);
  });

  it("does not publish the browser tests or package metadata that sit beside the client", async () => {
    for (const path of ["/e2e/phase1.e2e.cjs", "/tests/logic.test.js", "/package.json", "/%65%32%65/phase1.e2e.cjs", "/E2E/phase1.e2e.cjs", "/icons/../package.json"]) {
      const res = await request(app()).get(path);
      expect(res.headers["content-type"], path).toMatch(/text\/html/); // the app shell fallback, never the file
      expect(res.text, path).not.toContain("playwright");
      expect(res.text, path).not.toContain("commonjs");
    }
  });

  it("marks API and health responses no-store, and never the static client", async () => {
    const guest = await request(app()).post("/api/v1/auth/guest");
    expect(guest.status).toBe(201);
    expect(guest.headers["cache-control"]).toBe("no-store");
    expect((await request(app()).get("/api/v1/auth/config")).headers["cache-control"]).toBe("no-store");
    expect((await request(app()).get("/health")).headers["cache-control"]).toBe("no-store");
    expect((await request(app()).get("/app.js")).headers["cache-control"]).not.toBe("no-store");
  });

  it("sends HSTS only for requests that arrived over HTTPS", async () => {
    const plain = await request(app()).get("/api/v1/auth/config");
    expect(plain.headers["strict-transport-security"]).toBeUndefined();
    const secure = await request(app()).get("/api/v1/auth/config").set("X-Forwarded-Proto", "https");
    expect(secure.headers["strict-transport-security"]).toBe("max-age=31536000");
  });
});
