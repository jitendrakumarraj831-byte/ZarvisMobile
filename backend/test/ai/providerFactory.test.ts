import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  }
  vi.resetModules();
});

describe("providerFactory", () => {
  it("defaults to MockAIProvider with no ANTHROPIC_API_KEY configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.resetModules();
    const { defaultModelConfig, getProvider } = await import("../../src/ai/providerFactory.js");

    expect(defaultModelConfig.provider).toBe("mock");
    expect(getProvider(defaultModelConfig).id).toBe("mock");
  });

  it("switches to AnthropicAIProvider automatically once ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    vi.resetModules();
    const { defaultModelConfig, getProvider } = await import("../../src/ai/providerFactory.js");

    expect(defaultModelConfig.provider).toBe("anthropic");
    expect(getProvider(defaultModelConfig).id).toBe("anthropic");
  });
});
