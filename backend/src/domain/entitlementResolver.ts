import type { AccountEntitlementSnapshot, EntitlementDecision, EntitlementLevel, SkillDefinition } from "./types.js";

/**
 * The single place plan/price logic lives — see SUBSCRIPTIONS.md "Entitlement resolution".
 * Pure and synchronous, mirroring android/domain/entitlement/EntitlementResolver.kt exactly
 * so client-side UX checks and server-side authoritative checks never drift apart.
 */
const RANK_ORDER: EntitlementLevel[] = ["FREE", "TRIAL", "PLUS", "PRO", "BUSINESS", "ENTERPRISE"];

function rank(level: EntitlementLevel): number {
  return RANK_ORDER.indexOf(level);
}

export function resolveEntitlement(
  snapshot: AccountEntitlementSnapshot,
  skill: SkillDefinition,
  now: Date,
): EntitlementDecision {
  const trialExpired = snapshot.plan === "TRIAL" && isTrialExpired(snapshot, now);
  const effectivePlan: EntitlementLevel = trialExpired ? "FREE" : snapshot.plan;

  if (rank(effectivePlan) < rank(skill.requiredEntitlement)) {
    return {
      allowed: false,
      reason: trialExpired ? "TRIAL_EXPIRED" : "PLAN_TOO_LOW",
      upgradeTo: skill.requiredEntitlement,
    };
  }

  if (skill.usageCost.value > snapshot.creditBalance) {
    return { allowed: false, reason: "OUT_OF_CREDITS" };
  }

  return { allowed: true };
}

function isTrialExpired(snapshot: AccountEntitlementSnapshot, now: Date): boolean {
  return snapshot.trialExpiresAt !== null && now.getTime() > snapshot.trialExpiresAt.getTime();
}
