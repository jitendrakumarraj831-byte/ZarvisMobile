import { describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../../src/agents/orchestrator.js";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { selectDefaultModel, UnavailableAIProvider } from "../../src/ai/providerFactory.js";
import { ServerConfirmationService } from "../../src/security/confirmationService.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import type { EntitlementPort } from "../../src/tooling/ports.js";
import { SkillRegistry } from "../../src/tooling/skillRegistry.js";
import { ToolPipeline } from "../../src/tooling/toolPipeline.js";

/**
 * Production with no GEMINI_API_KEY must not answer with the development mock's canned text
 * as if the AI had replied. It fails closed, like the generation skills and web search do.
 */
describe("no AI credential", () => {
  it("production selects the fail-closed provider; development and tests keep the mock", () => {
    expect(selectDefaultModel({ hasGeminiKey: false, isProduction: true, geminiModel: "g" })).toEqual({ provider: "none", model: "none" });
    expect(selectDefaultModel({ hasGeminiKey: false, isProduction: false, geminiModel: "g" })).toEqual({ provider: "mock", model: "mock-v1" });
    expect(selectDefaultModel({ hasGeminiKey: true, isProduction: true, geminiModel: "g" })).toEqual({ provider: "google", model: "g" });
  });

  it("a real question gets a structured AI_UNAVAILABLE error, not a fabricated reply; nothing is charged", async () => {
    const store = new InMemoryStore();
    const registry = new SkillRegistry();
    const entitlement: EntitlementPort = { snapshot: async () => ({ accountId: "a", plan: "PRO", trialExpiresAt: null, creditBalance: 100 }) };
    const charge = vi.fn(async () => 0);
    const pipeline = new ToolPipeline(registry, { isGranted: async () => true }, entitlement, { charge }, new ServerConfirmationService(store));
    const orchestrator = new Orchestrator(registry, entitlement, pipeline, new UnavailableAIProvider(), { provider: "none", model: "none" }, store);
    const user = await store.createUser("none@test.dev", "x");
    const { id: accountId } = await store.createAccountForUser(user.id);

    const error = await orchestrator.runTurn({ accountId, utterance: "explain photosynthesis" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIProviderError);
    expect(error).toMatchObject({ code: "AI_UNAVAILABLE", status: 503, retryable: false });
    expect(charge).not.toHaveBeenCalled();

    // Deterministic answers that need no model still work.
    expect((await orchestrator.runTurn({ accountId, utterance: "Hi" })).message).toMatch(/ZARVIS/);
  });
});
