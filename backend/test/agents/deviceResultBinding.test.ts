import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { DEVICE_HANDOFF_RETENTION_MS } from "../../src/store/store.js";
import { harness, newGuest, STORES } from "../helpers/api.js";

/**
 * AUD-13: a phone result (POST /orchestrator/device-result) is accepted only for a phone action the planner handed over in that
 * conversation, for that action, and only once. A report can no longer invent an action or be repeated to add replies or plan steps.
 */
describe.each(STORES)("phone results are bound to the action handed over (%s)", (_name, makeStore) => {
  const PHONE = ["phone.open_app", "device.open_settings"];

  async function setUp() {
    const h = harness(makeStore());
    const guest = await newGuest(h.app);
    const auth = `Bearer ${guest.token}`;
    const turn = async (body: Record<string, unknown>) =>
      request(h.app).post("/api/v1/orchestrator/turn").set("Authorization", auth).send({ deviceActions: PHONE, ...body });
    const report = async (body: Record<string, unknown>) =>
      request(h.app).post("/api/v1/orchestrator/device-result").set("Authorization", auth).send(body);
    const history = async (conversationId: string) =>
      ((await request(h.app).get(`/api/v1/conversations/${conversationId}/messages`).set("Authorization", auth)).body.messages as Array<{ role: string; content: string }>)
        .map((m) => [m.role, m.content]);
    return { h, guest, turn, report, history };
  }

  function reportOf(turnBody: { conversationId: string; deviceAction: { toolCallId: string; skillId: string } }, extra: Record<string, unknown> = {}) {
    return {
      conversationId: turnBody.conversationId,
      toolCallId: turnBody.deviceAction.toolCallId,
      skillId: turnBody.deviceAction.skillId,
      status: "COMPLETED",
      message: "Opening Photos.",
      ...extra,
    };
  }

  it("records the one report of a handed-over action, and refuses the same report again", async () => {
    const { turn, report, history } = await setUp();
    const handed = (await turn({ utterance: "show me my gallery" })).body;

    const first = await report(reportOf(handed));
    const again = await report(reportOf(handed, { message: "Opening Photos again." }));

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ recorded: true });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("device_result_already_recorded");
    expect(await history(handed.conversationId)).toEqual([
      ["user", "show me my gallery"],
      ["assistant", "Opening Photos."],
    ]);
  });

  it("refuses a report for an action that was never handed over, and records nothing", async () => {
    const { turn, report, history } = await setUp();
    const handed = (await turn({ utterance: "show me my gallery" })).body;

    const invented = await report(reportOf(handed, { toolCallId: randomUUID(), message: "I transferred the money." }));

    expect(invented.status).toBe(404);
    expect(invented.body.code).toBe("unknown_device_action");
    expect(await history(handed.conversationId)).toEqual([["user", "show me my gallery"]]);
  });

  it("refuses a report that names another action, or another of the account's conversations", async () => {
    const { turn, report, history } = await setUp();
    const handed = (await turn({ utterance: "show me my gallery" })).body;
    const elsewhere = (await turn({ utterance: "open wifi settings" })).body;
    expect(elsewhere.conversationId).not.toBe(handed.conversationId);

    const otherAction = await report(reportOf(handed, { skillId: "device.open_settings" }));
    const otherChat = await report(reportOf(handed, { conversationId: elsewhere.conversationId }));

    expect(otherAction.status).toBe(404);
    expect(otherChat.status).toBe(404);
    expect(await history(elsewhere.conversationId)).toEqual([["user", "open wifi settings"]]);
    // The real report is still accepted afterwards.
    expect((await report(reportOf(handed))).status).toBe(200);
  });

  it("a repeated report never plans another phone step", async () => {
    const { turn, report } = await setUp();
    const handed = (await turn({ utterance: "open the clock app and then open settings" })).body;
    const continuing = reportOf(handed, { message: "Opening Clock.", continueWith: handed.deviceAction.then, step: 1, deviceActions: PHONE });

    const first = await report(continuing);
    const repeat = await report(continuing);

    expect(first.body.next.deviceAction).toMatchObject({ skillId: "device.open_settings" });
    expect(repeat.status).toBe(409);
    expect(repeat.body.next).toBeUndefined();
    // The next step is a handoff of its own, reported once.
    expect((await report(reportOf(first.body.next, { status: "USER_ACTION_REQUIRED", message: "I opened Settings." }))).status).toBe(200);
  });

  it("a replayed turn hands over the same action, which is still reported once", async () => {
    const { turn, report } = await setUp();
    const first = (await turn({ utterance: "show me my gallery", clientTurnId: "android-replay-0001" })).body;
    const replayed = (await turn({ utterance: "show me my gallery", clientTurnId: "android-replay-0001" })).body;

    expect(replayed.replayed).toBe(true);
    expect(replayed.deviceAction.toolCallId).toBe(first.deviceAction.toolCallId);
    expect((await report(reportOf(replayed))).status).toBe(200);
    expect((await report(reportOf(first))).status).toBe(409);
  });

  it("the store accepts a report only within the handoff's lifetime and only for its owner", async () => {
    const { h, guest } = await setUp();
    const other = await newGuest(h.app);
    const conversation = await h.store.createConversation(guest.accountId);
    const issuedAt = new Date("2026-10-23T10:00:00Z");
    const handoff = { toolCallId: randomUUID(), accountId: guest.accountId, conversationId: conversation.id, skillId: "phone.open_app", issuedAt };
    await h.store.recordDeviceHandoff(handoff);
    await h.store.recordDeviceHandoff({ ...handoff, skillId: "device.open_settings" }); // a replay records nothing new
    const report = { toolCallId: handoff.toolCallId, conversationId: conversation.id, skillId: "phone.open_app" };
    const later = new Date(issuedAt.getTime() + DEVICE_HANDOFF_RETENTION_MS + 1000);

    expect(await h.store.claimDeviceReport(guest.accountId, report, later, new Date(later.getTime() - DEVICE_HANDOFF_RETENTION_MS))).toBe("unknown");
    expect(await h.store.claimDeviceReport(other.accountId, report, issuedAt, new Date(0))).toBe("unknown");
    expect(await h.store.claimDeviceReport(guest.accountId, { ...report, conversationId: "not-a-uuid" }, issuedAt, new Date(0))).toBe("unknown");
    expect(await h.store.claimDeviceReport(guest.accountId, report, issuedAt, new Date(0))).toBe("claimed");
    expect(await h.store.claimDeviceReport(guest.accountId, report, issuedAt, new Date(0))).toBe("already_reported");
  });

  it("deleting the chat removes its handoffs", async () => {
    const { h, guest, turn, report } = await setUp();
    const handed = (await turn({ utterance: "show me my gallery" })).body;
    expect(await h.store.deleteConversation(guest.accountId, handed.conversationId)).toBe(true);

    const res = await report(reportOf(handed));

    expect(res.status).toBe(404);
    expect(await h.store.claimDeviceReport(
      guest.accountId,
      { toolCallId: handed.deviceAction.toolCallId, conversationId: handed.conversationId, skillId: "phone.open_app" },
      new Date(),
      new Date(0),
    )).toBe("unknown");
  });
});
