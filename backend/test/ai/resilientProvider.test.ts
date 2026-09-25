import { describe, expect, it, vi } from "vitest";
import { ResilientAIProvider } from "../../src/ai/resilientProvider.js";
import type { AIProvider, AIRequest } from "../../src/ai/provider.js";

const request = {
  systemPrompt: "You are ZARVIS.",
  messages: [{ role: "user", content: "hello" }],
  modelConfig: { provider: "google", model: "gemini-3.6-flash" },
} satisfies AIRequest;

function response(text: string) {
  return { message: { role: "assistant" as const, content: text }, toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 } };
}

describe("ResilientAIProvider", () => {
  it("fails over on a transient primary error", async () => {
    const primary: AIProvider = {
      id: "google",
      generate: vi.fn(async () => { throw new Error("Gemini generateContent failed: 503 Service Unavailable"); }),
      streamGenerate: async function* () { throw new Error("Gemini streamGenerateContent failed: 503"); },
    };
    const fallback: AIProvider = {
      id: "omniroute",
      generate: vi.fn(async () => response("fallback")),
      streamGenerate: async function* () { yield { delta: "fallback", done: false }; yield { delta: "", done: true }; },
    };
    const provider = new ResilientAIProvider(primary, fallback);
    await expect(provider.generate(request)).resolves.toEqual(response("fallback"));
    expect(fallback.generate).toHaveBeenCalledOnce();
  });

  it("does not fail over for non-transient errors", async () => {
    const primary: AIProvider = {
      id: "google",
      generate: vi.fn(async () => { throw new Error("Gemini generateContent failed: 401 Unauthorized"); }),
      streamGenerate: async function* () { throw new Error("Gemini streamGenerateContent failed: 401"); },
    };
    const fallback: AIProvider = {
      id: "omniroute",
      generate: vi.fn(async () => response("fallback")),
      streamGenerate: async function* () { yield { delta: "fallback", done: false }; },
    };
    const provider = new ResilientAIProvider(primary, fallback);
    await expect(provider.generate(request)).rejects.toThrow(/401/);
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  it("fails over an initial stream failure without duplicating partial output", async () => {
    const primary: AIProvider = {
      id: "google",
      generate: vi.fn(async () => response("unused")),
      streamGenerate: async function* () { throw new Error("503"); },
    };
    const fallback: AIProvider = {
      id: "omniroute",
      generate: vi.fn(async () => response("unused")),
      streamGenerate: async function* () { yield { delta: "fallback", done: false }; yield { delta: "", done: true }; },
    };
    const chunks = [];
    for await (const chunk of new ResilientAIProvider(primary, fallback).streamGenerate(request)) chunks.push(chunk);
    expect(chunks).toEqual([{ delta: "fallback", done: false }, { delta: "", done: true }]);
  });
});
