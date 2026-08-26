import { beforeEach, describe, expect, it } from "vitest";
import type { AccountEntitlementSnapshot, SkillDefinition, SkillExecutionContext } from "../../src/domain/types.js";
import type { ClockPort, ConfirmationPort, ConfirmationRequest, EntitlementPort, PermissionPort, UsagePort } from "../../src/tooling/ports.js";
import { SkillRegistry } from "../../src/tooling/skillRegistry.js";
import { ToolPipeline } from "../../src/tooling/toolPipeline.js";

const now = new Date("2026-08-26T00:00:00Z");
const proSnapshot: AccountEntitlementSnapshot = { accountId: "acc-1", plan: "PRO", trialExpiresAt: null, creditBalance: 100 };
const context: SkillExecutionContext = { accountId: "acc-1" };

class FakePermissionPort implements PermissionPort {
  constructor(private readonly granted: Set<string> = new Set()) {}
  async isGranted(_accountId: string, permission: string): Promise<boolean> {
    return this.granted.has(permission);
  }
}

class FakeEntitlementPort implements EntitlementPort {
  constructor(private readonly fixedSnapshot: AccountEntitlementSnapshot) {}
  async snapshot(): Promise<AccountEntitlementSnapshot> {
    return this.fixedSnapshot;
  }
}

class FakeUsagePort implements UsagePort {
  balance: number;
  charges: Array<{ skillId: string; cost: number }> = [];
  constructor(initialBalance = 100) {
    this.balance = initialBalance;
  }
  async charge(_accountId: string, cost: { value: number }, skillId: string): Promise<number> {
    this.balance -= cost.value;
    this.charges.push({ skillId, cost: cost.value });
    return this.balance;
  }
}

class FakeConfirmationPort implements ConfirmationPort {
  lastRequest: ConfirmationRequest | undefined;
  constructor(private readonly approve: boolean) {}
  async confirm(request: ConfirmationRequest): Promise<boolean> {
    this.lastRequest = request;
    return this.approve;
  }
}

const fixedClock: ClockPort = { now: () => now };

function lowRiskSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: "web.search",
    name: "Web Search",
    description: "test skill",
    category: "WEB",
    capabilities: [],
    requiredPermissions: [],
    requiredEntitlement: "FREE",
    usageCost: { value: 0, unit: "credits" },
    riskLevel: "LOW",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["query"] },
    handler: async () => ({ kind: "success", output: { hits: 3 }, summary: "Found 3 results." }),
    ...overrides,
  };
}

function buildPipeline(
  skill: SkillDefinition,
  opts: {
    permissionPort?: FakePermissionPort;
    usagePort?: FakeUsagePort;
    confirmationPort?: FakeConfirmationPort;
    snapshot?: AccountEntitlementSnapshot;
  } = {},
) {
  const registry = new SkillRegistry();
  registry.register(skill);
  return new ToolPipeline(
    registry,
    opts.permissionPort ?? new FakePermissionPort(),
    new FakeEntitlementPort(opts.snapshot ?? proSnapshot),
    opts.usagePort ?? new FakeUsagePort(100),
    opts.confirmationPort ?? new FakeConfirmationPort(true),
    fixedClock,
  );
}

describe("ToolPipeline", () => {
  it("reports an unknown skill id as not found", async () => {
    const pipeline = buildPipeline(lowRiskSkill());
    const outcome = await pipeline.execute({ id: "1", skillId: "does.not_exist", input: { values: {} } }, context);
    expect(outcome.kind).toBe("skill_not_found");
  });

  it("fails validation before anything else runs when a required field is missing", async () => {
    const usagePort = new FakeUsagePort(100);
    const pipeline = buildPipeline(lowRiskSkill(), { usagePort });
    const outcome = await pipeline.execute({ id: "1", skillId: "web.search", input: { values: {} } }, context);
    expect(outcome).toMatchObject({ kind: "validation_failed", missingFields: ["query"] });
    expect(usagePort.charges).toHaveLength(0);
  });

  it("blocks execution on missing permission", async () => {
    const skill = lowRiskSkill({ requiredPermissions: ["CONTACTS"] });
    const pipeline = buildPipeline(skill, { permissionPort: new FakePermissionPort() });
    const outcome = await pipeline.execute({ id: "1", skillId: skill.id, input: { values: { query: "x" } } }, context);
    expect(outcome).toMatchObject({ kind: "permission_denied", missing: ["CONTACTS"] });
  });

  it("blocks and never charges on entitlement denial", async () => {
    const skill = lowRiskSkill({ requiredEntitlement: "PRO" });
    const freeSnapshot: AccountEntitlementSnapshot = { accountId: "acc-1", plan: "FREE", trialExpiresAt: null, creditBalance: 100 };
    const usagePort = new FakeUsagePort(100);
    const pipeline = buildPipeline(skill, { usagePort, snapshot: freeSnapshot });
    const outcome = await pipeline.execute({ id: "1", skillId: skill.id, input: { values: { query: "x" } } }, context);
    expect(outcome.kind).toBe("entitlement_denied");
    expect(usagePort.charges).toHaveLength(0);
  });

  it("never runs the handler when confirmation is declined", async () => {
    let handlerCalled = false;
    const skill = lowRiskSkill({
      riskLevel: "MEDIUM",
      requiresConfirmation: true,
      handler: async () => {
        handlerCalled = true;
        return { kind: "success", output: {}, summary: "should not happen" };
      },
    });
    const pipeline = buildPipeline(skill, { confirmationPort: new FakeConfirmationPort(false) });
    const outcome = await pipeline.execute({ id: "1", skillId: skill.id, input: { values: { query: "x" } } }, context);
    expect(outcome.kind).toBe("confirmation_declined");
    expect(handlerCalled).toBe(false);
  });

  it("charges the declared usage cost exactly once on success", async () => {
    const skill = lowRiskSkill({ usageCost: { value: 5, unit: "credits" } });
    const usagePort = new FakeUsagePort(100);
    const pipeline = buildPipeline(skill, { usagePort });
    const outcome = await pipeline.execute({ id: "1", skillId: skill.id, input: { values: { query: "x" } } }, context);
    expect(outcome).toMatchObject({ kind: "success", chargedCredits: 5 });
    expect(usagePort.charges).toHaveLength(1);
    expect(usagePort.balance).toBe(95);
  });

  it("fails verification and does not charge when the handler reports success with a blank summary", async () => {
    const skill = lowRiskSkill({
      usageCost: { value: 5, unit: "credits" },
      handler: async () => ({ kind: "success", output: {}, summary: "" }),
    });
    const usagePort = new FakeUsagePort(100);
    const pipeline = buildPipeline(skill, { usagePort });
    const outcome = await pipeline.execute({ id: "1", skillId: skill.id, input: { values: { query: "x" } } }, context);
    expect(outcome.kind).toBe("verification_failed");
    expect(usagePort.charges).toHaveLength(0);
  });

  it("surfaces a handler failure without charging credits", async () => {
    const skill = lowRiskSkill({
      usageCost: { value: 5, unit: "credits" },
      handler: async () => ({ kind: "failure", reason: "boom", userMessage: "Something went wrong." }),
    });
    const usagePort = new FakeUsagePort(100);
    const pipeline = buildPipeline(skill, { usagePort });
    const outcome = await pipeline.execute({ id: "1", skillId: skill.id, input: { values: { query: "x" } } }, context);
    expect(outcome).toMatchObject({ kind: "execution_failed", result: { reason: "boom" } });
    expect(usagePort.charges).toHaveLength(0);
  });
});
