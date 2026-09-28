import { beforeEach, describe, expect, it } from "vitest";
import type { AccountEntitlementSnapshot, SkillDefinition, SkillExecutionContext } from "../../src/domain/types.js";
import type {
  ClockPort,
  ConfirmationDecision,
  ConfirmationPort,
  ConfirmationRequest,
  EntitlementPort,
  PermissionPort,
  UsagePort,
} from "../../src/tooling/ports.js";
import { SkillRegistry } from "../../src/tooling/skillRegistry.js";
import { SkillUserError, ToolPipeline } from "../../src/tooling/toolPipeline.js";
import { ServerConfirmationService } from "../../src/security/confirmationService.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";

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
  async confirm(request: ConfirmationRequest): Promise<ConfirmationDecision> {
    this.lastRequest = request;
    if (this.approve) return { approved: true };
    return {
      approved: false,
      pending: {
        id: "c-1",
        skillId: request.skillId,
        skillName: request.skillName,
        action: request.action,
        riskLevel: request.riskLevel,
        actionClass: request.actionClass,
        expiresAt: now.toISOString(),
      },
    };
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
    actionClass: "READ_ONLY",
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

  it("never runs the handler while confirmation is pending", async () => {
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
    expect(outcome.kind).toBe("confirmation_required");
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

  it("treats a blank required field as missing", async () => {
    const pipeline = buildPipeline(lowRiskSkill());
    const outcome = await pipeline.execute({ id: "1", skillId: "web.search", input: { values: { query: "   " } } }, context);
    expect(outcome).toMatchObject({ kind: "validation_failed", missingFields: ["query"] });
  });

  it("turns a thrown handler error into an honest execution_failed without charging", async () => {
    const skill = lowRiskSkill({
      usageCost: { value: 5, unit: "credits" },
      handler: async () => {
        throw new Error("upstream 404 with internal details");
      },
    });
    const usagePort = new FakeUsagePort(100);
    const pipeline = buildPipeline(skill, { usagePort });
    const outcome = await pipeline.execute({ id: "1", skillId: skill.id, input: { values: { query: "x" } } }, context);
    expect(outcome).toMatchObject({ kind: "execution_failed", result: { reason: "handler_error" } });
    if (outcome.kind === "execution_failed") {
      expect(outcome.result.userMessage).not.toContain("internal details");
    }
    expect(usagePort.charges).toHaveLength(0);
  });

  it("passes a SkillUserError's safe message through", async () => {
    const skill = lowRiskSkill({
      handler: async () => {
        throw new SkillUserError("repo_unavailable", "That repository is private.");
      },
    });
    const outcome = await buildPipeline(skill).execute({ id: "1", skillId: skill.id, input: { values: { query: "x" } } }, context);
    expect(outcome).toMatchObject({ kind: "execution_failed", result: { reason: "repo_unavailable", userMessage: "That repository is private." } });
  });

  it("policy forces confirmation for external communication even if the skill does not ask for it", async () => {
    const confirmationPort = new FakeConfirmationPort(false);
    const skill = lowRiskSkill({ actionClass: "EXTERNAL_COMMUNICATION", requiresConfirmation: false });
    const outcome = await buildPipeline(skill, { confirmationPort }).execute(
      { id: "1", skillId: skill.id, input: { values: { query: "x" } } },
      context,
    );
    expect(outcome.kind).toBe("confirmation_required");
    expect(confirmationPort.lastRequest?.action).toContain("query = x");
  });

  it("policy forces confirmation for VERY_HIGH risk", async () => {
    const skill = lowRiskSkill({ riskLevel: "VERY_HIGH", requiresConfirmation: false });
    const outcome = await buildPipeline(skill, { confirmationPort: new FakeConfirmationPort(false) }).execute(
      { id: "1", skillId: skill.id, input: { values: { query: "x" } } },
      context,
    );
    expect(outcome.kind).toBe("confirmation_required");
  });
});

describe("ToolPipeline + ServerConfirmationService (single-action confirmations)", () => {
  let store: InMemoryStore;
  let clockNow: Date;
  let service: ServerConfirmationService;
  let calls: Array<Record<string, unknown>>;
  let pipeline: ToolPipeline;
  const clock: ClockPort = { now: () => clockNow };

  beforeEach(() => {
    store = new InMemoryStore();
    clockNow = new Date("2026-08-26T00:00:00Z");
    service = new ServerConfirmationService(store, clock);
    calls = [];
    const skill = lowRiskSkill({
      id: "developer.implement",
      riskLevel: "HIGH",
      actionClass: "EXTERNAL_COMMUNICATION",
      requiresConfirmation: true,
      describeAction: (input) => `Open a PR for ${String(input.values.query)}`,
      handler: async (input) => {
        calls.push(input.values);
        return { kind: "success", output: {}, summary: "done" };
      },
    });
    const registry = new SkillRegistry();
    registry.register(skill);
    pipeline = new ToolPipeline(registry, new FakePermissionPort(), new FakeEntitlementPort(proSnapshot), new FakeUsagePort(), service, clock);
  });

  async function requestPending(query = "repo-a") {
    const outcome = await pipeline.execute({ id: "1", skillId: "developer.implement", input: { values: { query } } }, context);
    if (outcome.kind !== "confirmation_required") throw new Error("expected confirmation_required, got " + outcome.kind);
    return outcome.confirmation;
  }

  it("issues a pending confirmation describing the exact action and runs nothing", async () => {
    const pending = await requestPending();
    expect(pending.action).toBe("Open a PR for repo-a");
    expect(pending.riskLevel).toBe("HIGH");
    expect(calls).toHaveLength(0);
  });

  it("runs exactly the stored call once after approval, and a replayed approval runs nothing", async () => {
    const pending = await requestPending();
    const approved = await service.approve("acc-1", pending.id);
    expect(approved).toBeDefined();
    const outcome = await pipeline.execute(
      { id: "2", skillId: approved!.record.skillId, input: { values: approved!.record.input } },
      { accountId: "acc-1", confirmationGrant: approved!.grant },
    );
    expect(outcome.kind).toBe("success");
    expect(calls).toEqual([{ query: "repo-a" }]);
    expect(await service.approve("acc-1", pending.id)).toBeUndefined();
  });

  it("a grant for one input cannot authorize a different input", async () => {
    const pending = await requestPending("repo-a");
    const approved = await service.approve("acc-1", pending.id);
    const outcome = await pipeline.execute(
      { id: "2", skillId: "developer.implement", input: { values: { query: "repo-b" } } },
      { accountId: "acc-1", confirmationGrant: approved!.grant },
    );
    expect(outcome.kind).toBe("confirmation_required");
    expect(calls).toHaveLength(0);
  });

  it("if the prepared action changed after approval (e.g. another GitHub identity), it asks again and runs nothing", async () => {
    let identity = "alice";
    const skill = lowRiskSkill({
      id: "developer.identity",
      riskLevel: "HIGH",
      actionClass: "EXTERNAL_COMMUNICATION",
      requiresConfirmation: true,
      prepare: async () => ({ kind: "ready", description: `As GitHub user ${identity}, open a PR` }),
      handler: async (input) => {
        calls.push(input.values);
        return { kind: "success", output: {}, summary: "done" };
      },
    });
    const registry = new SkillRegistry();
    registry.register(skill);
    const p = new ToolPipeline(registry, new FakePermissionPort(), new FakeEntitlementPort(proSnapshot), new FakeUsagePort(), service, clock);
    const first = await p.execute({ id: "1", skillId: "developer.identity", input: { values: { query: "x" } } }, context);
    if (first.kind !== "confirmation_required") throw new Error("expected confirmation");
    expect(first.confirmation.action).toBe("As GitHub user alice, open a PR");
    const approved = await service.approve("acc-1", first.confirmation.id);

    identity = "mallory";
    const outcome = await p.execute(
      { id: "2", skillId: "developer.identity", input: { values: approved!.record.input } },
      { accountId: "acc-1", confirmationGrant: approved!.grant },
    );
    expect(outcome.kind).toBe("confirmation_required");
    if (outcome.kind === "confirmation_required") expect(outcome.confirmation.action).toBe("As GitHub user mallory, open a PR");
    expect(calls).toHaveLength(0);
  });

  it("another account cannot approve or decline someone else's confirmation", async () => {
    const pending = await requestPending();
    expect(await service.approve("acc-2", pending.id)).toBeUndefined();
    expect(await service.decline("acc-2", pending.id)).toBeUndefined();
    expect(await service.approve("acc-1", pending.id)).toBeDefined();
  });

  it("an expired confirmation cannot be approved", async () => {
    const pending = await requestPending();
    clockNow = new Date(clockNow.getTime() + 11 * 60 * 1000);
    expect(await service.approve("acc-1", pending.id)).toBeUndefined();
  });

  it("a declined confirmation cannot be approved afterwards", async () => {
    const pending = await requestPending();
    expect(await service.decline("acc-1", pending.id)).toBeDefined();
    expect(await service.approve("acc-1", pending.id)).toBeUndefined();
  });
});
