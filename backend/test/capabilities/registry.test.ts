import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CAPABILITIES, policyRequiresConfirmation } from "../../src/capabilities/registry.js";

const BLUEPRINT_CAPABILITIES = [
  "microphone", "contacts", "phone_call", "notification_read", "notification_speak", "camera", "files", "photos",
  "location", "bluetooth", "alarms", "calendar", "accessibility", "usage_stats", "default_assistant", "screen_interaction",
];

describe("Phase 1 capability registry", () => {
  it("defines exactly the blueprint §10 capabilities, once each", () => {
    expect(CAPABILITIES.map((c) => c.id).sort()).toEqual([...BLUEPRINT_CAPABILITIES].sort());
  });

  it("defines every blueprint field for every capability", () => {
    for (const c of CAPABILITIES) {
      for (const field of ["name", "requiredAccess", "androidRequirements", "dataExposure", "denialBehavior", "fallback", "revocationHandling", "settingsDestination"] as const) {
        expect(c[field].trim().length, `${c.id}.${field}`).toBeGreaterThan(0);
      }
      for (const field of ["why", "data", "notAutomatic", "revoke"] as const) {
        expect(c.rationale[field].trim().length, `${c.id}.rationale.${field}`).toBeGreaterThan(0);
      }
      expect(Array.isArray(c.supportedActions) && Array.isArray(c.unsupportedActions)).toBe(true);
      expect(c.platforms.web.note.length > 0 && c.platforms.android.note.length > 0).toBe(true);
    }
  });

  it("never claims WORKING without real-device verification evidence (none is recorded yet)", () => {
    for (const c of CAPABILITIES) {
      expect(c.platforms.android.status, c.id).not.toBe("WORKING");
      expect(c.platforms.web.status, c.id).not.toBe("WORKING");
    }
  });

  it("a capability with no supported actions is never shown as PARTIAL or WORKING on Android", () => {
    for (const c of CAPABILITIES.filter((c) => c.supportedActions.length === 0)) {
      expect(["PLANNED", "UNSUPPORTED"]).toContain(c.platforms.android.status);
    }
  });

  it("shared/capability-registry.json matches the TypeScript registry (run npm run capabilities:export)", () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), "../../../shared/capability-registry.json");
    const json = JSON.parse(readFileSync(file, "utf8"));
    expect(json.capabilities).toEqual(JSON.parse(JSON.stringify(CAPABILITIES)));
  });

  it("policy: external/financial/destructive/security actions and HIGH+ risk always need confirmation", () => {
    expect(policyRequiresConfirmation("EXTERNAL_COMMUNICATION", "LOW")).toBe(true);
    expect(policyRequiresConfirmation("FINANCIAL", "LOW")).toBe(true);
    expect(policyRequiresConfirmation("DESTRUCTIVE", "LOW")).toBe(true);
    expect(policyRequiresConfirmation("SECURITY_SENSITIVE", "LOW")).toBe(true);
    expect(policyRequiresConfirmation("READ_ONLY", "HIGH")).toBe(true);
    expect(policyRequiresConfirmation("READ_ONLY", "VERY_HIGH")).toBe(true);
    expect(policyRequiresConfirmation("READ_ONLY", "MEDIUM")).toBe(false);
    expect(policyRequiresConfirmation("LOW_IMPACT", "LOW")).toBe(false);
  });

  it("phone calls require a per-action confirmation", () => {
    const call = CAPABILITIES.find((c) => c.id === "phone_call")!;
    expect(call.confirmation).toBe("PER_ACTION");
    expect(policyRequiresConfirmation(call.actionClass, call.risk)).toBe(true);
  });
});
