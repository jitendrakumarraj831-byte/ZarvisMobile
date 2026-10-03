import { describe, expect, it } from "vitest";
import { AIContentGenerator, createContentGenerator } from "../../src/ai/contentGenerator.js";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import type { AIProvider, AIRequest, AIResponse } from "../../src/ai/provider.js";
import { createModelGateway } from "../../src/ai/providerFactory.js";
import { SkillUserError } from "../../src/tooling/toolPipeline.js";
import { fakeEnv } from "./gatewayHarness.js";

const reply = (text: string): AIResponse => ({ message: { role: "assistant", content: text }, toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 } });

class Recording implements AIProvider {
  readonly id = "recording";
  requests: AIRequest[] = [];
  constructor(private readonly outcome: AIResponse | Error) {}
  async generate(request: AIRequest): Promise<AIResponse> {
    this.requests.push(request);
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
  async *streamGenerate(): AsyncIterable<never> {}
}

const MODEL = { provider: "gateway", model: "m" };
const failure = async (generator: AIContentGenerator, prompt = "p") => (await generator.generate(prompt).then(() => undefined, (e: unknown) => e)) as SkillUserError;

describe("AIContentGenerator reports provider failures the way web search does", () => {
  it.each([
    ["an exhausted quota", new AIProviderError("m", "AI_QUOTA_EXCEEDED", 429, false, undefined, "daily"), "ai_quota_exceeded", /usage limit for today/, false],
    ["a spent credit balance", new AIProviderError("m", "AI_QUOTA_EXCEEDED", 402, false, undefined, "credits"), "ai_quota_exceeded", /current AI usage limit/, false],
    ["a rate limit", new AIProviderError("m", "AI_RATE_LIMITED", 429, true, 4000, "per_minute"), "ai_rate_limited", /too many requests/, true],
    ["an outage", new AIProviderError("m", "AI_UNAVAILABLE", 503, true), "ai_provider_unavailable", /temporarily unavailable/, true],
    ["a timeout", new AIProviderError("m", "AI_UNAVAILABLE", 0, true, undefined, undefined, {}, { kind: "AI_PROVIDER_TIMEOUT" }), "ai_provider_unavailable", /temporarily unavailable/, true],
    ["a rejected key", new AIProviderError("m", "AI_UNAVAILABLE", 403, false), "ai_provider_unavailable", /temporarily unavailable/, false],
    ["a capability gap", new AIProviderError("m", "AI_UNAVAILABLE", 503, false, undefined, undefined, {}, { kind: "AI_PROVIDER_CAPABILITY_UNSUPPORTED" }), "ai_provider_unavailable", /capability that is not available/, false],
  ])("%s becomes a SkillUserError with an honest, safe message", async (_label, cause, reason, message, retryable) => {
    const error = await failure(new AIContentGenerator(new Recording(cause), MODEL, "system"));

    // The agent loop keys on this reason: an exhausted quota ends the turn, an outage is not re-run.
    expect(error).toBeInstanceOf(SkillUserError);
    expect(error.reason).toBe(reason);
    expect(error.userMessage).toMatch(message);
    expect(error.retryable).toBe(retryable);
    expect(error.userMessage).toContain("Nothing was charged");
  });

  it("does not disguise an application bug as an AI outage", async () => {
    const bug = new TypeError("cannot read x");
    expect(await failure(new AIContentGenerator(new Recording(bug), MODEL, "system"))).toBe(bug);
  });

  it("asks for plain generation, sends `requires` only when the skill has one, and trims the reply", async () => {
    const plain = new Recording(reply("  hello  "));
    expect(await new AIContentGenerator(plain, MODEL, "sys").generate("write")).toBe("hello");
    expect(plain.requests[0]).toMatchObject({ purpose: "generation", systemPrompt: "sys", messages: [{ role: "user", content: "write" }] });
    expect(plain.requests[0]).not.toHaveProperty("requires");
    expect(plain.requests[0]!.tools).toBeUndefined();

    const coding = new Recording(reply("code"));
    await new AIContentGenerator(coding, MODEL, "sys", ["coding"]).generate("implement");
    expect(coding.requests[0]!.requires).toEqual(["coding"]);
  });
});

describe("createContentGenerator", () => {
  const none = { geminiApiKey: undefined, openRouterApiKey: undefined };

  it("uses the labelled development placeholder with no provider (development) and fails closed in production", async () => {
    const dev = createContentGenerator(createModelGateway(fakeEnv(none), { isProduction: false }), "poem", "sys", { isProduction: false });
    expect(await dev.generate("monsoon")).toContain("[Mock poem");

    const prod = createContentGenerator(createModelGateway(fakeEnv(none), { isProduction: true }), "poem", "sys", { isProduction: true });
    await expect(prod.generate("monsoon")).rejects.toMatchObject({ reason: "ai_provider_unavailable", userMessage: expect.stringContaining("Nothing was generated or charged") });
  });

  it("follows the credentials actually present at call time, not those at construction", async () => {
    const env = fakeEnv(none);
    const gateway = createModelGateway(env, { isProduction: true });
    const generator = createContentGenerator(gateway, "poem", "sys", { isProduction: true });
    await expect(generator.generate("x")).rejects.toMatchObject({ reason: "ai_provider_unavailable" });

    // A key appears (as it does when a deployment is configured): the same generator now goes live.
    (env as { geminiApiKey?: string }).geminiApiKey = "gemini-late-key-123456";
    expect(gateway.hasLiveProvider()).toBe(true);
  });
});
