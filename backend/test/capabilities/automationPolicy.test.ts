import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEVICE_ACTIONS, MAX_PHONE_STEPS } from "../../src/capabilities/deviceActions.js";
import { CAPABILITIES, policyRequiresConfirmation } from "../../src/capabilities/registry.js";

interface PolicyAction {
  skillId: string;
  capabilityId: string | null;
  risk: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  actionClass: "READ_ONLY" | "LOW_IMPACT" | "EXTERNAL_COMMUNICATION" | "FINANCIAL" | "DESTRUCTIVE" | "SECURITY_SENSITIVE";
  confirm: boolean;
  privateResult: boolean;
  actsInOtherApps: boolean;
  brainHandoff: boolean;
}

/**
 * shared/automation-policy.json is the phone-automation policy the Android pipeline enforces (default deny). The phone actions the
 * planner may hand to the phone must be exactly the ones the policy lets it hand over, under the same limits and confirmation rules.
 */
describe("shared/automation-policy.json and the planner's phone actions", () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), "../../../shared/automation-policy.json");
  const policy = JSON.parse(readFileSync(file, "utf8")) as {
    version: number;
    rules: { confirmationClasses: string[]; confirmationRisks: string[]; maxPhoneSteps: number };
    neverDoes: Array<{ en: string; hi: string }>;
    actions: PolicyAction[];
  };

  it("lists every phone action the planner may hand over, and no other as handed over", () => {
    const handedOver = policy.actions.filter((action) => action.brainHandoff).map((action) => action.skillId).sort();
    expect(handedOver).toEqual(DEVICE_ACTIONS.map((action) => action.id).sort());
    expect(new Set(policy.actions.map((action) => action.skillId)).size).toBe(policy.actions.length);
  });

  it("has the same step limit as the server", () => {
    expect(policy.rules.maxPhoneSteps).toBe(MAX_PHONE_STEPS);
  });

  it("asks for confirmation wherever the server's own action policy would", () => {
    expect(policy.rules.confirmationClasses.sort()).toEqual(["DESTRUCTIVE", "EXTERNAL_COMMUNICATION", "FINANCIAL", "SECURITY_SENSITIVE"]);
    expect(policy.rules.confirmationRisks.sort()).toEqual(["HIGH", "VERY_HIGH"]);
    for (const action of policy.actions) {
      if (policyRequiresConfirmation(action.actionClass, action.risk)) expect(action.confirm, action.skillId).toBe(true);
    }
    for (const action of policy.actions.filter((a) => a.actsInOtherApps)) expect(action.confirm, action.skillId).toBe(true);
  });

  it("names only capabilities the registry has", () => {
    const known = new Set<string>(CAPABILITIES.map((capability) => capability.id));
    for (const action of policy.actions) {
      if (action.capabilityId !== null) expect(known.has(action.capabilityId), `${action.skillId} → ${action.capabilityId}`).toBe(true);
    }
  });

  it("tells the user what ZARVIS never does, in English and Hindi", () => {
    expect(policy.version).toBe(1);
    expect(policy.neverDoes.length).toBeGreaterThanOrEqual(8);
    for (const promise of policy.neverDoes) {
      expect(promise.en.trim()).not.toBe("");
      expect(/[ऀ-ॿ]/.test(promise.hi)).toBe(true);
    }
  });
});
