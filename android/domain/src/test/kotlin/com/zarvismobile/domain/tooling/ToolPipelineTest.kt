package com.zarvismobile.domain.tooling

import com.zarvismobile.domain.FakeConfirmationPort
import com.zarvismobile.domain.FakeEntitlementPort
import com.zarvismobile.domain.FakePermissionPort
import com.zarvismobile.domain.FakeUsagePort
import com.zarvismobile.domain.FixedClockPort
import com.zarvismobile.domain.entity.AccountEntitlementSnapshot
import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.domain.entity.PreparedAction
import com.zarvismobile.domain.entity.SkillPreparer
import com.zarvismobile.domain.port.ConfirmationPort
import com.zarvismobile.domain.port.EntitlementPort
import com.zarvismobile.domain.port.PermissionPort
import com.zarvismobile.domain.entity.EntitlementLevel
import com.zarvismobile.domain.entity.JsonSchema
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillCategory
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillHandler
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.SkillResult
import com.zarvismobile.domain.entity.ToolCall
import com.zarvismobile.domain.entity.ToolExecutionOutcome
import com.zarvismobile.domain.entity.UsageCost
import java.time.Instant
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ToolPipelineTest {

    private val now = Instant.parse("2026-08-26T00:00:00Z")
    private val context = SkillExecutionContext(accountId = "acc-1")
    private val proSnapshot = AccountEntitlementSnapshot("acc-1", EntitlementLevel.PRO, trialExpiresAt = null, creditBalance = 100)

    private fun registryWith(skill: SkillDefinition) = SkillRegistry().apply { register(skill) }

    private fun lowRiskSkill(
        id: String = "web.search",
        requiredPermissions: List<PermissionType> = emptyList(),
        usageCost: UsageCost = UsageCost.FREE,
        handler: SkillHandler = SkillHandler { _, _ -> SkillResult.Success(mapOf("hits" to 3), "Found 3 results.") },
    ) = SkillDefinition(
        id = id,
        name = "Web Search",
        description = "test skill",
        category = SkillCategory.WEB,
        requiredPermissions = requiredPermissions,
        requiredEntitlement = EntitlementLevel.FREE,
        usageCost = usageCost,
        riskLevel = RiskLevel.LOW,
        requiresConfirmation = false,
        inputSchema = JsonSchema(requiredFields = setOf("query")),
        handler = handler,
    )

    private fun pipeline(
        skill: SkillDefinition,
        permissionPort: FakePermissionPort = FakePermissionPort(),
        usagePort: FakeUsagePort = FakeUsagePort(100),
        confirmationPort: FakeConfirmationPort = FakeConfirmationPort(approve = true),
        snapshot: AccountEntitlementSnapshot = proSnapshot,
    ) = ToolPipeline(
        registry = registryWith(skill),
        permissionPort = permissionPort,
        entitlementPort = FakeEntitlementPort(snapshot),
        usagePort = usagePort,
        confirmationPort = confirmationPort,
        clock = FixedClockPort(now),
    )

    @Test
    fun `unknown skill id is reported as not found`() = runTest {
        val pipeline = pipeline(lowRiskSkill())
        val outcome = pipeline.execute(ToolCall(skillId = "does.not_exist", input = SkillInput()), context)
        assertIs<ToolExecutionOutcome.SkillNotFound>(outcome)
    }

    @Test
    fun `missing required input field fails validation before anything else runs`() = runTest {
        val usagePort = FakeUsagePort(100)
        val pipeline = pipeline(lowRiskSkill(), usagePort = usagePort)
        val outcome = pipeline.execute(ToolCall(skillId = "web.search", input = SkillInput(emptyMap())), context)
        val failed = assertIs<ToolExecutionOutcome.ValidationFailed>(outcome)
        assertEquals(setOf("query"), failed.missingFields)
        assertTrue(usagePort.charges.isEmpty(), "a validation failure must never charge credits")
    }

    @Test
    fun `missing permission blocks execution`() = runTest {
        val skill = lowRiskSkill(requiredPermissions = listOf(PermissionType.CONTACTS))
        val pipeline = pipeline(skill, permissionPort = FakePermissionPort(granted = emptySet()))
        val outcome = pipeline.execute(ToolCall(skillId = skill.id, input = SkillInput(mapOf("query" to "x"))), context)
        val denied = assertIs<ToolExecutionOutcome.PermissionDenied>(outcome)
        assertEquals(listOf(PermissionType.CONTACTS), denied.missing)
    }

    @Test
    fun `entitlement denial blocks execution and never charges`() = runTest {
        val skill = lowRiskSkill().copy(requiredEntitlement = EntitlementLevel.PRO)
        val freeSnapshot = AccountEntitlementSnapshot("acc-1", EntitlementLevel.FREE, trialExpiresAt = null, creditBalance = 100)
        val usagePort = FakeUsagePort(100)
        val pipeline = pipeline(skill, usagePort = usagePort, snapshot = freeSnapshot)
        val outcome = pipeline.execute(ToolCall(skillId = skill.id, input = SkillInput(mapOf("query" to "x"))), context)
        assertIs<ToolExecutionOutcome.EntitlementDenied>(outcome)
        assertTrue(usagePort.charges.isEmpty())
    }

    @Test
    fun `MEDIUM risk skill declined at confirmation never executes the handler`() = runTest {
        var handlerCalled = false
        val skill = lowRiskSkill(
            handler = SkillHandler { _, _ -> handlerCalled = true; SkillResult.Success(emptyMap(), "should not happen") },
        ).copy(riskLevel = RiskLevel.MEDIUM, requiresConfirmation = true)
        val pipeline = pipeline(skill, confirmationPort = FakeConfirmationPort(approve = false))
        val outcome = pipeline.execute(ToolCall(skillId = skill.id, input = SkillInput(mapOf("query" to "x"))), context)
        assertIs<ToolExecutionOutcome.ConfirmationDeclined>(outcome)
        assertTrue(!handlerCalled, "declining confirmation must prevent the handler from running")
    }

    @Test
    fun `successful execution charges the declared usage cost exactly once`() = runTest {
        val skill = lowRiskSkill(usageCost = UsageCost(5))
        val usagePort = FakeUsagePort(100)
        val pipeline = pipeline(skill, usagePort = usagePort)
        val outcome = pipeline.execute(ToolCall(skillId = skill.id, input = SkillInput(mapOf("query" to "x"))), context)
        val success = assertIs<ToolExecutionOutcome.Success>(outcome)
        assertEquals(5, success.chargedCredits)
        assertEquals(1, usagePort.charges.size)
        assertEquals(95, usagePort.balance)
    }

    @Test
    fun `a handler success with a blank summary fails verification and is not charged`() = runTest {
        val skill = lowRiskSkill(
            usageCost = UsageCost(5),
            handler = SkillHandler { _, _ -> SkillResult.Success(mapOf("x" to 1), "") },
        )
        val usagePort = FakeUsagePort(100)
        val pipeline = pipeline(skill, usagePort = usagePort)
        val outcome = pipeline.execute(ToolCall(skillId = skill.id, input = SkillInput(mapOf("query" to "x"))), context)
        assertIs<ToolExecutionOutcome.VerificationFailed>(outcome)
        assertTrue(usagePort.charges.isEmpty())
    }

    @Test
    fun `handler failure is surfaced without charging credits`() = runTest {
        val skill = lowRiskSkill(
            usageCost = UsageCost(5),
            handler = SkillHandler { _, _ -> SkillResult.Failure("boom", "Something went wrong.") },
        )
        val usagePort = FakeUsagePort(100)
        val pipeline = pipeline(skill, usagePort = usagePort)
        val outcome = pipeline.execute(ToolCall(skillId = skill.id, input = SkillInput(mapOf("query" to "x"))), context)
        val failed = assertIs<ToolExecutionOutcome.ExecutionFailed>(outcome)
        assertEquals("boom", failed.result.reason)
        assertTrue(usagePort.charges.isEmpty())
    }

    @Test
    fun `a thrown platform error becomes an honest failure, not a crash, and is not charged`() = runTest {
        val skill = lowRiskSkill(
            usageCost = UsageCost(5),
            handler = SkillHandler { _, _ -> throw SecurityException("permission revoked mid-call") },
        )
        val usagePort = FakeUsagePort(100)
        val outcome = pipeline(skill, usagePort = usagePort).execute(ToolCall(skillId = skill.id, input = SkillInput(mapOf("query" to "x"))), context)
        val failed = assertIs<ToolExecutionOutcome.ExecutionFailed>(outcome)
        assertEquals("handler_error", failed.result.reason)
        assertTrue(usagePort.charges.isEmpty())
    }

    @Test
    fun `a blank required field is treated as missing`() = runTest {
        val outcome = pipeline(lowRiskSkill()).execute(ToolCall(skillId = "web.search", input = SkillInput(mapOf("query" to "  "))), context)
        assertIs<ToolExecutionOutcome.ValidationFailed>(outcome)
    }

    @Test
    fun `policy forces confirmation for external communication even when the skill does not ask`() = runTest {
        val confirmations = FakeConfirmationPort(approve = false)
        val skill = lowRiskSkill().copy(actionClass = ActionClass.EXTERNAL_COMMUNICATION, requiresConfirmation = false)
        val outcome = pipeline(skill, confirmationPort = confirmations).execute(ToolCall(skillId = skill.id, input = SkillInput(mapOf("query" to "x"))), context)
        assertIs<ToolExecutionOutcome.ConfirmationDeclined>(outcome)
        assertEquals(ActionClass.EXTERNAL_COMMUNICATION, confirmations.lastRequest?.actionClass)
    }

    @Test
    fun `the confirmation shows the prepared exact action and the handler receives the prepared input`() = runTest {
        var received: Map<String, Any?> = emptyMap()
        val confirmations = FakeConfirmationPort(approve = true)
        val skill = lowRiskSkill(handler = SkillHandler { input, _ -> received = input.values; SkillResult.Success(emptyMap(), "done") })
            .copy(
                riskLevel = RiskLevel.HIGH,
                preparer = SkillPreparer { input, _ -> PreparedAction.Ready("Call Mom at 900", SkillInput(input.values + ("resolved" to "900"))) },
            )
        val outcome = pipeline(skill, confirmationPort = confirmations).execute(ToolCall(skillId = skill.id, input = SkillInput(mapOf("query" to "mom"))), context)
        assertIs<ToolExecutionOutcome.Success>(outcome)
        assertEquals("Call Mom at 900", confirmations.lastRequest?.summary)
        assertEquals("900", received["resolved"])
    }

    @Test
    fun `a failed prepare stops before confirmation`() = runTest {
        val confirmations = FakeConfirmationPort(approve = true)
        val skill = lowRiskSkill().copy(
            riskLevel = RiskLevel.HIGH,
            preparer = SkillPreparer { _, _ -> PreparedAction.Failed(SkillResult.Failure("contact_not_found", "No such contact.")) },
        )
        val outcome = pipeline(skill, confirmationPort = confirmations).execute(ToolCall(skillId = skill.id, input = SkillInput(mapOf("query" to "x"))), context)
        assertEquals("contact_not_found", assertIs<ToolExecutionOutcome.ExecutionFailed>(outcome).result.reason)
        assertEquals(null, confirmations.lastRequest)
    }

    @Test
    fun `permission revoked while the confirmation dialog was open is caught before acting`() = runTest {
        var granted = true
        val permissions = PermissionPort { granted }
        val confirmations = ConfirmationPort { granted = false; true }
        var handlerCalled = false
        val skill = lowRiskSkill(
            requiredPermissions = listOf(PermissionType.PHONE_CALL),
            handler = SkillHandler { _, _ -> handlerCalled = true; SkillResult.Success(emptyMap(), "called") },
        ).copy(riskLevel = RiskLevel.HIGH)
        val pipeline = ToolPipeline(registryWith(skill), permissions, FakeEntitlementPort(proSnapshot), FakeUsagePort(100), confirmations, FixedClockPort(now))
        val outcome = pipeline.execute(ToolCall(skillId = skill.id, input = SkillInput(mapOf("query" to "x"))), context)
        assertIs<ToolExecutionOutcome.PermissionDenied>(outcome)
        assertTrue(!handlerCalled)
    }

    @Test
    fun `a free zero-cost skill needs no entitlement network call, so device actions work offline`() = runTest {
        val offline = EntitlementPort { error("offline") }
        val skill = lowRiskSkill()
        val pipeline = ToolPipeline(registryWith(skill), FakePermissionPort(), offline, FakeUsagePort(0), FakeConfirmationPort(true), FixedClockPort(now))
        assertIs<ToolExecutionOutcome.Success>(pipeline.execute(ToolCall(skillId = skill.id, input = SkillInput(mapOf("query" to "x"))), context))
    }
}
