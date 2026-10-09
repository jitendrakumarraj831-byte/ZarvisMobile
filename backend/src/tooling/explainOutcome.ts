import type { ToolExecutionOutcome } from "../domain/types.js";

/** Maps every pipeline outcome to an honest, user-facing explanation. */
export function explainOutcome(outcome: ToolExecutionOutcome): string {
  switch (outcome.kind) {
    case "success":
      return outcome.result.summary;
    case "skill_not_found":
      return "I don't have a skill for that yet.";
    case "validation_failed":
      return `I'm missing some details before I can do that: ${outcome.missingFields.join(", ")}.`;
    case "permission_denied":
      return `This needs a permission that isn't granted yet: ${outcome.missing.join(", ")}.`;
    case "entitlement_denied":
      return explainEntitlementDenial(outcome.decision);
    case "confirmation_required":
      return `I need your confirmation before I do this: ${outcome.confirmation.action} — approve or decline it below. Nothing has been done yet.`;
    case "confirmation_declined":
      return "You declined this action, so it was not performed.";
    case "execution_failed":
      return outcome.result.userMessage;
    case "verification_failed":
      return "Something went wrong while I was verifying the result, so I did not complete this action.";
  }
}

function explainEntitlementDenial(
  decision: Extract<ToolExecutionOutcome, { kind: "entitlement_denied" }>[ "decision" ],
): string {
  switch (decision.reason) {
    case "TRIAL_EXPIRED":
      return `Your trial has ended — upgrade to ${decision.upgradeTo ?? "a paid plan"} to keep using this.`;
    case "PLAN_TOO_LOW":
      return `This needs the ${decision.upgradeTo ?? "next"} plan.`;
    case "OUT_OF_CREDITS":
      return "You're out of credits for this action right now.";
  }
}
