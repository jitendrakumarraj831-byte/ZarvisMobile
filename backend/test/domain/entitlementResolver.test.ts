import { describe, expect, it } from "vitest";
import { resolveEntitlement } from "../../src/domain/entitlementResolver.js";
import type { AccountEntitlementSnapshot, SkillDefinition } from "../../src/domain/types.js";

const now = new Date("2026-08-26T00:00:00Z");

function skill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: "web.search",
    name: "Web Search",
    description: "test",
    category: "WEB",
    capabilities: [],
    requiredPermissions: [],
    requiredEntitlement: "FREE",
    usageCost: { value: 0, unit: "credits" },
    riskLevel: "LOW",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: [] },
    handler: async () => ({ kind: "success", output: {}, summary: "ok" }),
    ...overrides,
  };
}

describe("resolveEntitlement", () => {
  it("denies a FREE plan a PRO-required skill", () => {
    const snapshot: AccountEntitlementSnapshot = { accountId: "a1", plan: "FREE", trialExpiresAt: null, creditBalance: 100 };
    const decision = resolveEntitlement(snapshot, skill({ requiredEntitlement: "PRO" }), now);
    expect(decision).toEqual({ allowed: false, reason: "PLAN_TOO_LOW", upgradeTo: "PRO" });
  });

  it("allows an active trial to use a TRIAL-tier skill", () => {
    const snapshot: AccountEntitlementSnapshot = {
      accountId: "a1",
      plan: "TRIAL",
      trialExpiresAt: new Date(now.getTime() + 86_400_000),
      creditBalance: 100,
    };
    const decision = resolveEntitlement(snapshot, skill({ requiredEntitlement: "TRIAL" }), now);
    expect(decision).toEqual({ allowed: true });
  });

  it("falls back an expired trial to FREE and denies a TRIAL-tier skill", () => {
    const snapshot: AccountEntitlementSnapshot = {
      accountId: "a1",
      plan: "TRIAL",
      trialExpiresAt: new Date(now.getTime() - 86_400_000),
      creditBalance: 100,
    };
    const decision = resolveEntitlement(snapshot, skill({ requiredEntitlement: "TRIAL" }), now);
    expect(decision).toEqual({ allowed: false, reason: "TRIAL_EXPIRED", upgradeTo: "TRIAL" });
  });

  it("allows a PRO plan to use a PRO-required skill", () => {
    const snapshot: AccountEntitlementSnapshot = { accountId: "a1", plan: "PRO", trialExpiresAt: null, creditBalance: 100 };
    const decision = resolveEntitlement(snapshot, skill({ requiredEntitlement: "PRO" }), now);
    expect(decision).toEqual({ allowed: true });
  });

  it("denies insufficient credit balance even when the plan is sufficient", () => {
    const snapshot: AccountEntitlementSnapshot = { accountId: "a1", plan: "PRO", trialExpiresAt: null, creditBalance: 1 };
    const decision = resolveEntitlement(snapshot, skill({ usageCost: { value: 5, unit: "credits" } }), now);
    expect(decision).toEqual({ allowed: false, reason: "OUT_OF_CREDITS" });
  });
});
