package com.jarvismobile.domain.entitlement

import com.jarvismobile.domain.entity.AccountEntitlementSnapshot
import com.jarvismobile.domain.entity.EntitlementDecision
import com.jarvismobile.domain.entity.EntitlementDenialReason
import com.jarvismobile.domain.entity.EntitlementLevel
import com.jarvismobile.domain.entity.SkillDefinition
import java.time.Instant

/**
 * The single place plan/price logic lives (SUBSCRIPTIONS.md "Entitlement resolution").
 * Pure and synchronous — fetching the [AccountEntitlementSnapshot] over the network is the
 * [com.jarvismobile.domain.port.EntitlementPort]'s job, so this class is trivially unit-testable.
 */
object EntitlementResolver {

    private val rankOrder = listOf(
        EntitlementLevel.FREE,
        EntitlementLevel.TRIAL,
        EntitlementLevel.PLUS,
        EntitlementLevel.PRO,
        EntitlementLevel.BUSINESS,
        EntitlementLevel.ENTERPRISE,
    )

    fun resolve(
        snapshot: AccountEntitlementSnapshot,
        skill: SkillDefinition,
        now: Instant,
    ): EntitlementDecision {
        val trialExpired = snapshot.plan == EntitlementLevel.TRIAL && isTrialExpired(snapshot, now)
        val effectivePlan = if (trialExpired) EntitlementLevel.FREE else snapshot.plan

        if (rank(effectivePlan) < rank(skill.requiredEntitlement)) {
            val reason = if (trialExpired) EntitlementDenialReason.TRIAL_EXPIRED else EntitlementDenialReason.PLAN_TOO_LOW
            return EntitlementDecision.Denied(reason, upgradeTo = skill.requiredEntitlement)
        }

        if (skill.usageCost.value > snapshot.creditBalance) {
            return EntitlementDecision.Denied(EntitlementDenialReason.OUT_OF_CREDITS, upgradeTo = null)
        }

        return EntitlementDecision.Allowed
    }

    private fun isTrialExpired(snapshot: AccountEntitlementSnapshot, now: Instant): Boolean =
        snapshot.trialExpiresAt?.let { now.isAfter(it) } ?: false

    private fun rank(level: EntitlementLevel): Int = rankOrder.indexOf(level)
}
