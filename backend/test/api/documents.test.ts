import type { Express } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildContainer } from "../../src/container.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { buildServer } from "../../src/server.js";
import { buildDocxFixture, buildPdfFixture } from "../documents/fixtures.js";

describe("POST /api/v1/documents/extract", () => {
  let app: Express;
  let token: string;

  beforeEach(async () => {
    app = buildServer(buildContainer(new InMemoryStore()));
    const res = await request(app).post("/api/v1/auth/signup").send({ email: "docs@example.com", password: "password123" });
    token = res.body.accessToken;
  });

  it("rejects an unauthenticated request", async () => {
    const pdf = await buildPdfFixture("hello");
    const res = await request(app).post("/api/v1/documents/extract").attach("file", pdf, "notes.pdf");
    expect(res.status).toBe(401);
  });

  it("extracts real text from an uploaded PDF", async () => {
    const original = "Quarterly report summary: revenue grew twelve percent year over year.";
    const pdf = await buildPdfFixture(original);
    const res = await request(app)
      .post("/api/v1/documents/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", pdf, { filename: "report.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(200);
    expect(res.body.text.replace(/\s+/g, " ").trim()).toBe(original);
  });

  it("extracts real text from an uploaded DOCX", async () => {
    const original = "Meeting notes: ship the upload feature by Friday.";
    const docx = await buildDocxFixture(original);
    const res = await request(app)
      .post("/api/v1/documents/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", docx, {
        filename: "notes.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    expect(res.status).toBe(200);
    expect(res.body.text.trim()).toBe(original);
  });

  it("rejects an unsupported file type with 415, not a garbled extraction attempt", async () => {
    const res = await request(app)
      .post("/api/v1/documents/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: "photo.png", contentType: "image/png" });
    expect(res.status).toBe(415);
    expect(res.body.error).toBe("unsupported_file_type");
  });

  it("returns a generic, honest error for a corrupt PDF — never a stack trace", async () => {
    const res = await request(app)
      .post("/api/v1/documents/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from("not actually a pdf"), { filename: "broken.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("extraction_failed");
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/at .*\.js:\d+/); // no stack-trace-shaped content
    expect(bodyText.toLowerCase()).not.toContain("error:");
  });

  it("rejects a request with no file", async () => {
    const res = await request(app).post("/api/v1/documents/extract").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("no_file");
  });

  it("rejects an oversized upload without crashing the server", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024, "a"); // over the route's 4MB cap
    const res = await request(app)
      .post("/api/v1/documents/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", big, { filename: "huge.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("file_too_large");
  });

  it("never echoes extracted document text back into a server error log field visible to the client", async () => {
    // The response body on success only ever contains {text}; on failure only a fixed
    // {error} code — there is no path that reflects file content into anything else.
    const original = "Private financial figures nobody else should see in a log.";
    const pdf = await buildPdfFixture(original);
    const res = await request(app)
      .post("/api/v1/documents/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", pdf, { filename: "private.pdf", contentType: "application/pdf" });
    expect(Object.keys(res.body)).toEqual(["text"]);
  });
});
