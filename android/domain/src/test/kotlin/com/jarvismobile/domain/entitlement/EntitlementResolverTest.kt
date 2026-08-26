package com.jarvismobile.domain.entitlement

import com.jarvismobile.domain.entity.AccountEntitlementSnapshot
import com.jarvismobile.domain.entity.EntitlementDecision
import com.jarvismobile.domain.entity.EntitlementDenialReason
import com.jarvismobile.domain.entity.EntitlementLevel
import com.jarvismobile.domain.entity.RiskLevel
import com.jarvismobile.domain.entity.SkillCategory
import com.jarvismobile.domain.entity.SkillDefinition
import com.jarvismobile.domain.entity.SkillHandler
import com.jarvismobile.domain.entity.SkillResult
import com.jarvismobile.domain.entity.UsageCost
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class EntitlementResolverTest {

    private val now = Instant.parse("2026-08-26T00:00:00Z")

    private fun skill(
        requiredEntitlement: EntitlementLevel = EntitlementLevel.FREE,
        usageCost: UsageCost = UsageCost.FREE,
    ) = SkillDefinition(
        id = "web.search",
        name = "Web Search",
        description = "test",
        category = SkillCategory.WEB,
        requiredEntitlement = requiredEntitlement,
        usageCost = usageCost,
        riskLevel = RiskLevel.LOW,
        requiresConfirmation = false,
        handler = SkillHandler { _, _ -> SkillResult.Success(emptyMap(), "ok") },
    )

    @Test
    fun `FREE plan is denied a PRO-required skill`() {
        val snapshot = AccountEntitlementSnapshot("acc-1", EntitlementLevel.FREE, trialExpiresAt = null, creditBalance = 100)
        val decision = EntitlementResolver.resolve(snapshot, skill(requiredEntitlement = EntitlementLevel.PRO), now)
        val denied = assertIs<EntitlementDecision.Denied>(decision)
        assertEquals(EntitlementDenialReason.PLAN_TOO_LOW, denied.reason)
        assertEquals(EntitlementLevel.PRO, denied.upgradeTo)
    }

    @Test
    fun `active trial allows a TRIAL-tier skill`() {
        val snapshot = AccountEntitlementSnapshot(
            "acc-1", EntitlementLevel.TRIAL, trialExpiresAt = now.plus(1, ChronoUnit.DAYS), creditBalance = 100,
        )
        val decision = EntitlementResolver.resolve(snapshot, skill(requiredEntitlement = EntitlementLevel.TRIAL), now)
        assertEquals(EntitlementDecision.Allowed, decision)
    }

    @Test
    fun `expired trial falls back to FREE and is denied a TRIAL-tier skill`() {
        val snapshot = AccountEntitlementSnapshot(
            "acc-1", EntitlementLevel.TRIAL, trialExpiresAt = now.minus(1, ChronoUnit.DAYS), creditBalance = 100,
        )
        val decision = EntitlementResolver.resolve(snapshot, skill(requiredEntitlement = EntitlementLevel.TRIAL), now)
        val denied = assertIs<EntitlementDecision.Denied>(decision)
        assertEquals(EntitlementDenialReason.TRIAL_EXPIRED, denied.reason)
    }

    @Test
    fun `PRO plan is allowed a PRO-required skill`() {
        val snapshot = AccountEntitlementSnapshot("acc-1", EntitlementLevel.PRO, trialExpiresAt = null, creditBalance = 100)
        val decision = EntitlementResolver.resolve(snapshot, skill(requiredEntitlement = EntitlementLevel.PRO), now)
        assertEquals(EntitlementDecision.Allowed, decision)
    }

    @Test
    fun `insufficient credit balance is denied even when the plan is sufficient`() {
        val snapshot = AccountEntitlementSnapshot("acc-1", EntitlementLevel.PRO, trialExpiresAt = null, creditBalance = 1)
        val decision = EntitlementResolver.resolve(snapshot, skill(usageCost = UsageCost(5)), now)
        val denied = assertIs<EntitlementDecision.Denied>(decision)
        assertEquals(EntitlementDenialReason.OUT_OF_CREDITS, denied.reason)
    }
}
