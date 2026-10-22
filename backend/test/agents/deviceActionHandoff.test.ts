import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, type TurnRequest } from "../../src/agents/orchestrator.js";
import type { AIProvider, AIRequest, AIResponse } from "../../src/ai/provider.js";
import type { ModelGateway } from "../../src/ai/modelGateway.js";
import { DEVICE_ACTIONS, deviceActionTools, sanitizeDeviceInput } from "../../src/capabilities/deviceActions.js";
import { deviceCapabilitiesForPrompt } from "../../src/capabilities/registry.js";
import { buildContainer } from "../../src/container.js";
import { MockGitHubClient } from "../../src/github/githubClient.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";

/**
 * Brain → device handoff (ZARVIS_ASSISTANT_UPGRADE_PLAN.md Phase 6). The Android app lists the phone actions it runs;
 * the planner may hand one to it instead of describing manual steps. The server never runs it: the turn returns
 * `deviceAction`, the phone runs it with its own permission and confirmation flow, and reports the real result.
 */

/** A planner that calls the tools it is told to, and records what it was offered. */
function scriptedPlanner(steps: Array<{ skillId: string; input: Record<string, unknown> } | { text: string }>) {
  const requests: AIRequest[] = [];
  let index = 0;
  const provider: AIProvider & { defaultModelConfig(): { provider: string; model: string } } = {
    id: "scripted",
    defaultModelConfig: () => ({ provider: "scripted", model: "scripted-v1" }),
    async generate(req): Promise<AIResponse> {
      requests.push(req);
      const step = steps[Math.min(index, steps.length - 1)]!;
      index += 1;
      const usage = { promptTokens: 1, completionTokens: 1 };
      if ("text" in step) return { message: { role: "assistant", content: step.text }, toolCalls: [], usage };
      return { message: { role: "assistant", content: "" }, toolCalls: [{ id: `call-${index}`, skillId: step.skillId, input: step.input }], usage };
    },
    async *streamGenerate() {
      yield { delta: "", done: true };
    },
  };
  return { gateway: provider as unknown as ModelGateway, requests };
}

const PHONE = ["phone.open_app", "phone.call", "device.open_settings", "alarm.set"];

async function turn(extra: Partial<TurnRequest>, steps: Parameters<typeof scriptedPlanner>[0]) {
  const planner = scriptedPlanner(steps);
  const store = new InMemoryStore();
  const container = buildContainer(store, { modelGateway: planner.gateway, githubClientFactory: (token) => new MockGitHubClient({ token }) });
  const user = await store.createUser("phone@example.com", "x");
  const account = await store.createAccountForUser(user.id);
  const result = await container.orchestrator.runTurn({ accountId: account.id, utterance: "WhatsApp kholo", locale: "en", ...extra });
  return { result, planner, store, account };
}

describe("the phone actions catalogue", () => {
  it("offers only the actions the client lists, described by the server", () => {
    const tools = deviceActionTools(["phone.open_app", "phone.call", "made.up", "phone.open_app"]);
    expect(tools.map((tool) => tool.name)).toEqual(["phone.open_app", "phone.call"]);
    for (const tool of tools) expect(tool.description.startsWith("On this phone")).toBe(true);
    expect(deviceActionTools(undefined)).toEqual([]);
    expect(deviceActionTools([])).toEqual([]);
  });

  it("matches the Android skills' required inputs", () => {
    // android/domain/.../skill/*: the phone's ToolPipeline refuses a call without these fields.
    const required = Object.fromEntries(DEVICE_ACTIONS.map((action) => [action.id, action.inputSchema.requiredFields]));
    expect(required["phone.open_app"]).toEqual(["appName"]);
    expect(required["phone.call"]).toEqual(["target"]);
    expect(required["phone.find_contact"]).toEqual(["name"]);
    expect(required["personal.reminder"]).toEqual(["action"]);
    expect(required["device.open_settings"]).toEqual(["panel"]);
    expect(required["alarm.set"]).toEqual(["utterance"]);
    expect(required["device.global_action"]).toEqual(["action"]);
    expect(required["screen.tap"]).toEqual(["label"]);
  });

  it("passes on only the declared fields, as trimmed strings", () => {
    const call = DEVICE_ACTIONS.find((action) => action.id === "phone.call")!;
    expect(sanitizeDeviceInput(call, { target: 9876543210, confirmed: true, extra: "x" })).toEqual({ target: "9876543210" });
    expect(sanitizeDeviceInput(call, { target: "  Mom  " })).toEqual({ target: "Mom" });
    expect(sanitizeDeviceInput(call, { target: { nested: 1 } })).toEqual({});
  });
});

describe("the planner is told to act on the phone, not to explain", () => {
  const base: TurnRequest = { accountId: "a", utterance: "gallery kholo", locale: "en" };

  it("with phone actions offered, it calls them instead of giving manual steps", () => {
    const prompt = buildSystemPrompt(base, 0, false, { phoneActionsOffered: true });
    expect(prompt).toContain(deviceCapabilitiesForPrompt(true));
    expect(prompt).toContain("instead of explaining manual steps");
    expect(prompt).not.toContain(deviceCapabilitiesForPrompt(false));
  });

  it("without them (the web), it still never claims a phone action", () => {
    const prompt = buildSystemPrompt(base, 0, false);
    expect(prompt).toContain(deviceCapabilitiesForPrompt(false));
    expect(prompt).toContain("never by you");
  });
});

describe("a turn that hands a phone action to the client", () => {
  it("returns the action instead of running it, and records no reply yet", async () => {
    const { result, planner, store, account } = await turn({ deviceActions: PHONE }, [{ skillId: "phone.open_app", input: { appName: "WhatsApp", note: "ignored" } }]);

    expect(planner.requests[0]!.tools!.map((tool) => tool.name)).toEqual(expect.arrayContaining(PHONE));
    expect(planner.requests[0]!.systemPrompt).toContain(deviceCapabilitiesForPrompt(true));
    expect(result.deviceAction).toMatchObject({ skillId: "phone.open_app", input: { appName: "WhatsApp" } });
    expect(result.deviceAction!.toolCallId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.toolCalls).toEqual([]);
    // The phone reports the real outcome; nothing is stored as the answer before that.
    const messages = await store.listConversationMessages(account.id, result.conversationId, 10);
    expect(messages.map((message) => message.role)).toEqual(["user"]);
  });

  it("does not offer phone actions the client did not list", async () => {
    const { result, planner } = await turn({ deviceActions: ["alarm.set"] }, [{ skillId: "phone.call", input: { target: "Mom" } }, { text: "I can't call from here." }]);
    expect(planner.requests[0]!.tools!.map((tool) => tool.name)).not.toContain("phone.call");
    expect(result.deviceAction).toBeUndefined();
    expect(result.message).toBe("I can't call from here.");
  });

  it("offers none to a client that runs none (the web)", async () => {
    const { result, planner } = await turn({}, [{ skillId: "phone.open_app", input: { appName: "WhatsApp" } }, { text: "Open WhatsApp from your home screen." }]);
    expect(planner.requests[0]!.tools!.map((tool) => tool.name)).not.toContain("phone.open_app");
    expect(result.deviceAction).toBeUndefined();
  });

  it("offers none to an agent's turn, which sees only that agent's skills", async () => {
    const { planner } = await turn({ deviceActions: PHONE, agentId: "research" }, [{ text: "ok" }]);
    expect(planner.requests[0]!.tools!.map((tool) => tool.name)).not.toContain("phone.open_app");
  });
});

describe("POST /api/v1/orchestrator/turn and /device-result", () => {
  async function app() {
    const server = buildServer({ ...buildContainer(new InMemoryStore()), ttsProvider: null });
    const token = (await request(server).post("/api/v1/auth/guest").send({})).body.accessToken as string;
    return { server, auth: `Bearer ${token}` };
  }

  it("the development planner hands \"show me my gallery\" to the phone, and the phone's result becomes the reply", async () => {
    const { server, auth } = await app();
    const turnRes = await request(server).post("/api/v1/orchestrator/turn").set("Authorization", auth)
      .send({ utterance: "show me my gallery", deviceActions: ["phone.open_app", "device.open_settings", "not.a.thing"] });
    expect(turnRes.status).toBe(200);
    expect(turnRes.body.deviceAction).toMatchObject({ skillId: "phone.open_app", input: { appName: "gallery" } });

    const report = await request(server).post("/api/v1/orchestrator/device-result").set("Authorization", auth).send({
      conversationId: turnRes.body.conversationId,
      toolCallId: turnRes.body.deviceAction.toolCallId,
      skillId: "phone.open_app",
      status: "COMPLETED",
      message: "Opening Photos.",
    });
    expect(report.status).toBe(200);
    const history = await request(server).get(`/api/v1/conversations/${turnRes.body.conversationId}/messages`).set("Authorization", auth);
    expect(history.body.messages.map((message: { role: string; content: string }) => [message.role, message.content])).toEqual([
      ["user", "show me my gallery"],
      ["assistant", "Opening Photos."],
    ]);
  });

  it("ordinary chat from the phone is not turned into a phone action", async () => {
    const { server, auth } = await app();
    const res = await request(server).post("/api/v1/orchestrator/turn").set("Authorization", auth)
      .send({ utterance: "Write a short product description", deviceActions: DEVICE_ACTIONS.map((action) => action.id) });
    expect(res.status).toBe(200);
    expect(res.body.deviceAction).toBeUndefined();
  });

  it("records a result only in the caller's own conversation, for a known action, with a real status and text", async () => {
    const { server, auth } = await app();
    const other = await app();
    const turnRes = await request(server).post("/api/v1/orchestrator/turn").set("Authorization", auth).send({ utterance: "open wifi settings", deviceActions: PHONE });
    const body = { conversationId: turnRes.body.conversationId, toolCallId: "t-1", skillId: "device.open_settings", status: "USER_ACTION_REQUIRED", message: "I opened Wi-Fi settings." };

    const otherAccount = await request(other.server).post("/api/v1/orchestrator/device-result").set("Authorization", other.auth).send(body);
    expect(otherAccount.status).toBe(404);
    for (const bad of [
      { ...body, skillId: "system.delete_everything" },
      { ...body, status: "DONE" },
      { ...body, message: "   " },
      { ...body, conversationId: undefined },
      { ...body, toolCallId: "" },
    ]) {
      const res = await request(server).post("/api/v1/orchestrator/device-result").set("Authorization", auth).send(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    const ok = await request(server).post("/api/v1/orchestrator/device-result").set("Authorization", auth).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ recorded: true });
  });
});
