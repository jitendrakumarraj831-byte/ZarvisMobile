import { describe, expect, it } from "vitest";
import { Orchestrator } from "../../src/agents/orchestrator.js";
import type { AIProvider, AIRequest, AIResponse } from "../../src/ai/provider.js";
import { CAPABILITIES, deviceCapabilitiesForPrompt } from "../../src/capabilities/registry.js";
import { defaultModelConfig } from "../../src/ai/providerFactory.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { SkillRegistry } from "../../src/tooling/skillRegistry.js";
import { ToolPipeline } from "../../src/tooling/toolPipeline.js";
import { ServerConfirmationService } from "../../src/security/confirmationService.js";
import type { EntitlementPort } from "../../src/tooling/ports.js";

class CapturingProvider implements AIProvider {
  readonly id = "capture";
  readonly requests: AIRequest[] = [];
  async generate(request: AIRequest): Promise<AIResponse> {
    this.requests.push(request);
    return { message: { role: "assistant", content: "ok" } } as AIResponse;
  }
  async *streamGenerate(): AsyncIterable<never> {}
}

describe("shared Brain knows the device capability registry", () => {
  it("lists every capability, where it runs, and that the Brain never performs device actions", () => {
    const text = deviceCapabilitiesForPrompt();
    for (const capability of CAPABILITIES) expect(text).toContain(`- ${capability.name}:`);
    expect(text).toContain("never by you");
    expect(text).toContain("- Notification access: available in the Android app; each action needs the user's explicit confirmation.");
    expect(text).toContain("- Microphone: available in the Android app and web.");
  });

  it("every Brain turn carries it in the system prompt", async () => {
    const store = new InMemoryStore();
    const provider = new CapturingProvider();
    const registry = new SkillRegistry();
    const entitlement: EntitlementPort = { snapshot: async () => ({ accountId: "a", plan: "FREE", trialExpiresAt: null, creditBalance: 0 }) };
    const pipeline = new ToolPipeline(registry, { isGranted: async () => true }, entitlement, { charge: async () => 0 }, new ServerConfirmationService(store));
    const orchestrator = new Orchestrator(registry, entitlement, pipeline, provider, defaultModelConfig, store);
    const user = await store.createUser("brain@test.dev", "x");
    const account = await store.createAccountForUser(user.id);

    await orchestrator.runTurn({ accountId: account.id, utterance: "read my notifications please" });
    expect(provider.requests[0]?.systemPrompt).toContain(deviceCapabilitiesForPrompt());
  });
});
