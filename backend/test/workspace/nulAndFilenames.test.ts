import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildDocxFixture } from "../documents/fixtures.js";
import { auth, harness, newGuest, STORES, type Guest, type Harness } from "../helpers/api.js";

/**
 * Regressions found by the audit of main after PR #95. On Postgres a NUL (U+0000) in any stored text was an HTTP 500
 * (`invalid byte sequence for encoding "UTF8": 0x00`); the in-memory store accepted it, so only the Postgres run of this suite fails
 * without the fix. And multipart file names were decoded as latin1, so a Hindi name was stored as mojibake.
 */
describe.each(STORES)("NUL bytes and file names (API, %s)", (_label, makeStore) => {
  let h: Harness;
  let me: Guest;

  beforeEach(async () => {
    h = harness(makeStore());
    me = await newGuest(h.app);
  });

  it("saves a note, task, project and file whose text contains NUL, with the NUL removed", async () => {
    const note = await request(h.app).post("/api/v1/notes").set(auth(me)).send({ kind: "memory", content: "a\u0000b" });
    expect(note.status).toBe(201);
    expect(note.body.content).toBe("ab");
    const task = await request(h.app).post("/api/v1/tasks").set(auth(me)).send({ goal: "do\u0000 it" });
    expect(task.status).toBe(201);
    expect(task.body.goal).toBe("do it");
    const project = await request(h.app).post("/api/v1/projects").set(auth(me)).send({ name: "P\u0000Q", goal: "g" });
    expect(project.status).toBe(201);
    expect(project.body.name).toBe("PQ");
    const file = await request(h.app).post("/api/v1/files/text").set(auth(me)).send({ name: "a\u0000b.txt", text: "x\u0000y", source: "upload" });
    expect(file.status).toBe(201);
    expect(file.body).toMatchObject({ name: "ab.txt", text: "xy" });
  });

  it("answers a chat turn whose text contains NUL instead of failing after the model call", async () => {
    const res = await request(h.app).post("/api/v1/orchestrator/turn").set(auth(me)).send({ utterance: "hello \u0000 there" });
    expect(res.status).toBe(200);
    expect(typeof res.body.message).toBe("string");
  });

  it("cleans NUL out of query strings too", async () => {
    const res = await request(h.app).get("/api/v1/files?projectId=a%00b").set(auth(me));
    expect(res.status).toBe(200);
  });

  it("keeps a Hindi or accented upload file name intact", async () => {
    const docx = await buildDocxFixture("नमस्ते hello");
    const type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    for (const name of ["रिपोर्ट.docx", "résumé.docx", "plain.docx"]) {
      const res = await request(h.app).post("/api/v1/files/upload").set(auth(me)).attach("file", docx, { filename: name, contentType: type });
      expect(res.status, name).toBe(201);
      expect(res.body.name).toBe(name);
    }
  });
});
