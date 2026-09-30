import { describe, expect, it } from "vitest";
import { MockContentGenerator, UnavailableContentGenerator } from "../../src/ai/contentGenerator.js";
import { AuthService } from "../../src/auth/authService.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { InsufficientCreditsError } from "../../src/store/store.js";
import type { AccountEntitlementSnapshot, SkillDefinition } from "../../src/domain/types.js";
import type { UsagePort } from "../../src/tooling/ports.js";
import { SkillRegistry } from "../../src/tooling/skillRegistry.js";
import { ToolPipeline } from "../../src/tooling/toolPipeline.js";
import { createWebSearchSkill, UnavailableSearchProvider } from "../../src/skills/webSearch.js";

const snapshot: AccountEntitlementSnapshot = { accountId: "acc-1", plan: "PRO", trialExpiresAt: null, creditBalance: 100 };
const allow = { isGranted: async () => true };
const entitlements = { snapshot: async () => snapshot };
const noConfirm = { confirm: async () => ({ approved: true as const }) };

function pipelineFor(skill: SkillDefinition, usage: UsagePort) {
  const registry = new SkillRegistry();
  registry.register(skill);
  return new ToolPipeline(registry, allow, entitlements, usage, noConfirm);
}

describe("final audit fixes", () => {
  it("an action that already ran is never reported as denied when the charge loses a race", async () => {
    let ran = 0;
    const skill: SkillDefinition = {
      id: "developer.implement", name: "Implement", description: "d", category: "DEVELOPER", capabilities: [],
      requiredPermissions: [], requiredEntitlement: "FREE", usageCost: { value: 10, unit: "credits" },
      riskLevel: "LOW", actionClass: "READ_ONLY", requiresConfirmation: false, executesOnDevice: false,
      inputSchema: { requiredFields: [] },
      handler: async () => { ran++; return { kind: "success", output: {}, summary: "Opened PR #7." }; },
    };
    const usage: UsagePort = { charge: async () => { throw new InsufficientCreditsError("acc-1"); } };
    const outcome = await pipelineFor(skill, usage).execute({ id: "1", skillId: skill.id, input: { values: {} } }, { accountId: "acc-1" });
    expect(ran).toBe(1);
    expect(outcome).toMatchObject({ kind: "success", chargedCredits: 0 });
  });

  it("production without a search provider fails honestly and charges nothing (no placeholder results)", async () => {
    const charges: string[] = [];
    const usage: UsagePort = { charge: async (_a, _c, id) => { charges.push(id); return 0; } };
    const skill = createWebSearchSkill(new UnavailableSearchProvider());
    const outcome = await pipelineFor(skill, usage).execute({ id: "1", skillId: skill.id, input: { values: { query: "phones" } } }, { accountId: "acc-1" });
    expect(outcome.kind).toBe("execution_failed");
    if (outcome.kind === "execution_failed") expect(outcome.result.reason).toBe("search_provider_unavailable");
    expect(charges).toHaveLength(0);
  });

  it("production without an AI provider refuses to generate; the labelled mock stays dev/test only", async () => {
    await expect(new UnavailableContentGenerator("poem").generate()).rejects.toMatchObject({ reason: "ai_provider_unavailable" });
    expect(await new MockContentGenerator("poem").generate("x")).toContain("[Mock poem");
  });

  it("an access token without a session id is refused (logout could never revoke it)", async () => {
    const auth = new AuthService(new InMemoryStore());
    const tokens = await auth.createGuest();
    const [, body] = tokens.accessToken.split(".");
    const payload = JSON.parse(Buffer.from(body!, "base64url").toString());
    await expect(auth.validateAccess({ sub: payload.sub, accountId: payload.accountId, type: "access" })).rejects.toMatchObject({ code: "session_invalid" });
    // The same identity with its real session is accepted.
    await expect(auth.validateAccess(payload)).resolves.toMatchObject({ accountId: payload.accountId });
  });
});
