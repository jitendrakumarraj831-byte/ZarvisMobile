import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "../../src/workspace/limits.js";
import { buildDocxFixture, buildPdfFixture } from "../documents/fixtures.js";
import { auth, harness, newGuest, STORES, type Guest, type Harness } from "../helpers/api.js";

describe.each(STORES)("files (API, %s)", (_label, makeStore) => {
  let h: Harness;
  let me: Guest;

  beforeEach(async () => {
    h = harness(makeStore());
    me = await newGuest(h.app);
  });

  const saveText = (body: Record<string, unknown>, who: Guest = me) => request(h.app).post("/api/v1/files/text").set(auth(who)).send(body);

  it("needs a signed-in account", async () => {
    expect((await request(h.app).get("/api/v1/files")).status).toBe(401);
    expect((await request(h.app).post("/api/v1/files/upload")).status).toBe(401);
  });

  it("saves text, lists summaries without the text, and reads the text back", async () => {
    const saved = await saveText({ name: "notes.txt", text: "Line one\nLine two" });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ name: "notes.txt", kind: "text", source: "upload", textLength: 17, projectId: null });
    const list = await request(h.app).get("/api/v1/files").set(auth(me));
    expect(list.body.files).toHaveLength(1);
    expect(list.body.files[0]).not.toHaveProperty("text");
    expect(list.body.files[0].textLength).toBe(17);
    const one = await request(h.app).get(`/api/v1/files/${saved.body.id}`).set(auth(me));
    expect(one.body.text).toBe("Line one\nLine two");
  });

  it("saves a generated output as a markdown file", async () => {
    const saved = await saveText({ name: "Research report.md", text: "# Report\nFindings", source: "generated" });
    expect(saved.body).toMatchObject({ source: "generated", mimeType: "text/markdown" });
  });

  it("refuses empty text, over-long text and over-long names", async () => {
    expect((await saveText({ name: "a.txt", text: "   " })).status).toBe(400);
    expect((await saveText({ name: "", text: "x" })).status).toBe(400);
    expect((await saveText({ name: "x".repeat(LIMITS.fileName + 1), text: "x" })).status).toBe(400);
    const tooLong = await saveText({ name: "big.txt", text: "x".repeat(60_001) });
    expect(tooLong.status).toBe(413);
    expect(tooLong.body.code).toBe("document_too_long");
  });

  it("renames and moves a file between projects", async () => {
    const project = (await request(h.app).post("/api/v1/projects").set(auth(me)).send({ name: "Docs" })).body.id;
    const saved = (await saveText({ name: "a.txt", text: "hello" })).body;
    const moved = await request(h.app).patch(`/api/v1/files/${saved.id}`).set(auth(me)).send({ name: "renamed.txt", projectId: project });
    expect(moved.body).toMatchObject({ name: "renamed.txt", projectId: project, text: "hello" });
    expect((await request(h.app).get(`/api/v1/files?projectId=${project}`).set(auth(me))).body.files).toHaveLength(1);
    expect((await request(h.app).get("/api/v1/files?projectId=none").set(auth(me))).body.files).toHaveLength(0);
    const out = await request(h.app).patch(`/api/v1/files/${saved.id}`).set(auth(me)).send({ projectId: null });
    expect(out.body.projectId).toBeNull();
    expect((await request(h.app).patch(`/api/v1/files/${saved.id}`).set(auth(me)).send({ projectId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
  });

  it("deletes a file, and nobody else can read, change or delete it", async () => {
    const saved = (await saveText({ name: "private.txt", text: "secret" })).body;
    const stranger = await newGuest(h.app);
    expect((await request(h.app).get(`/api/v1/files/${saved.id}`).set(auth(stranger))).status).toBe(404);
    expect((await request(h.app).patch(`/api/v1/files/${saved.id}`).set(auth(stranger)).send({ name: "x" })).status).toBe(404);
    expect((await request(h.app).delete(`/api/v1/files/${saved.id}`).set(auth(stranger))).status).toBe(404);
    expect((await request(h.app).get("/api/v1/files").set(auth(stranger))).body.files).toEqual([]);
    expect((await request(h.app).delete(`/api/v1/files/${saved.id}`).set(auth(me))).status).toBe(204);
    expect((await request(h.app).get(`/api/v1/files/${saved.id}`).set(auth(me))).status).toBe(404);
    expect((await request(h.app).get("/api/v1/files/not-a-uuid").set(auth(me))).status).toBe(404);
  });

  it("extracts a real PDF and a real DOCX and stores the text only after extraction worked", async () => {
    const pdf = await request(h.app).post("/api/v1/files/upload").set(auth(me)).attach("file", await buildPdfFixture("Quarterly revenue grew twelve percent."), { filename: "report.pdf", contentType: "application/pdf" });
    expect(pdf.status).toBe(201);
    expect(pdf.body).toMatchObject({ name: "report.pdf", kind: "document", source: "upload" });
    expect(pdf.body.text.replace(/\s+/g, " ").trim()).toBe("Quarterly revenue grew twelve percent.");
    const docx = await request(h.app).post("/api/v1/files/upload").set(auth(me)).attach("file", await buildDocxFixture("Meeting notes."), {
      filename: "notes.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(docx.status).toBe(201);
    expect((await request(h.app).get("/api/v1/files").set(auth(me))).body.files).toHaveLength(2);
  });

  it("stores nothing when the file can't be read, and says why", async () => {
    const corrupt = await request(h.app).post("/api/v1/files/upload").set(auth(me)).attach("file", Buffer.from("not a pdf"), { filename: "bad.pdf", contentType: "application/pdf" });
    expect(corrupt.status).toBe(422);
    expect(corrupt.body.error).toBe("extraction_failed");
    const exe = await request(h.app).post("/api/v1/files/upload").set(auth(me)).attach("file", Buffer.from("MZ"), { filename: "tool.exe", contentType: "application/octet-stream" });
    expect(exe.status).toBe(415);
    expect((await request(h.app).post("/api/v1/files/upload").set(auth(me))).body.error).toBe("no_file");
    const image = await request(h.app).post("/api/v1/files/upload").set(auth(me)).attach("file", Buffer.from("png"), { filename: "pic.png", contentType: "image/png" });
    expect(image.status).toBe(503); // no vision model configured in tests: said plainly, nothing stored
    expect(image.body.error).toBe("image_analysis_unavailable");
    expect((await request(h.app).get("/api/v1/files").set(auth(me))).body.files).toEqual([]);
  });

  it("caps the number of saved files", async () => {
    for (let i = 0; i < LIMITS.maxFiles; i += 1) {
      await h.store.createFile({ id: crypto.randomUUID(), accountId: me.accountId, name: "f" + i, mimeType: "text/plain", kind: "text", source: "upload", sizeBytes: 1, text: "x", createdAt: new Date() });
    }
    const res = await saveText({ name: "one-too-many.txt", text: "x" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("limit_reached");
  });
});
