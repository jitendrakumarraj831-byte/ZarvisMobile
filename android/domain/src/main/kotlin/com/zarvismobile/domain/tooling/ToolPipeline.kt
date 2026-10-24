package com.zarvismobile.domain.tooling

import com.zarvismobile.domain.capability.ActionPolicy
import com.zarvismobile.domain.entitlement.EntitlementResolver
import com.zarvismobile.domain.entity.ConfirmationRequest
import com.zarvismobile.domain.entity.EntitlementDecision
import com.zarvismobile.domain.entity.EntitlementLevel
import com.zarvismobile.domain.entity.PreparedAction
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.SkillResult
import com.zarvismobile.domain.entity.ToolCall
import com.zarvismobile.domain.entity.ToolExecutionOutcome
import com.zarvismobile.domain.port.ClockPort
import com.zarvismobile.domain.port.ConfirmationPort
import com.zarvismobile.domain.port.EntitlementPort
import com.zarvismobile.domain.port.PermissionPort
import com.zarvismobile.domain.port.SystemClockPort
import com.zarvismobile.domain.port.UsagePort
import com.zarvismobile.domain.policy.AutomationJournal
import com.zarvismobile.domain.policy.AutomationOutcome
import com.zarvismobile.domain.policy.AutomationPolicy
import com.zarvismobile.domain.policy.AutomationRecord
import com.zarvismobile.domain.policy.AutomationRule
import com.zarvismobile.domain.policy.AutomationSwitch
import com.zarvismobile.domain.privacy.SensitiveApps
import kotlin.coroutines.cancellation.CancellationException

/**
 * The mandatory on-device security boundary — mirrors backend/src/tooling/toolPipeline.ts.
 * No skill handler is ever invoked except through this pipeline, and no stage can be skipped.
 *
 * Registry -> Automation policy (on-device skills) -> Validation -> Permission (live Android state) -> Entitlement -> Prepare ->
 * Policy/Confirmation (exact action) -> Execution -> Verification -> Charge
 *
 * Every on-device skill also runs under the phone-automation safety [policy] (shared/automation-policy.json,
 * AUTOMATION_SECURITY_POLICY.md): one that is not in the policy, or declares other rules than the policy, is refused (default
 * deny); none runs while the user has paused phone actions ([automationSwitch]); one that reads or acts inside the app in front is
 * refused for sensitive apps and Android's own security screens; and the confirmation the policy requires is asked for. Each attempt,
 * however it ended, is written to the phone's [journal].
 */
class ToolPipeline(
    private val registry: SkillRegistry,
    private val permissionPort: PermissionPort,
    private val entitlementPort: EntitlementPort,
    private val usagePort: UsagePort,
    private val confirmationPort: ConfirmationPort,
    private val clock: ClockPort = SystemClockPort,
    val policy: AutomationPolicy = AutomationPolicy.default,
    private val automationSwitch: AutomationSwitch = AutomationSwitch.NEVER_PAUSED,
    private val journal: AutomationJournal = AutomationJournal.NONE,
) {
    suspend fun execute(call: ToolCall, context: SkillExecutionContext): ToolExecutionOutcome {
        // 1. Tool Registry
        val skill = registry.find(call.skillId)
            ?: return ToolExecutionOutcome.SkillNotFound(call.skillId)
        if (!skill.executesOnDevice) return runStages(skill, call, context, null)

        val described = Described(skill.name)
        val outcome = runStages(skill, call, context, described)
        record(skill, described.text, outcome)
        return outcome
    }

    /**
     * The policy's answer for [skill] before anything is asked of the user (an Android permission explanation, a confirmation):
     * the refusal, which is also written to the history, or null when it may go on. [execute] checks the same again.
     */
    suspend fun refuseByPolicy(skill: SkillDefinition, context: SkillExecutionContext): ToolExecutionOutcome.PolicyRefused? {
        if (!skill.executesOnDevice) return null
        val refusal = policyRefusal(skill, context.locale) ?: return null
        record(skill, skill.name, refusal)
        return refusal
    }

    /** True while phone actions are paused, and when the setting cannot be read (fail closed). */
    suspend fun automationPaused(): Boolean = pauseState() != false

    /** The pause setting: true or false, or null when it cannot be read. */
    private suspend fun pauseState(): Boolean? = try {
        automationSwitch.isPaused()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    /** What the user was told would happen, once it is known (after Prepare); the skill's name before that. */
    private class Described(var text: String)

    private suspend fun runStages(
        skill: SkillDefinition,
        call: ToolCall,
        context: SkillExecutionContext,
        described: Described?,
    ): ToolExecutionOutcome {
        // 1b. Automation policy — before anything is asked of the user.
        val rule: AutomationRule? = if (skill.executesOnDevice) {
            policyRefusal(skill, context.locale)?.let { return it }
            policy.rule(skill.id)
        } else {
            null
        }

        // 2. Validation — present and non-blank
        val missingFields = skill.inputSchema.requiredFields.filter { field ->
            val value = call.input.values[field]
            value == null || (value is String && value.isBlank())
        }.toSet()
        if (missingFields.isNotEmpty()) {
            return ToolExecutionOutcome.ValidationFailed(missingFields)
        }

        // 3. Permission — PermissionPort reads Android's live state, re-checked at execution time.
        val missingPermissions = skill.requiredPermissions.filterNot { permissionPort.isGranted(it) }
        if (missingPermissions.isNotEmpty()) {
            return ToolExecutionOutcome.PermissionDenied(missingPermissions)
        }

        // 4. Entitlement. A FREE, zero-cost skill is allowed for every plan and balance, so it
        // needs no network round trip (device actions keep working offline); anything else
        // asks the server-authoritative snapshot.
        if (!isFreeForEveryone(skill)) {
            val snapshot = entitlementPort.snapshot(context.accountId)
            val decision = EntitlementResolver.resolve(snapshot, skill, clock.now())
            if (decision is EntitlementDecision.Denied) {
                return ToolExecutionOutcome.EntitlementDenied(decision)
            }
        }

        // 5. Prepare — resolve exactly what will happen (e.g. contact → number) before confirming.
        var input: SkillInput = call.input
        var actionDescription = skill.description
        skill.preparer?.let { preparer ->
            when (val prepared = safely(skill) { preparer.prepare(call.input, context) }) {
                is PreparedAction.Ready -> {
                    input = prepared.input
                    actionDescription = prepared.description
                    described?.text = prepared.description
                }
                is PreparedAction.Failed -> return ToolExecutionOutcome.ExecutionFailed(prepared.failure)
                null -> return ToolExecutionOutcome.ExecutionFailed(handlerError(skill))
            }
        }

        // 5b. An action that reads or acts inside the app in front names the app it resolved; that app is checked here as well as
        // in the skill, so no such action reaches a sensitive app or an Android security screen.
        if (rule?.actsInOtherApps == true) {
            targetRefusal(skill, input, context.locale)?.let { return it }
        }

        // 6. Policy + confirmation of the exact action. The policy can only add a requirement.
        if (ActionPolicy.requiresConfirmation(skill) || (rule != null && policy.requiresConfirmation(rule))) {
            val approved = confirmationPort.confirm(
                ConfirmationRequest(
                    skillId = skill.id,
                    summary = actionDescription,
                    riskLevel = skill.riskLevel,
                    actionClass = skill.actionClass,
                    capabilityId = skill.capabilityId,
                ),
            )
            if (!approved) {
                return ToolExecutionOutcome.ConfirmationDeclined(skill.id)
            }
            // Permission can be revoked while the dialog is open — re-check right before acting.
            val revoked = skill.requiredPermissions.filterNot { permissionPort.isGranted(it) }
            if (revoked.isNotEmpty()) {
                return ToolExecutionOutcome.PermissionDenied(revoked)
            }
            // So can phone actions be paused: check again right before acting.
            if (rule != null && pauseState() != false) return paused(skill, context.locale)
        }

        // 7. Execution — a thrown platform error is an honest failure, never a crash.
        val result = safely(skill) { skill.handler.execute(input, context) } ?: handlerError(skill)
        if (result is SkillResult.Failure) {
            return ToolExecutionOutcome.ExecutionFailed(result)
        }
        check(result is SkillResult.Success)

        // 8. Verification — never report success on an empty/absent result
        if (result.summary.isBlank()) {
            return ToolExecutionOutcome.VerificationFailed(
                skillId = skill.id,
                reason = "Skill reported success with no result summary",
            )
        }

        // Charge only after a verified success — a blocked/failed action is never charged.
        val chargedCredits = if (skill.usageCost.value > 0) {
            usagePort.charge(context.accountId, skill.usageCost, skill.id)
            skill.usageCost.value
        } else {
            0
        }

        return ToolExecutionOutcome.Success(result, chargedCredits)
    }

    private suspend fun policyRefusal(skill: SkillDefinition, locale: String): ToolExecutionOutcome.PolicyRefused? {
        val rule = policy.rule(skill.id) ?: return refusal(
            skill, "not_in_policy", locale,
            "This phone action isn't in ZARVIS's safety policy, so it was not run.",
            "यह phone action ZARVIS की safety policy में नहीं है, इसलिए नहीं चलाया गया।",
        )
        // A skill that declares other rules than the policy is refused rather than run under either (fail closed).
        if (rule.risk != skill.riskLevel || rule.actionClass != skill.actionClass || rule.capabilityId != skill.capabilityId) {
            return refusal(
                skill, "policy_mismatch", locale,
                "This phone action doesn't match ZARVIS's safety policy, so it was not run.",
                "यह phone action ZARVIS की safety policy से मेल नहीं खाता, इसलिए नहीं चलाया गया।",
            )
        }
        return when (pauseState()) {
            false -> null
            true -> paused(skill, locale)
            null -> refusal(
                skill, "pause_setting_unreadable", locale,
                "ZARVIS couldn't read its phone action safety setting, so nothing was done on the phone. Please try again.",
                "ZARVIS अपनी phone action safety setting पढ़ नहीं पाया, इसलिए phone पर कुछ नहीं किया गया। कृपया फिर से कोशिश करें।",
            )
        }
    }

    private fun paused(skill: SkillDefinition, locale: String) = refusal(
        skill, AUTOMATION_PAUSED, locale,
        "Phone actions are paused in ZARVIS Settings › Phone action safety, so nothing was done on the phone. Turn them back on there to continue.",
        "फ़ोन एक्शन ZARVIS सेटिंग्स › फ़ोन एक्शन सुरक्षा में रुके हुए हैं, इसलिए फ़ोन पर कुछ नहीं किया गया। फिर से चालू करने के लिए वहीं switch बदलें।",
    )

    private fun targetRefusal(skill: SkillDefinition, input: SkillInput, locale: String): ToolExecutionOutcome.PolicyRefused? {
        val target = (input.values["targetPackage"] as? String)?.takeIf { it.isNotBlank() }
            ?: return refusal(
                skill, "target_not_checked", locale,
                "ZARVIS couldn't check which app this would reach, so nothing was done.",
                "ZARVIS यह जाँच नहीं पाया कि यह किस app तक पहुँचेगा, इसलिए कुछ नहीं किया गया।",
            )
        return when {
            SensitiveApps.isSecuritySurface(target) -> refusal(
                skill, "security_surface", locale,
                "I don't read or tap Android's own settings, permission or install screens, so nothing was done.",
                "मैं Android की settings, permission या install screens में न पढ़ता हूँ, न tap करता हूँ, इसलिए कुछ नहीं किया गया।",
            )
            SensitiveApps.isSensitivePackage(target) -> refusal(
                skill, "sensitive_app", locale,
                "That looks like a banking, payment, trading, authenticator or password app, so I won't read or tap its screen.",
                "यह banking, payment, trading, authenticator या password app लगता है, इसलिए मैं इसकी screen न पढ़ूँगा, न tap करूँगा।",
            )
            else -> null
        }
    }

    private fun refusal(skill: SkillDefinition, reason: String, locale: String, en: String, hi: String) =
        ToolExecutionOutcome.PolicyRefused(skill.id, reason, if (locale.startsWith("hi")) hi else en)

    /** Writes one attempt to the phone's history. A history that cannot be written never changes the action's outcome. */
    private suspend fun record(skill: SkillDefinition, action: String, outcome: ToolExecutionOutcome) {
        try {
            journal.record(AutomationRecord(clock.now(), skill.id, action, historyOutcome(outcome)))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // The action's own result stands; the history only misses this entry.
        }
    }

    private fun isFreeForEveryone(skill: SkillDefinition): Boolean =
        skill.requiredEntitlement == EntitlementLevel.FREE && skill.usageCost.value == 0

    private inline fun <T> safely(skill: SkillDefinition, block: () -> T): T? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    companion object {
        const val AUTOMATION_PAUSED = "automation_paused"

        /** Preparer failures that are the skill's own safety refusals, so the history says "refused" rather than "failed". */
        private val SAFETY_REFUSALS = setOf("blocked_label", "sensitive_app", "security_surface")

        fun historyOutcome(outcome: ToolExecutionOutcome): AutomationOutcome = when (outcome) {
            is ToolExecutionOutcome.Success -> if (outcome.result.userActionRequired) AutomationOutcome.YOUR_TURN else AutomationOutcome.DONE
            is ToolExecutionOutcome.ConfirmationDeclined -> AutomationOutcome.DECLINED
            is ToolExecutionOutcome.PolicyRefused ->
                if (outcome.reason == AUTOMATION_PAUSED) AutomationOutcome.PAUSED else AutomationOutcome.REFUSED
            is ToolExecutionOutcome.PermissionDenied -> AutomationOutcome.NEEDS_ACCESS
            is ToolExecutionOutcome.EntitlementDenied -> AutomationOutcome.REFUSED
            is ToolExecutionOutcome.ExecutionFailed ->
                if (outcome.result.reason in SAFETY_REFUSALS) AutomationOutcome.REFUSED else AutomationOutcome.FAILED
            is ToolExecutionOutcome.SkillNotFound,
            is ToolExecutionOutcome.ValidationFailed,
            is ToolExecutionOutcome.VerificationFailed,
            -> AutomationOutcome.FAILED
        }
    }

    private fun handlerError(skill: SkillDefinition) = SkillResult.Failure(
        reason = "handler_error",
        userMessage = "${skill.name} ran into an error, so nothing was completed. Please try again.",
    )
}
