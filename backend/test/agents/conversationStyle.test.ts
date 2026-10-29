import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSystemPrompt, Orchestrator, REPLY_LENGTH_GUIDANCE, type TurnRequest } from "../../src/agents/orchestrator.js";
import {
  CONVERSATION_STYLE,
  fallbackReply,
  greetingReply,
  MEMORY_HONESTY,
  VOICE_REPLY_STYLE,
} from "../../src/agents/conversationStyle.js";
import type { AIProvider, AIRequest, AIResponse } from "../../src/ai/provider.js";
import { createModelGateway } from "../../src/ai/providerFactory.js";
import { buildContainer } from "../../src/container.js";
import { ServerConfirmationService } from "../../src/security/confirmationService.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import type { EntitlementPort } from "../../src/tooling/ports.js";
import { SkillRegistry } from "../../src/tooling/skillRegistry.js";
import { ToolPipeline } from "../../src/tooling/toolPipeline.js";
import { fakeEnv, geminiText, stubProviders, type RecordedCall } from "../ai/gatewayHarness.js";

/**
 * How ZARVIS talks: natural and brief by default, in the user's language and script, aware of the conversation it is in
 * (no second greeting, no "ok" answered in another language), honest about what it remembers, and written to be heard
 * when the user spoke. None of it changes a rule about tools or honesty.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const turn = (extra: Partial<TurnRequest> = {}): TurnRequest => ({ accountId: "a", utterance: "explain how rivers form", locale: "en", ...extra });

describe("buildSystemPrompt: the conversational instructions", () => {
  it("carries the style and the memory honesty rule on every step, next to the unchanged tool honesty rule", () => {
    for (const prompt of [buildSystemPrompt(turn(), 0, false), buildSystemPrompt(turn(), 3, true)]) {
      expect(prompt).toContain(CONVERSATION_STYLE);
      expect(prompt).toContain(MEMORY_HONESTY);
      expect(prompt).toContain("Never claim an action happened unless a tool result confirms it");
    }
  });

  it("answers in the user's own script: Hinglish in Latin letters, Hindi in Devanagari", () => {
    const hinglish = buildSystemPrompt(turn({ utterance: "kal ka weather kaisa rahega" }), 0, false);
    expect(hinglish).toContain("Respond in Hindi/Hinglish");
    expect(hinglish).toContain("Roman (Latin) script");
    const hindi = buildSystemPrompt(turn({ utterance: "आज मौसम कैसा है" }), 0, false);
    expect(hindi).toContain("Respond in Hindi/Hinglish");
    expect(hindi).toContain("Devanagari script");
    expect(buildSystemPrompt(turn(), 0, false)).toContain("Respond in English");
  });

  it("uses the conversation's language when it is given one, and a language the user asks for wins", () => {
    const prompt = buildSystemPrompt(turn({ utterance: "ok" }), 0, false, { language: "hinglish" });
    expect(prompt).toContain("Respond in Hindi/Hinglish");
    expect(prompt).not.toContain("Respond in English");
    // "English please" is too short to switch on its own; the planner is told to honour such a request.
    expect(prompt).toMatch(/when the user asks for a particular language \('English please', 'Hindi mein batao'\), use that language/);
  });

  it("does not greet or introduce itself again in a conversation that is under way, even on a client's first turn", () => {
    const underway = buildSystemPrompt(turn({ isFirstTurn: true }), 0, false, { conversationUnderway: true });
    expect(underway).toMatch(/already under way: do not greet the user again or re-introduce yourself/);
    expect(underway).not.toMatch(/give a short polished ZARVIS welcome/);

    const fresh = buildSystemPrompt(turn({ isFirstTurn: true }), 0, false, { conversationUnderway: false });
    expect(fresh).toMatch(/start of a conversation/);
    expect(fresh).toMatch(/give a short polished ZARVIS welcome/);
  });

  it("writes for the ear only when the user spoke", () => {
    expect(buildSystemPrompt(turn({ inputMode: "voice" }), 0, false)).toContain(VOICE_REPLY_STYLE);
    expect(buildSystemPrompt(turn(), 0, false)).not.toContain(VOICE_REPLY_STYLE);
  });

  it("puts the user's answer-length preference after the general style, so the preference holds", () => {
    const prompt = buildSystemPrompt(turn({ replyLength: "detailed" }), 0, false);
    expect(prompt.indexOf(REPLY_LENGTH_GUIDANCE.detailed)).toBeGreaterThan(prompt.indexOf(CONVERSATION_STYLE));
  });

  it("asks for natural replies and forbids invented feelings and memories", () => {
    expect(CONVERSATION_STYLE).toMatch(/one to three sentences/);
    expect(CONVERSATION_STYLE).toMatch(/Never ask again for something the user already told you/);
    expect(CONVERSATION_STYLE).toMatch(/at most one/);
    expect(CONVERSATION_STYLE).toMatch(/Do not claim human feelings/);
    expect(MEMORY_HONESTY).toMatch(/Never claim to remember something that is not there/);
    expect(MEMORY_HONESTY).toMatch(/cannot save anything to memory yourself/);
  });
});

describe("greetingReply", () => {
  it("is only for a message that is just a greeting", () => {
    expect(greetingReply("hi, can you search the weather", "en", [])).toBeUndefined();
    expect(greetingReply("hello", "en", [])).toBeDefined();
  });

  it("does not introduce ZARVIS again later in a conversation, and alternates its wording", () => {
    const first = greetingReply("hi", "hinglish", ["Namaste! 👋 Main ZARVIS hoon."])!;
    const second = greetingReply("hi", "hinglish", ["Namaste! 👋 Main ZARVIS hoon.", first])!;
    expect(first).not.toMatch(/ZARVIS/);
    expect(second).not.toBe(first);
    expect(greetingReply("namaste", "hi", ["कुछ भी"])).toBe("फिर से नमस्ते! अब क्या करना है?");
  });
});

/** Plays back a fixed list of model responses and records every call it receives. */
class ScriptedProvider implements AIProvider {
  readonly id = "scripted";
  readonly requests: AIRequest[] = [];
  constructor(private readonly script: AIResponse[]) {}
  async generate(request: AIRequest): Promise<AIResponse> {
    this.requests.push(request);
    return this.script.shift() ?? reply("done");
  }
  async *streamGenerate(): AsyncIterable<never> {}
}

function reply(text: string): AIResponse {
  return { message: { role: "assistant", content: text }, toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 } };
}

async function setup(provider: AIProvider) {
  const store = new InMemoryStore();
  const registry = new SkillRegistry();
  const entitlement: EntitlementPort = { snapshot: async () => ({ accountId: "a", plan: "PRO", trialExpiresAt: null, creditBalance: 100 }) };
  const pipeline = new ToolPipeline(registry, { isGranted: async () => true }, entitlement, { charge: vi.fn(async () => 0) }, new ServerConfirmationService(store));
  const orchestrator = new Orchestrator(registry, entitlement, pipeline, provider, { provider: "scripted", model: "m" }, store);
  const user = await store.createUser(`style-${Math.random()}@test.dev`, "x");
  const account = await store.createAccountForUser(user.id);
  return { orchestrator, accountId: account.id };
}

describe("the orchestrator keeps the conversation in mind", () => {
  it("a short follow-up in a Hinglish chat keeps Hinglish, and the planner knows the chat is under way", async () => {
    const provider = new ScriptedProvider([reply("Kal Forbesganj mein halki baarish ho sakti hai."), reply("Theek hai!")]);
    const { orchestrator, accountId } = await setup(provider);

    const first = await orchestrator.runTurn({ accountId, utterance: "kal Forbesganj ka weather kaisa rahega", locale: "en" });
    expect(provider.requests[0]!.systemPrompt).toMatch(/start of a conversation/);

    await orchestrator.runTurn({ accountId, utterance: "ok thanks", locale: "en", conversationId: first.conversationId });
    const followUp = provider.requests[1]!;
    expect(followUp.systemPrompt).toContain("Roman (Latin) script");
    expect(followUp.systemPrompt).not.toContain("Respond in English");
    expect(followUp.systemPrompt).toMatch(/already under way/);
    // The earlier exchange is in front of the model, so "ok thanks" is read against it.
    expect(followUp.messages.map((message) => message.content)).toEqual([
      "kal Forbesganj ka weather kaisa rahega",
      "Kal Forbesganj mein halki baarish ho sakti hai.",
      "ok thanks",
    ]);
  });

  it("says it could not answer in the user's language, not always in English", async () => {
    const { orchestrator, accountId } = await setup(new ScriptedProvider([reply(""), reply(""), reply("")]));
    expect((await orchestrator.runTurn({ accountId, utterance: "आज मौसम कैसा है" })).message).toBe(fallbackReply("no_reply", "hi"));
    expect((await orchestrator.runTurn({ accountId, utterance: "aaj mausam kaisa hai" })).message).toBe(fallbackReply("no_reply", "hinglish"));
    expect((await orchestrator.runTurn({ accountId, utterance: "what is the weather today" })).message).toBe("I couldn't produce a response. Please try again.");
  });
});

describe("POST /api/v1/orchestrator/turn with inputMode", () => {
  const systemText = (call: RecordedCall): string => call.body?.systemInstruction?.parts?.[0]?.text ?? "";

  async function send(inputMode: unknown) {
    const stub = stubProviders({ gemini: geminiText("Rivers start as rain.") });
    const gateway = createModelGateway(fakeEnv({ openRouterApiKey: undefined }), { isProduction: true });
    const app = buildServer({ ...buildContainer(new InMemoryStore(), { modelGateway: gateway }), ttsProvider: null });
    const token = (await request(app).post("/api/v1/auth/guest").send({})).body.accessToken as string;
    const res = await request(app).post("/api/v1/orchestrator/turn").set("Authorization", `Bearer ${token}`).send({ utterance: "explain how rivers form", inputMode });
    return { res, prompts: stub.gemini.map(systemText) };
  }

  it("a spoken message reaches the model's instructions as one to be heard", async () => {
    const { res, prompts } = await send("voice");
    expect(res.status).toBe(200);
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.every((text) => text.includes(VOICE_REPLY_STYLE))).toBe(true);
  });

  it.each([["text"], ["VOICE"], [1], [null]])("%s is a typed message, not an error", async (value) => {
    const { res, prompts } = await send(value);
    expect(res.status).toBe(200);
    for (const text of prompts) expect(text).not.toContain(VOICE_REPLY_STYLE);
  });
});
