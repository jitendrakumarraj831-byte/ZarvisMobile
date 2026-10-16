import { describe, expect, it } from "vitest";
import { requirementsFor } from "../../src/ai/capabilities.js";
import { chooseEntry, missingCapabilities, openRouterEntry, parseCatalogJson } from "../../src/ai/modelCatalog.js";
import { createModelGateway } from "../../src/ai/providerFactory.js";
import { resolveAIConfig, type AIConfigInput } from "../../src/config/aiConfig.js";
import { AIConfigError } from "../../src/config/aiConfigError.js";
import { fakeEnv } from "../ai/gatewayHarness.js";

const base: AIConfigInput = { geminiModel: "gemini-3.6-flash" };
const problemsOf = (input: Partial<AIConfigInput>): string[] => {
  try {
    resolveAIConfig({ ...base, ...input });
  } catch (error) {
    if (error instanceof AIConfigError) return error.problems;
    throw error;
  }
  return [];
};

describe("resolveAIConfig defaults", () => {
  it("prefers Groq, then OpenRouter, then Gemini, then OpenAI, and declares only text and streaming for the OpenRouter model", () => {
    const config = resolveAIConfig(base);
    expect(config.preferredPrimary).toBe("groq");
    expect(config.preferredFallback).toBe("openrouter");
    expect(config.preferredFallbacks).toEqual(["openrouter", "google", "openai"]);
    // Discovery is on by default; nothing that costs money or limits a request is set until the operator asks.
    expect(config.openRouter).toEqual({ baseUrl: "https://openrouter.ai/api/v1", timeoutMs: 60_000, discovery: true, fallbackModels: [], allowPaid: false });
    expect(config.quotaCooldownMs).toBe(300_000);
    expect(config.warnings).toEqual([]);

    const openRouter = config.catalog.find((entry) => entry.provider === "openrouter")!;
    expect(openRouter).toMatchObject({ model: "openrouter/free", free: true, enabled: true, contextTokens: 32_768, imageMimeTypes: [] });
    // Nothing is assumed: a free model may not call tools, read images or return enforced JSON.
    expect(openRouter.capabilities).toEqual({ text: true, streaming: true, tools: false, vision: false, structuredOutput: false, longContext: false, coding: false, reasoning: false });
  });

  it("declares tool calling for Groq's default production model, on Groq's endpoint", () => {
    const config = resolveAIConfig(base);
    expect(config.groq).toEqual({ baseUrl: "https://api.groq.com/openai/v1", timeoutMs: 60_000, model: "openai/gpt-oss-120b" });
    const groq = config.catalog.find((entry) => entry.provider === "groq")!;
    expect(groq).toMatchObject({ model: "openai/gpt-oss-120b", enabled: true, contextTokens: 131_072, imageMimeTypes: [] });
    expect(groq.capabilities).toMatchObject({ text: true, streaming: true, tools: true, vision: false, longContext: true });
  });

  it("takes the Groq model, its capabilities and limits from GROQ_* settings", () => {
    const config = resolveAIConfig({
      ...base,
      groqModel: " qwen/qwen3.6-27b ",
      groqModelCapabilities: "tools,structuredOutput",
      groqModelContextTokens: "65536",
      groqTimeoutMs: "20000",
      groqMaxOutputTokens: "2048",
    });
    expect(config.groq).toEqual({ baseUrl: "https://api.groq.com/openai/v1", timeoutMs: 20_000, model: "qwen/qwen3.6-27b", maxOutputTokens: 2048 });
    const groq = config.catalog.find((entry) => entry.provider === "groq")!;
    expect(groq).toMatchObject({ model: "qwen/qwen3.6-27b", contextTokens: 65_536, jsonSchema: true });
    expect(groq.capabilities).toMatchObject({ tools: true, structuredOutput: true });
    // "none": text and streaming only (no tool-using chat turn goes to it).
    expect(resolveAIConfig({ ...base, groqModelCapabilities: "none" }).catalog.find((entry) => entry.provider === "groq")!.capabilities.tools).toBe(false);
  });

  it("warns when GROQ_BASE_URL points somewhere other than Groq (the key is sent there)", () => {
    expect(resolveAIConfig({ ...base, groqBaseUrl: "https://proxy.example/openai/v1" }).warnings.join("\n")).toContain("GROQ_BASE_URL points at a host other than api.groq.com");
  });

  it("declares what this repository already relies on for Gemini", () => {
    const gemini = resolveAIConfig(base).catalog.find((entry) => entry.provider === "google")!;
    expect(gemini).toMatchObject({ model: "gemini-3.6-flash", free: false, contextTokens: 1_000_000 });
    expect(gemini.capabilities).toMatchObject({ text: true, streaming: true, tools: true, vision: true, longContext: true });
    expect(gemini.imageMimeTypes).toEqual(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);
  });

  it("accepts the provider names in any case, with `google` as an alias of `gemini`, and `none` to switch the fallback off", () => {
    expect(resolveAIConfig({ ...base, aiPrimaryProvider: " OpenRouter ", aiFallbackProvider: "GEMINI" })).toMatchObject({ preferredPrimary: "openrouter", preferredFallback: "google" });
    expect(resolveAIConfig({ ...base, aiPrimaryProvider: "google", aiFallbackProvider: "none" }).preferredFallback).toBeNull();
    expect(resolveAIConfig({ ...base, aiFallbackProvider: "off" }).preferredFallback).toBeNull();
    // With OpenRouter as the primary, the default fallback is the next other provider in the default order (not itself).
    expect(resolveAIConfig({ ...base, aiPrimaryProvider: "openrouter" })).toMatchObject({ preferredPrimary: "openrouter", preferredFallback: "groq" });
    expect(resolveAIConfig({ ...base, aiPrimaryProvider: "GROQ" }).preferredPrimary).toBe("groq");
    // Empty strings (an `.env` line like `AI_PRIMARY_PROVIDER=`) mean "unset".
    expect(resolveAIConfig({ ...base, aiPrimaryProvider: "", aiFallbackProvider: "  " })).toMatchObject({ preferredPrimary: "groq", preferredFallback: "openrouter" });
  });

  it("the default fallback chain is every other provider, in the default order groq, openrouter, gemini, openai", () => {
    expect(resolveAIConfig(base).preferredFallbacks).toEqual(["openrouter", "google", "openai"]);
    expect(resolveAIConfig({ ...base, aiPrimaryProvider: "gemini" }).preferredFallbacks).toEqual(["groq", "openrouter", "openai"]);
    expect(resolveAIConfig({ ...base, aiPrimaryProvider: "openrouter" }).preferredFallbacks).toEqual(["groq", "google", "openai"]);
    expect(resolveAIConfig({ ...base, aiPrimaryProvider: "openai" }).preferredFallbacks).toEqual(["groq", "openrouter", "google"]);
    // An explicit chain is kept in its own order; `none` empties it.
    expect(resolveAIConfig({ ...base, aiFallbackProvider: " OpenAI, openrouter " })).toMatchObject({ preferredFallback: "openai", preferredFallbacks: ["openai", "openrouter"] });
    expect(resolveAIConfig({ ...base, aiFallbackProvider: "none" }).preferredFallbacks).toEqual([]);
  });

  it("the OpenAI-compatible endpoint has a model entry only when OPENAI_MODEL names it, declaring tools unless told otherwise", () => {
    expect(resolveAIConfig(base).catalog.some((entry) => entry.provider === "openai")).toBe(false);
    expect(resolveAIConfig(base).openAI).toEqual({ baseUrl: "https://api.openai.com/v1", timeoutMs: 60_000 });

    const config = resolveAIConfig({ ...base, openAiModel: "vendor-model-1", openAiBaseUrl: "https://api.example.com/openai/v1/", openAiMaxOutputTokens: "800" });
    expect(config.openAI).toEqual({ baseUrl: "https://api.example.com/openai/v1", timeoutMs: 60_000, model: "vendor-model-1", maxOutputTokens: 800 });
    const entry = config.catalog.find((candidate) => candidate.provider === "openai")!;
    expect(entry).toMatchObject({ model: "vendor-model-1", free: false, priority: 3, imageMimeTypes: [] });
    expect(entry.capabilities).toMatchObject({ text: true, streaming: true, tools: true, vision: false });

    const textOnly = resolveAIConfig({ ...base, openAiModel: "m", openAiModelCapabilities: "none" }).catalog.find((candidate) => candidate.provider === "openai")!;
    expect(textOnly.capabilities.tools).toBe(false);
    const vision = resolveAIConfig({ ...base, openAiModel: "m", openAiModelCapabilities: "tools,vision" }).catalog.find((candidate) => candidate.provider === "openai")!;
    expect(vision).toMatchObject({ imageMimeTypes: ["image/png", "image/jpeg", "image/webp"] });
  });

  it("Gemini's in-request fallback models default to gemini-3.8-flash and can be listed", () => {
    expect(resolveAIConfig(base).geminiFallbackModels).toEqual(["gemini-3.8-flash"]);
    expect(resolveAIConfig({ ...base, geminiFallbackModels: "gemini-3.8-flash, gemini-3.5-flash-lite" }).geminiFallbackModels).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  });

  it("the OpenRouter model's declared capabilities come from OPENROUTER_MODEL_CAPABILITIES", () => {
    const config = resolveAIConfig({ ...base, openRouterModel: "meta/llama-3:free", openRouterModelCapabilities: "Tools, VISION structuredOutput,tools", openRouterModelContextTokens: "131072" });
    const entry = config.catalog.find((candidate) => candidate.provider === "openrouter")!;
    expect(entry).toMatchObject({ model: "meta/llama-3:free", contextTokens: 131_072, imageMimeTypes: ["image/png", "image/jpeg", "image/webp"] });
    expect(entry.capabilities).toMatchObject({ tools: true, vision: true, structuredOutput: true, coding: false, longContext: true }); // longContext is derived from the context size
  });
});

describe("resolveAIConfig validation (a present-but-wrong value stops startup; names only, never values)", () => {
  it.each<[string, Partial<AIConfigInput>, string]>([
    ["an unknown primary provider", { aiPrimaryProvider: "gpt" }, "AI_PRIMARY_PROVIDER"],
    ["an unknown fallback provider", { aiFallbackProvider: "claude" }, "AI_FALLBACK_PROVIDER"],
    ["a fallback equal to the primary", { aiPrimaryProvider: "gemini", aiFallbackProvider: "google" }, "must not list AI_PRIMARY_PROVIDER"],
    ["a fallback chain that lists the primary", { aiFallbackProvider: "openrouter,groq" }, "must not list AI_PRIMARY_PROVIDER"],
    ["a Groq URL over plain http", { groqBaseUrl: "http://groq.example/openai/v1" }, "GROQ_BASE_URL must use https"],
    ["an invalid Groq model id", { groqModel: "bad model!" }, "GROQ_MODEL is not a valid model id"],
    ["an unknown Groq capability", { groqModelCapabilities: "tools,telepathy" }, "GROQ_MODEL_CAPABILITIES"],
    ["a Groq timeout below the minimum", { groqTimeoutMs: "10" }, "GROQ_TIMEOUT_MS"],
    ["a Groq output cap of zero", { groqMaxOutputTokens: "0" }, "GROQ_MAX_OUTPUT_TOKENS"],
    ["a fallback chain with an unknown provider", { aiFallbackProvider: "openrouter,claude" }, "AI_FALLBACK_PROVIDER"],
    ["an OpenAI URL over plain http", { openAiBaseUrl: "http://api.example.com/v1" }, "OPENAI_BASE_URL must use https"],
    ["an invalid OpenAI model id", { openAiModel: "bad model!" }, "OPENAI_MODEL is not a valid model id"],
    ["an unknown OpenAI capability", { openAiModelCapabilities: "tools,telepathy" }, "OPENAI_MODEL_CAPABILITIES"],
    ["an OpenAI output cap of zero", { openAiMaxOutputTokens: "0" }, "OPENAI_MAX_OUTPUT_TOKENS"],
    ["a Gemini fallback model that is not a model id", { geminiFallbackModels: "gemini-3.8-flash, bad model!" }, "GEMINI_FALLBACK_MODELS"],
    ["an OpenRouter URL that is not a URL", { openRouterBaseUrl: "not a url" }, "OPENROUTER_BASE_URL"],
    ["an OpenRouter URL over plain http", { openRouterBaseUrl: "http://openrouter.example/api/v1" }, "https"],
    ["an OpenRouter URL carrying credentials", { openRouterBaseUrl: "https://user:pw@openrouter.ai/api/v1" }, "credentials"],
    ["an OpenRouter URL with a query string", { openRouterBaseUrl: "https://openrouter.ai/api/v1?x=1" }, "query string"],
    ["a timeout that is not a number", { openRouterTimeoutMs: "soon" }, "OPENROUTER_TIMEOUT_MS"],
    ["a timeout below the minimum", { openRouterTimeoutMs: "10" }, "OPENROUTER_TIMEOUT_MS"],
    ["a context size out of range", { openRouterModelContextTokens: "5" }, "OPENROUTER_MODEL_CONTEXT_TOKENS"],
    ["a cooldown that is negative", { aiQuotaCooldownMs: "-1" }, "AI_QUOTA_COOLDOWN_MS"],
    ["an invalid OpenRouter model id", { openRouterModel: "bad model!" }, "OPENROUTER_MODEL is not a valid model id"],
    ["an unknown declared capability", { openRouterModelCapabilities: "tools,telepathy" }, "OPENROUTER_MODEL_CAPABILITIES"],
    ["an invalid Gemini model id", { geminiModel: "x y" }, "GEMINI_MODEL"],
    ["a discovery switch that is not a boolean", { openRouterDiscovery: "maybe" }, "OPENROUTER_DISCOVERY"],
    ["an allow-paid switch that is not a boolean", { openRouterAllowPaid: "2" }, "OPENROUTER_ALLOW_PAID"],
    ["a fallback model that is not a model id", { openRouterFallbackModels: "a/b, bad model!" }, "OPENROUTER_FALLBACK_MODELS"],
    ["more fallback models than one request can carry", { openRouterFallbackModels: "a/b,c/d,e/f" }, "OPENROUTER_FALLBACK_MODELS lists more than 2"],
    ["a negative price limit", { openRouterMaxPricePrompt: "-1" }, "OPENROUTER_MAX_PRICE_PROMPT"],
    ["a price limit that is not a number", { openRouterMaxPriceCompletion: "cheap" }, "OPENROUTER_MAX_PRICE_COMPLETION"],
    ["an output cap of zero", { openRouterMaxOutputTokens: "0" }, "OPENROUTER_MAX_OUTPUT_TOKENS"],
    ["a data-collection value that is not allow or deny", { openRouterDataCollection: "sometimes" }, "OPENROUTER_DATA_COLLECTION"],
  ])("rejects %s", (_label, input, expected) => {
    const problems = problemsOf(input);
    expect(problems.join("\n")).toContain(expected);
  });

  it("reports every problem at once and never echoes a configured value", () => {
    const secretish = "sk-or-v1-THISISASECRETVALUE0000";
    const problems = problemsOf({ aiPrimaryProvider: secretish, openRouterBaseUrl: `http://user:${secretish}@evil.example/p`, openRouterTimeoutMs: secretish, aiModelCatalogJson: `{"key":"${secretish}"` });
    expect(problems.length).toBeGreaterThanOrEqual(4);
    expect(problems.join("\n")).not.toContain("THISISASECRETVALUE");
    expect(new AIConfigError(problems).message).not.toContain("THISISASECRETVALUE");
  });

  it("allows http only for localhost (a local stub), and warns when the key would go to a host other than openrouter.ai", () => {
    expect(resolveAIConfig({ ...base, openRouterBaseUrl: "http://localhost:4010/api/v1" }).openRouter.baseUrl).toBe("http://localhost:4010/api/v1");
    const proxied = resolveAIConfig({ ...base, openRouterBaseUrl: "https://gateway.example.com/openrouter/v1/" });
    expect(proxied.openRouter.baseUrl).toBe("https://gateway.example.com/openrouter/v1");
    expect(proxied.warnings.join("\n")).toContain("other than openrouter.ai");
  });

  it("reads the OpenRouter cost and routing settings, and says so when paid models are allowed with no price limit", () => {
    const config = resolveAIConfig({
      ...base,
      openRouterDiscovery: "off",
      openRouterFallbackModels: "vendor/a:free, vendor/b:free",
      openRouterMaxPricePrompt: "0.5",
      openRouterMaxPriceCompletion: "2",
      openRouterMaxOutputTokens: "2048",
      openRouterDataCollection: "DENY",
    });
    expect(config.openRouter).toMatchObject({
      discovery: false,
      fallbackModels: ["vendor/a:free", "vendor/b:free"],
      maxPricePromptPerM: 0.5,
      maxPriceCompletionPerM: 2,
      maxOutputTokens: 2048,
      dataCollection: "deny",
    });
    // Fallback models need the live list to be checked against, so they do nothing with discovery off: the operator is told.
    expect(config.warnings.join("\n")).toContain("no effect while OPENROUTER_DISCOVERY is off");
    expect(resolveAIConfig({ ...base, openRouterAllowPaid: "true" }).warnings.join("\n")).toContain("any paid model");
    expect(resolveAIConfig({ ...base, openRouterAllowPaid: "true", openRouterMaxPricePrompt: "1" }).warnings.join("\n")).not.toContain("any paid model");
  });

  it("warns that OPENROUTER_MODEL is ignored when the catalog JSON lists OpenRouter models", () => {
    const config = resolveAIConfig({ ...base, openRouterModel: "a/b", aiModelCatalogJson: JSON.stringify([{ provider: "openrouter", model: "c/d", streaming: true }]) });
    expect(config.warnings.join("\n")).toContain("ignored because AI_MODEL_CATALOG_JSON");
    expect(config.catalog.filter((entry) => entry.provider === "openrouter").map((entry) => entry.model)).toEqual(["c/d"]);
  });

  it("an invalid AI setting stops the gateway (and so the container) with a secret-free reason", () => {
    expect(() => createModelGateway(fakeEnv({ aiPrimaryProvider: "nope" }), { isProduction: true })).toThrow(/Invalid AI configuration: AI_PRIMARY_PROVIDER/);
    // A missing credential is NOT an error: the AI simply reports itself unavailable.
    expect(() => createModelGateway(fakeEnv({ geminiApiKey: undefined, openRouterApiKey: undefined }), { isProduction: true })).not.toThrow();
  });
});

describe("AI_MODEL_CATALOG_JSON", () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({ provider: "openrouter", model: "vendor/model:free", ...overrides });
  const parse = (value: unknown) => parseCatalogJson(JSON.stringify(value));
  const problems = (text: string) => {
    try {
      parseCatalogJson(text);
    } catch (error) {
      return (error as AIConfigError).problems.join("\n");
    }
    return "";
  };

  it("parses the documented shape; anything unstated is the conservative value", () => {
    const [parsed] = parse([entry({ enabled: true, free: true, streaming: true, tools: false, vision: false, priority: 2 })]);
    expect(parsed).toMatchObject({ provider: "openrouter", model: "vendor/model:free", enabled: true, free: true, priority: 2, contextTokens: 32_768, imageMimeTypes: [] });
    expect(parsed!.capabilities.streaming).toBe(true);
    expect(parsed!.capabilities.tools).toBe(false);
    expect(parse([entry()])[0]!.capabilities).toMatchObject({ streaming: false, tools: false, vision: false });
  });

  it("accepts `gemini` for the Google provider and defaults image types per provider", () => {
    const [gemini, router] = parse([entry({ provider: "gemini", model: "gemini-x", vision: true }), entry({ vision: true })]);
    expect(gemini).toMatchObject({ provider: "google" });
    expect(gemini!.imageMimeTypes).toContain("image/heic");
    expect(router!.imageMimeTypes).not.toContain("image/heic");
  });

  it("is strict, because a typo that silently leaves a capability off or on would misroute requests", () => {
    expect(problems(JSON.stringify([entry({ tool: true })]))).toContain('unknown key "tool"');
    expect(problems(JSON.stringify([entry({ longContext: true })]))).toContain("derived from contextTokens");
    expect(problems(JSON.stringify([entry({ tools: "yes" })]))).toContain("tools must be true or false");
    expect(problems(JSON.stringify([entry({ provider: "azure" })]))).toContain("provider");
    expect(problems(JSON.stringify([entry({ model: "bad model" })]))).toContain("model id");
    expect(problems(JSON.stringify([entry({ priority: -1 })]))).toContain("priority");
    expect(problems(JSON.stringify([entry({ contextTokens: 12 })]))).toContain("contextTokens");
    expect(problems(JSON.stringify([entry({ vision: true, imageMimeTypes: ["image/gif"] })]))).toContain("imageMimeTypes");
    expect(problems(JSON.stringify([entry(), entry()]))).toContain("repeats a provider and model");
    expect(problems("{}")).toContain("JSON array");
    expect(problems("[")).toContain("not valid JSON");
    expect(problems(JSON.stringify([1]))).toContain("must be an object");
  });

  it("a provider listed in the JSON replaces that provider's simple-variable defaults; others keep theirs", () => {
    const config = resolveAIConfig({ ...base, aiModelCatalogJson: JSON.stringify([entry({ model: "vendor/only:free" })]) });
    expect(config.catalog.map((candidate) => `${candidate.provider}:${candidate.model}`).sort()).toEqual(["google:gemini-3.6-flash", "groq:openai/gpt-oss-120b", "openrouter:vendor/only:free"]);
  });
});

describe("choosing a model by declared capability", () => {
  const request = (extra: Parameters<typeof requirementsFor>[1] = {}, overrides: Record<string, unknown> = {}) =>
    requirementsFor({ systemPrompt: "s", messages: [{ role: "user", content: "hi" }], modelConfig: { provider: "x", model: "y" }, ...overrides }, extra);

  it("picks the most preferred enabled model that declares everything the request needs", () => {
    const catalog = [
      openRouterEntry({ model: "vendor/plain:free" }),
      { ...openRouterEntry({ model: "vendor/tools", extraCapabilities: ["tools"] }), priority: 5 },
      { ...openRouterEntry({ model: "vendor/better-tools", extraCapabilities: ["tools"] }), priority: 3 },
      { ...openRouterEntry({ model: "vendor/disabled", extraCapabilities: ["tools"] }), priority: 0, enabled: false },
    ];
    expect(chooseEntry(catalog, "openrouter", request()).entry?.model).toBe("vendor/plain:free");
    expect(chooseEntry(catalog, "openrouter", request({}, { tools: [{ name: "a.b", description: "d", inputSchema: { requiredFields: [] } }] })).entry?.model).toBe("vendor/better-tools");
  });

  it("explains why nothing fits, with capability names only", () => {
    const catalog = [openRouterEntry({ model: "vendor/plain:free" })];
    const needsTools = request({}, { tools: [{ name: "a.b", description: "d", inputSchema: { requiredFields: [] } }] });
    expect(chooseEntry(catalog, "openrouter", needsTools)).toEqual({ entry: undefined, missing: ["tools"] });
    expect(chooseEntry(catalog, "google", request())).toEqual({ entry: undefined, missing: ["no_enabled_model"] });
    expect(missingCapabilities(catalog[0]!, request({ image: { mimeType: "image/png" } }))).toEqual(["vision"]);
    expect(missingCapabilities(catalog[0]!, request({}, { requires: ["coding", "reasoning"] }))).toEqual(["coding", "reasoning"]);
  });

  it("counts a prompt that cannot fit the context window as unsupported, with Devanagari weighed conservatively", () => {
    const entry = openRouterEntry({ model: "vendor/small:free", contextTokens: 8_000 });
    const long = request({}, { messages: [{ role: "user", content: "a".repeat(30_000) }] });
    expect(missingCapabilities(entry, long)[0]).toMatch(/^context\(\d+>8000\)$/);
    expect(missingCapabilities(entry, request())).toEqual([]);
  });
});
