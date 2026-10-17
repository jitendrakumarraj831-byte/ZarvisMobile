import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSystemPrompt, REPLY_LENGTH_GUIDANCE, type TurnRequest } from "../../src/agents/orchestrator.js";
import { createModelGateway } from "../../src/ai/providerFactory.js";
import { buildContainer } from "../../src/container.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { fakeEnv, geminiText, stubProviders, type RecordedCall } from "../ai/gatewayHarness.js";

/**
 * The "Answer length" setting: the client sends `replyLength`, and the planner is told the user's preference. "Balanced"
 * (the default) adds nothing, and an unknown value is ignored rather than refused: it is a preference, not a command.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const turn = (extra: Partial<TurnRequest> = {}): TurnRequest => ({ accountId: "a", utterance: "explain how rivers form", locale: "en", ...extra });

describe("buildSystemPrompt and the answer length", () => {
  it("tells the planner the user's preference for short or detailed answers", () => {
    expect(buildSystemPrompt(turn({ replyLength: "short" }), 0, false)).toContain(REPLY_LENGTH_GUIDANCE.short);
    expect(buildSystemPrompt(turn({ replyLength: "detailed" }), 0, false)).toContain(REPLY_LENGTH_GUIDANCE.detailed);
  });

  it("adds nothing for the normal length", () => {
    const prompt = buildSystemPrompt(turn(), 0, false);
    expect(prompt).not.toContain(REPLY_LENGTH_GUIDANCE.short);
    expect(prompt).not.toContain(REPLY_LENGTH_GUIDANCE.detailed);
  });

  it("keeps the preference on every step of the turn, after tools too", () => {
    expect(buildSystemPrompt(turn({ replyLength: "short" }), 2, true)).toContain(REPLY_LENGTH_GUIDANCE.short);
  });
});

describe("POST /api/v1/orchestrator/turn with replyLength", () => {
  const systemText = (call: RecordedCall): string => call.body?.systemInstruction?.parts?.[0]?.text ?? "";

  async function send(replyLength: unknown) {
    const stub = stubProviders({ gemini: geminiText("Rivers start as rain.") });
    const gateway = createModelGateway(fakeEnv({ openRouterApiKey: undefined }), { isProduction: true });
    const app = buildServer({ ...buildContainer(new InMemoryStore(), { modelGateway: gateway }), ttsProvider: null });
    const token = (await request(app).post("/api/v1/auth/guest").send({})).body.accessToken as string;
    const res = await request(app).post("/api/v1/orchestrator/turn").set("Authorization", `Bearer ${token}`).send({ utterance: "explain how rivers form", replyLength });
    return { res, prompts: stub.gemini.map(systemText) };
  }

  it("reaches the model's instructions", async () => {
    const { res, prompts } = await send("short");
    expect(res.status).toBe(200);
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.every((text) => text.includes(REPLY_LENGTH_GUIDANCE.short))).toBe(true);
  });

  it.each([["balanced"], ["verbose"], [42], [null]])("%s is the normal length, not an error", async (value) => {
    const { res, prompts } = await send(value);
    expect(res.status).toBe(200);
    for (const text of prompts) {
      expect(text).not.toContain(REPLY_LENGTH_GUIDANCE.short);
      expect(text).not.toContain(REPLY_LENGTH_GUIDANCE.detailed);
    }
  });
});
