import type { SkillExecutionContext } from "../domain/types.js";
import type { ConfirmationPort, ConfirmationRequest } from "../tooling/ports.js";

/**
 * The backend has no interactive dialog to show — the client obtains confirmation (a
 * Compose confirmation dialog on Android, per MASTER_SPEC.md §7) and replays the same
 * request with `confirmed: true`. A first call without it comes back
 * `confirmation_declined`, which the API layer surfaces as "needs confirmation" so the
 * client knows to prompt and retry — see ARCHITECTURE.md.
 */
export class RequestFlagConfirmationPort implements ConfirmationPort {
  async confirm(_request: ConfirmationRequest, context: SkillExecutionContext): Promise<boolean> {
    return context.confirmed === true;
  }
}
