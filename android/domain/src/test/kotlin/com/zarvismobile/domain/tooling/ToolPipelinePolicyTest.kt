package com.zarvismobile.domain.tooling

import com.zarvismobile.domain.FakeConfirmationPort
import com.zarvismobile.domain.FakePermissionPort
import com.zarvismobile.domain.FakeUsagePort
import com.zarvismobile.domain.FixedClockPort
import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.domain.entity.ConfirmationRequest
import com.zarvismobile.domain.entity.JsonSchema
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.entity.PreparedAction
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillCategory
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillHandler
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.SkillPreparer
import com.zarvismobile.domain.entity.SkillResult
import com.zarvismobile.domain.entity.ToolCall
import com.zarvismobile.domain.entity.ToolExecutionOutcome
import com.zarvismobile.domain.policy.AutomationJournal
import com.zarvismobile.domain.policy.AutomationOutcome
import com.zarvismobile.domain.policy.AutomationPolicy
import com.zarvismobile.domain.policy.AutomationRecord
import com.zarvismobile.domain.policy.AutomationSwitch
import com.zarvismobile.domain.port.ConfirmationPort
import java.time.Instant
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The phone-automation policy stages of [ToolPipeline]: default deny, pause, the app an action reaches, confirmation and the history. */
class ToolPipelinePolicyTest {

    private val now = Instant.parse("2026-10-23T10:00:00Z")
    private val context = SkillExecutionContext(accountId = "acc-1")

    private class Journal : AutomationJournal {
        val entries = mutableListOf<AutomationRecord>()
        override suspend fun record(entry: AutomationRecord) {
            entries += entry
        }
    }

    private class Pause(var on: Boolean = false) : AutomationSwitch {
        override suspend fun isPaused() = on
    }

    private var ran = 0

    /** An on-device skill shaped like [id]'s policy entry, unless told otherwise. */
    private fun phoneSkill(
        id: String,
        risk: RiskLevel,
        actionClass: ActionClass,
        capabilityId: String? = null,
        permissions: List<PermissionType> = emptyList(),
        preparer: SkillPreparer? = null,
        result: SkillResult = SkillResult.Success(emptyMap(), "Done on the phone."),
    ) = SkillDefinition(
        id = id,
        name = "Phone action $id",
        description = "a phone action",
        category = SkillCategory.PHONE,
        requiredPermissions = permissions,
        riskLevel = risk,
        actionClass = actionClass,
        capabilityId = capabilityId,
        requiresConfirmation = false,
        executesOnDevice = true,
        inputSchema = JsonSchema(),
        preparer = preparer,
        handler = SkillHandler { _, _ -> ran++; result },
    )

    private val openApp get() = phoneSkill("phone.open_app", RiskLevel.LOW, ActionClass.LOW_IMPACT)

    /** Shaped like screen.tap: confirmed each time, and it names the app it reaches. */
    private fun tap(targetPackage: String?) = phoneSkill(
        "screen.tap", RiskLevel.VERY_HIGH, ActionClass.SECURITY_SENSITIVE, capabilityId = "screen_interaction",
        preparer = SkillPreparer { input, _ ->
            PreparedAction.Ready(
                "Tap \"Next\" in the app in front.",
                SkillInput(input.values + listOfNotNull(targetPackage?.let { "targetPackage" to it })),
            )
        },
    )

    private fun pipeline(
        skill: SkillDefinition,
        journal: AutomationJournal = Journal(),
        pause: AutomationSwitch = Pause(),
        confirmation: ConfirmationPort = FakeConfirmationPort(approve = true),
        policy: AutomationPolicy = AutomationPolicy.default,
        granted: Set<PermissionType> = emptySet(),
    ) = ToolPipeline(
        registry = SkillRegistry().apply { register(skill) },
        permissionPort = FakePermissionPort(granted),
        entitlementPort = { error("free phone actions never ask the server") },
        usagePort = FakeUsagePort(),
        confirmationPort = confirmation,
        clock = FixedClockPort(now),
        policy = policy,
        automationSwitch = pause,
        journal = journal,
    )

    private suspend fun ToolPipeline.run(skillId: String, ctx: SkillExecutionContext = context) =
        execute(ToolCall(skillId = skillId, input = SkillInput()), ctx)

    @Test
    fun `a phone action that is not in the policy is refused before anything is asked or done`() = runTest {
        val journal = Journal()
        val confirmation = FakeConfirmationPort(approve = true)
        val skill = phoneSkill("phone.wipe_everything", RiskLevel.LOW, ActionClass.LOW_IMPACT, permissions = listOf(PermissionType.CONTACTS))

        val outcome = pipeline(skill, journal, confirmation = confirmation).run(skill.id)

        assertIs<ToolExecutionOutcome.PolicyRefused>(outcome)
        assertEquals("not_in_policy", outcome.reason)
        assertEquals(0, ran)
        assertNull(confirmation.lastRequest, "no confirmation is asked for an action the policy does not list")
        assertEquals(listOf(AutomationRecord(now, skill.id, skill.name, AutomationOutcome.REFUSED)), journal.entries)
    }

    @Test
    fun `a phone action that declares weaker rules than the policy is refused rather than run under either`() = runTest {
        // phone.call is HIGH / EXTERNAL_COMMUNICATION in the policy; a skill claiming LOW would otherwise skip the confirmation.
        val skill = phoneSkill("phone.call", RiskLevel.LOW, ActionClass.LOW_IMPACT, capabilityId = "phone_call")

        val outcome = pipeline(skill).run(skill.id)

        assertIs<ToolExecutionOutcome.PolicyRefused>(outcome)
        assertEquals("policy_mismatch", outcome.reason)
        assertEquals(0, ran)
    }

    @Test
    fun `while phone actions are paused none runs, in the user's language, and the early check says the same`() = runTest {
        val journal = Journal()
        val pause = Pause(on = true)
        val pipeline = pipeline(openApp, journal, pause)

        val outcome = pipeline.run(openApp.id)
        val hindi = pipeline.run(openApp.id, context.copy(locale = "hi"))
        val early = pipeline.refuseByPolicy(openApp, context)

        assertIs<ToolExecutionOutcome.PolicyRefused>(outcome)
        assertEquals(ToolPipeline.AUTOMATION_PAUSED, outcome.reason)
        assertTrue("paused" in outcome.userMessage && "Settings" in outcome.userMessage)
        assertIs<ToolExecutionOutcome.PolicyRefused>(hindi)
        assertTrue("रुके हुए हैं" in hindi.userMessage)
        assertEquals(outcome, early)
        assertEquals(0, ran)
        assertEquals(List(3) { AutomationOutcome.PAUSED }, journal.entries.map { it.outcome })

        pause.on = false
        assertNull(pipeline.refuseByPolicy(openApp, context))
        assertIs<ToolExecutionOutcome.Success>(pipeline.run(openApp.id))
        assertEquals(1, ran)
    }

    @Test
    fun `when the pause setting cannot be read, nothing runs and the user is told so`() = runTest {
        val unreadable = AutomationSwitch { throw java.io.IOException("datastore corrupted") }
        val pipeline = pipeline(openApp, pause = unreadable)

        val outcome = pipeline.run(openApp.id)

        assertIs<ToolExecutionOutcome.PolicyRefused>(outcome)
        assertEquals("pause_setting_unreadable", outcome.reason)
        assertTrue(pipeline.automationPaused(), "the Brain is offered no phone action either")
        assertEquals(0, ran)
    }

    @Test
    fun `pausing while a confirmation is on screen stops the action after it is approved`() = runTest {
        val pause = Pause()
        val confirmation = object : ConfirmationPort {
            override suspend fun confirm(request: ConfirmationRequest): Boolean {
                pause.on = true // the user paused phone actions while this question was open, then approved it
                return true
            }
        }

        val outcome = pipeline(tap("com.example.notes"), pause = pause, confirmation = confirmation).run("screen.tap")

        assertIs<ToolExecutionOutcome.PolicyRefused>(outcome)
        assertEquals(ToolPipeline.AUTOMATION_PAUSED, outcome.reason)
        assertEquals(0, ran)
    }

    @Test
    fun `a server skill is not a phone action, so the pause does not touch it and it is not in the phone's history`() = runTest {
        val journal = Journal()
        val server = SkillDefinition(
            id = "web.search", name = "Web search", description = "d", category = SkillCategory.WEB,
            requiresConfirmation = false, handler = SkillHandler { _, _ -> ran++; SkillResult.Success(emptyMap(), "Found it.") },
        )

        val outcome = pipeline(server, journal, Pause(on = true)).run(server.id)

        assertIs<ToolExecutionOutcome.Success>(outcome)
        assertTrue(journal.entries.isEmpty())
    }

    @Test
    fun `an action that reaches into another app is refused for a banking app even when its own check let it through`() = runTest {
        val journal = Journal()
        val confirmation = FakeConfirmationPort(approve = true)

        val outcome = pipeline(tap("com.snapwork.hdfc"), journal, confirmation = confirmation).run("screen.tap")

        assertIs<ToolExecutionOutcome.PolicyRefused>(outcome)
        assertEquals("sensitive_app", outcome.reason)
        assertNull(confirmation.lastRequest, "nothing is asked about a banking app's screen")
        assertEquals(0, ran)
        assertEquals(AutomationOutcome.REFUSED, journal.entries.single().outcome)
    }

    @Test
    fun `it is refused for Android's own security screens, and when it cannot say which app it reaches`() = runTest {
        val settings = pipeline(tap("com.android.settings")).run("screen.tap")
        val unknown = pipeline(tap(null)).run("screen.tap")

        assertIs<ToolExecutionOutcome.PolicyRefused>(settings)
        assertEquals("security_surface", settings.reason)
        assertIs<ToolExecutionOutcome.PolicyRefused>(unknown)
        assertEquals("target_not_checked", unknown.reason)
        assertEquals(0, ran)
    }

    @Test
    fun `an ordinary app is confirmed, then reached, and the history keeps what the user was asked`() = runTest {
        val journal = Journal()
        val confirmation = FakeConfirmationPort(approve = true)

        val outcome = pipeline(tap("com.example.notes"), journal, confirmation = confirmation).run("screen.tap")

        assertIs<ToolExecutionOutcome.Success>(outcome)
        assertEquals("Tap \"Next\" in the app in front.", confirmation.lastRequest?.summary)
        assertEquals(listOf(AutomationRecord(now, "screen.tap", "Tap \"Next\" in the app in front.", AutomationOutcome.DONE)), journal.entries)
    }

    @Test
    fun `the policy can require a confirmation the action's class and risk alone would not`() = runTest {
        val strict = AutomationPolicy.default.let { p ->
            AutomationPolicy(
                p.version, p.confirmationClasses, p.confirmationRisks, p.maxPhoneSteps, p.neverDoes,
                p.rules.map { if (it.skillId == "phone.open_app") it.copy(confirm = true) else it },
            )
        }
        val declined = FakeConfirmationPort(approve = false)

        val outcome = pipeline(openApp, confirmation = declined, policy = strict).run(openApp.id)

        assertIs<ToolExecutionOutcome.ConfirmationDeclined>(outcome)
        assertEquals("phone.open_app", declined.lastRequest?.skillId)
        assertEquals(0, ran)
    }

    @Test
    fun `the history says how each attempt ended`() = runTest {
        val journal = Journal()
        pipeline(tap("com.example.notes"), journal, confirmation = FakeConfirmationPort(approve = false)).run("screen.tap")
        val handOff = phoneSkill("alarm.set", RiskLevel.LOW, ActionClass.LOW_IMPACT, capabilityId = "alarms",
            result = SkillResult.Success(emptyMap(), "The Clock app is open with the alarm; save it there.", userActionRequired = true))
        pipeline(handOff, journal).run(handOff.id)
        val needsContacts = phoneSkill("phone.find_contact", RiskLevel.MEDIUM, ActionClass.READ_ONLY, capabilityId = "contacts",
            permissions = listOf(PermissionType.CONTACTS))
        pipeline(needsContacts, journal).run(needsContacts.id)
        val fails = phoneSkill("phone.open_app", RiskLevel.LOW, ActionClass.LOW_IMPACT, result = SkillResult.Failure("not_installed", "No such app."))
        pipeline(fails, journal).run(fails.id)

        assertEquals(
            listOf(AutomationOutcome.DECLINED, AutomationOutcome.YOUR_TURN, AutomationOutcome.NEEDS_ACCESS, AutomationOutcome.FAILED),
            journal.entries.map { it.outcome },
        )
    }

    @Test
    fun `a history that cannot be written never changes what happened`() = runTest {
        val broken = AutomationJournal { error("disk full") }

        val outcome = pipeline(openApp, broken).run(openApp.id)

        assertIs<ToolExecutionOutcome.Success>(outcome)
        assertEquals(1, ran)
    }
}
