import { afterEach, describe, expect, it, vi } from "vitest";
import { getModelGateway, resetModelGatewayForTests } from "../../src/ai/providerFactory.js";
import { env } from "../../src/config/env.js";
import { buildContainer } from "../../src/container.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";

/**
 * The real startup path: the container build creates the process-wide gateway from `env`, which
 * validates every AI setting. A bad value must stop the server with a clear, secret-free reason
 * (the Vercel entrypoint turns that into `/health` `ai_provider_config_invalid`); an absent
 * credential must not.
 */
const original = { ...env };
afterEach(() => {
  Object.assign(env, original);
  resetModelGatewayForTests();
  vi.restoreAllMocks();
});

describe("startup validation of the AI configuration", () => {
  it("buildContainer refuses to start with an invalid setting, and the reason names the variable, not its value", () => {
    env.aiPrimaryProvider = "sk-or-v1-NOTAPROVIDERBUTAKEY0000";
    resetModelGatewayForTests();

    let reason = "";
    try {
      buildContainer(new InMemoryStore());
    } catch (error) {
      reason = (error as Error).message;
    }

    expect(reason).toMatch(/^Invalid AI configuration: AI_PRIMARY_PROVIDER/);
    expect(reason).not.toContain("NOTAPROVIDERBUTAKEY");
  });

  it("an unreachable-looking OpenRouter address is rejected before it can receive a key", () => {
    env.openRouterBaseUrl = "http://attacker.example/v1";
    resetModelGatewayForTests();
    expect(() => buildContainer(new InMemoryStore())).toThrow(/OPENROUTER_BASE_URL must use https/);
  });

  it("missing credentials are not a startup error: the server starts and reports the AI as unavailable", () => {
    env.geminiApiKey = undefined;
    env.openRouterApiKey = undefined;
    resetModelGatewayForTests();

    const container = buildContainer(new InMemoryStore());

    // Development/test: the labelled mock; production would be "none" (covered in modelGateway.test.ts).
    expect(container.modelGateway.healthSummary()).toEqual({ provider: "mock", fallback: false });
  });

  it("the process-wide gateway is built once and shared", () => {
    resetModelGatewayForTests();
    expect(getModelGateway()).toBe(getModelGateway());
  });

  it("the startup line a real server writes is complete: nothing in it is redacted by accident", () => {
    // Asserted on the real console output, after redaction: a field whose name contains "token"
    // would otherwise be replaced by [REDACTED] and the operator would lose that information.
    const written: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      written.push(String(args[0]));
    });
    env.geminiApiKey = "gemini-startup-key-123456";
    env.openRouterApiKey = "sk-or-v1-startupkey000000000000000";
    resetModelGatewayForTests();

    getModelGateway();

    const line = written.find((entry) => entry.includes("AI gateway ready"))!;
    expect(line).toBeDefined();
    expect(line).not.toContain("[REDACTED]");
    expect(line).toContain('"contextWindow":32768'); // the OpenRouter model's declared context
    expect(line).toContain('"contextWindow":1000000'); // Gemini's
    expect(line).not.toContain("startup-key");
    expect(line).not.toContain("startupkey");
  });

  it("OpenRouter alone is a valid configuration, and it becomes the default provider", () => {
    env.geminiApiKey = undefined;
    env.openRouterApiKey = "sk-or-v1-startuptestkey000000000000";
    resetModelGatewayForTests();

    expect(buildContainer(new InMemoryStore()).modelGateway.healthSummary()).toEqual({ provider: "openrouter", fallback: false });
  });
});
