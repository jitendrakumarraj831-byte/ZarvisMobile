package com.zarvismobile.domain.skill

import com.zarvismobile.domain.FakeConfirmationPort
import com.zarvismobile.domain.FakePermissionPort
import com.zarvismobile.domain.FakeUsagePort
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.ToolCall
import com.zarvismobile.domain.entity.ToolExecutionOutcome
import com.zarvismobile.domain.entity.ToolResultStatus
import com.zarvismobile.domain.notification.NotificationMode
import com.zarvismobile.domain.notification.NotificationPrivacySettings
import com.zarvismobile.domain.notification.NotificationSnapshot
import com.zarvismobile.domain.orchestrator.DeviceCommandGate
import com.zarvismobile.domain.orchestrator.KeywordSkillMatcher
import com.zarvismobile.domain.orchestrator.OnDeviceInputBuilder
import com.zarvismobile.domain.result.ToolResults
import com.zarvismobile.domain.tooling.SkillRegistry
import com.zarvismobile.domain.tooling.ToolPipeline
import java.time.ZoneId
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SpecialAccessSkillsTest {
    private val context = SkillExecutionContext("acc-1")

    private class Settings(var value: NotificationPrivacySettings = NotificationPrivacySettings()) : NotificationSettingsPort {
        override suspend fun current() = value
        override suspend fun update(transform: (NotificationPrivacySettings) -> NotificationPrivacySettings) {
            value = transform(value)
        }
    }

    private class FakeScreen(
        var connected: Boolean = true,
        var target: ScreenTarget? = ScreenTarget("com.example.notes", "Notes"),
        var globalResult: GlobalActionResult = GlobalActionResult(true, "com.android.launcher3", "com.android.launcher3"),
        var tapResult: TapResult = TapResult(accepted = true, screenChanged = true),
        var matches: Int = 1,
    ) : ScreenAccessPort {
        val performed = mutableListOf<String>()
        override fun serviceConnected() = connected
        override fun supports(action: GlobalAction) = true
        override suspend fun performGlobal(action: GlobalAction): GlobalActionResult { performed += "global:$action"; return globalResult }
        override suspend fun foregroundTarget() = target
        override suspend fun readScreen(expectedPackage: String): ScreenRead {
            performed += "read:$expectedPackage"
            return ScreenRead.Text(target!!, listOf("Shopping list", "Milk"), skippedPasswordFields = 1)
        }
        override suspend fun planTap(label: String): TapPlan = when (matches) {
            1 -> TapPlan.Ready(target!!, label)
            0 -> TapPlan.Unavailable("I can't find \"$label\" on screen.", userActionRequired = false)
            else -> TapPlan.Unavailable("More than one \"$label\" is on screen.", userActionRequired = false)
        }
        override suspend fun tap(label: String, expectedPackage: String): TapResult { performed += "tap:$label@$expectedPackage"; return tapResult }
    }

    private fun pipeline(skill: SkillDefinition, granted: Set<PermissionType>, confirm: FakeConfirmationPort) =
        ToolPipeline(SkillRegistry().apply { register(skill) }, FakePermissionPort(granted), { error("free skills never ask") }, FakeUsagePort(), confirm)

    private val notifications = listOf(
        NotificationSnapshot("1", "com.whatsapp", "WhatsApp", "msg", "Asha", "Asha", "Dinner at 8?", 10),
        NotificationSnapshot("2", "com.bank.app", "MyBank", null, null, "Alert", "Rs 900 debited", 20),
    )

    @Test
    fun `reading notifications needs notification access, confirms the exact summary, and hides banking`() = runTest {
        val skill = SpecialAccessSkills.readNotifications({ ActiveNotifications.Available(notifications) }, Settings())
        val denied = pipeline(skill, emptySet(), FakeConfirmationPort(true)).execute(ToolCall(skillId = skill.id, input = SkillInput()), context)
        assertEquals(listOf(PermissionType.NOTIFICATION_LISTENER), assertIs<ToolExecutionOutcome.PermissionDenied>(denied).missing)

        val confirm = FakeConfirmationPort(true)
        val outcome = pipeline(skill, setOf(PermissionType.NOTIFICATION_LISTENER), confirm).execute(ToolCall(skillId = skill.id, input = SkillInput()), context)
        val success = assertIs<ToolExecutionOutcome.Success>(outcome)
        assertTrue(confirm.lastRequest!!.summary.contains("2 current notification(s) from WhatsApp, MyBank"))
        assertTrue(success.result.summary.contains("Message from WhatsApp"))
        assertTrue(success.result.summary.contains("Security or banking alert from MyBank (content hidden)"))
        assertFalse(success.result.summary.contains("debited"))
        assertEquals("1", success.result.evidence["hiddenSensitive"])
    }

    @Test
    fun `declining the confirmation reads nothing`() = runTest {
        var reads = 0
        val skill = SpecialAccessSkills.readNotifications({ reads++; ActiveNotifications.Available(notifications) }, Settings())
        val outcome = pipeline(skill, setOf(PermissionType.NOTIFICATION_LISTENER), FakeConfirmationPort(false)).execute(ToolCall(skillId = skill.id, input = SkillInput()), context)
        assertIs<ToolExecutionOutcome.ConfirmationDeclined>(outcome)
        assertEquals(1, reads) // only the count for the confirmation text; the handler never ran
    }

    @Test
    fun `mode Off and a disconnected listener are honest failures`() = runTest {
        val off = SpecialAccessSkills.readNotifications({ ActiveNotifications.Available(notifications) }, Settings(NotificationPrivacySettings(mode = NotificationMode.OFF)))
        val offOutcome = pipeline(off, setOf(PermissionType.NOTIFICATION_LISTENER), FakeConfirmationPort(true)).execute(ToolCall(skillId = off.id, input = SkillInput()), context)
        assertEquals(ToolResultStatus.USER_ACTION_REQUIRED, ToolResults.from(off.id, off, offOutcome).status)

        val disconnected = SpecialAccessSkills.readNotifications({ ActiveNotifications.NotConnected }, Settings())
        val outcome = pipeline(disconnected, setOf(PermissionType.NOTIFICATION_LISTENER), FakeConfirmationPort(true)).execute(ToolCall(skillId = disconnected.id, input = SkillInput()), context)
        assertEquals("listener_not_connected", assertIs<ToolExecutionOutcome.ExecutionFailed>(outcome).result.reason)
    }

    @Test
    fun `speaking notifications is turned on and off by reading back the saved setting`() = runTest {
        val settings = Settings(NotificationPrivacySettings(mode = NotificationMode.OFF))
        val on = SpecialAccessSkills.speakNotificationsOn(settings)
        val outcome = pipeline(on, setOf(PermissionType.NOTIFICATION_LISTENER), FakeConfirmationPort(false)).execute(ToolCall(skillId = on.id, input = SkillInput()), context)
        val success = assertIs<ToolExecutionOutcome.Success>(outcome) // LOW_IMPACT, MEDIUM: no confirmation needed
        assertTrue(settings.value.speakEnabled)
        assertEquals(NotificationMode.APP_AND_TYPE, settings.value.mode)
        assertTrue(success.result.summary.contains("security/banking alerts never spoken"))

        val off = SpecialAccessSkills.speakNotificationsOff(settings)
        assertIs<ToolExecutionOutcome.Success>(pipeline(off, emptySet(), FakeConfirmationPort(false)).execute(ToolCall(skillId = off.id, input = SkillInput()), context))
        assertFalse(settings.value.speakEnabled)
    }

    @Test
    fun `screen time lists top apps from what Android reported`() = runTest {
        val report = UsageReport.Available(
            sinceEpochMillis = 1_756_146_600_000,
            apps = listOf(AppUsage("com.a", "YouTube", 58 * 60_000L), AppUsage("com.b", "WhatsApp", 31 * 60_000L), AppUsage("com.c", "Tiny", 10_000L)),
        )
        val skill = SpecialAccessSkills.screenTime({ report }, zone = { ZoneId.of("Asia/Kolkata") })
        val confirm = FakeConfirmationPort(true)
        val outcome = pipeline(skill, setOf(PermissionType.USAGE_ACCESS), confirm).execute(ToolCall(skillId = skill.id, input = SkillInput()), context)
        val summary = assertIs<ToolExecutionOutcome.Success>(outcome).result.summary
        assertTrue(summary.contains("1 h 29 min"), summary)
        assertTrue(summary.contains("- YouTube: 58 min") && !summary.contains("Tiny"))
        assertEquals(RiskLevel.HIGH, confirm.lastRequest!!.riskLevel)
    }

    @Test
    fun `global actions are VERY_HIGH, confirmed, and report whether Android verified them`() = runTest {
        val screen = FakeScreen()
        val skill = SpecialAccessSkills.globalAction(screen)
        val confirm = FakeConfirmationPort(true)
        val input = SkillInput(mapOf("action" to "HOME"))
        val outcome = pipeline(skill, setOf(PermissionType.ACCESSIBILITY_SERVICE), confirm).execute(ToolCall(skillId = skill.id, input = input), context)
        val success = assertIs<ToolExecutionOutcome.Success>(outcome)
        assertEquals(RiskLevel.VERY_HIGH, confirm.lastRequest!!.riskLevel)
        assertEquals("true", success.result.evidence["verified"])

        screen.globalResult = GlobalActionResult(true, null, null)
        val unverified = pipeline(skill, setOf(PermissionType.ACCESSIBILITY_SERVICE), confirm).execute(ToolCall(skillId = skill.id, input = input), context)
        assertTrue(assertIs<ToolExecutionOutcome.Success>(unverified).result.summary.contains("couldn't independently confirm"))

        screen.globalResult = GlobalActionResult(false, null, null)
        assertIs<ToolExecutionOutcome.ExecutionFailed>(pipeline(skill, setOf(PermissionType.ACCESSIBILITY_SERVICE), confirm).execute(ToolCall(skillId = skill.id, input = input), context))

        val declined = FakeScreen()
        pipeline(SpecialAccessSkills.globalAction(declined), setOf(PermissionType.ACCESSIBILITY_SERVICE), FakeConfirmationPort(false))
            .execute(ToolCall(skillId = skill.id, input = input), context)
        assertTrue(declined.performed.isEmpty())
    }

    @Test
    fun `screen reading refuses security surfaces and sensitive apps and needs a visible app`() = runTest {
        val screen = FakeScreen()
        val skill = SpecialAccessSkills.readScreen(screen)
        val run = suspend { pipeline(skill, setOf(PermissionType.ACCESSIBILITY_SERVICE), FakeConfirmationPort(true)).execute(ToolCall(skillId = skill.id, input = SkillInput()), context) }

        val ok = assertIs<ToolExecutionOutcome.Success>(run())
        assertTrue(ok.result.summary.contains("Shopping list"))
        assertEquals("1", ok.result.evidence["skippedPasswordFields"])

        screen.target = ScreenTarget("com.android.settings", "Settings")
        assertEquals("security_surface", assertIs<ToolExecutionOutcome.ExecutionFailed>(run()).result.reason)
        screen.target = ScreenTarget("com.hdfcbank.mobilebanking", "HDFC Bank")
        assertEquals("sensitive_app", assertIs<ToolExecutionOutcome.ExecutionFailed>(run()).result.reason)
        screen.target = null
        val none = run()
        assertEquals(ToolResultStatus.USER_ACTION_REQUIRED, ToolResults.from(skill.id, skill, none).status)
        assertEquals(listOf("read:com.example.notes"), screen.performed)
    }

    @Test
    fun `tapping confirms the exact button and app, blocks risky labels, and needs a unique match`() = runTest {
        val screen = FakeScreen()
        val skill = SpecialAccessSkills.tapOnScreen(screen)
        val confirm = FakeConfirmationPort(true)
        suspend fun run(label: String) =
            pipeline(skill, setOf(PermissionType.ACCESSIBILITY_SERVICE), confirm).execute(ToolCall(skillId = skill.id, input = SkillInput(mapOf("label" to label))), context)

        assertIs<ToolExecutionOutcome.Success>(run("Next"))
        assertEquals("Tap \"Next\" in Notes. This can send, submit or change something in that app.", confirm.lastRequest!!.summary)
        listOf("Pay now", "Delete", "Allow", "Install", "Sign in", "Accept").forEach {
            assertEquals("blocked_label", assertIs<ToolExecutionOutcome.ExecutionFailed>(run(it)).result.reason, it)
        }
        screen.matches = 2
        assertIs<ToolExecutionOutcome.ExecutionFailed>(run("OK"))
        assertEquals(listOf("tap:Next@com.example.notes"), screen.performed)

        screen.matches = 1
        screen.tapResult = TapResult(accepted = true, screenChanged = false)
        assertTrue(assertIs<ToolExecutionOutcome.Success>(run("Next")).result.summary.contains("didn't visibly change"))
    }

    @Test
    fun `assistant setup succeeds only when Android reports the role held`() = runTest {
        val held = SpecialAccessSkills.assistantSetup { true }
        val outcome = pipeline(held, setOf(PermissionType.ASSISTANT_ROLE), FakeConfirmationPort(false)).execute(ToolCall(skillId = held.id, input = SkillInput()), context)
        assertEquals("true", assertIs<ToolExecutionOutcome.Success>(outcome).result.evidence["roleManagerIsRoleHeld"])
        val notHeld = SpecialAccessSkills.assistantSetup { false }
        assertIs<ToolExecutionOutcome.PermissionDenied>(pipeline(notHeld, emptySet(), FakeConfirmationPort(true)).execute(ToolCall(skillId = notHeld.id, input = SkillInput()), context))
    }

    @Test
    fun `parsers extract the action and label`() {
        assertEquals("HOME", SpecialAccessSkills.parseGlobalAction("go home"))
        assertEquals("LOCK_SCREEN", SpecialAccessSkills.parseGlobalAction("lock my phone"))
        assertEquals("QUICK_SETTINGS", SpecialAccessSkills.parseGlobalAction("open quick settings"))
        assertEquals("NOTIFICATIONS", SpecialAccessSkills.parseGlobalAction("pull down notifications"))
        assertNull(SpecialAccessSkills.parseGlobalAction("read my notifications"))
        assertEquals("Next", SpecialAccessSkills.parseTapLabel("tap Next"))
        assertEquals("OK", SpecialAccessSkills.parseTapLabel("press the OK button"))
        assertEquals("Send", SpecialAccessSkills.parseTapLabel("click on \"Send\""))
        assertEquals("Submit", SpecialAccessSkills.parseTapLabel("Submit dabao"))
        assertNull(SpecialAccessSkills.parseTapLabel("my laptop is slow"))
    }

    @Test
    fun `commands route to the right skill and questions go to the Brain`() {
        val settings = Settings()
        val screen = FakeScreen()
        val registry = SkillRegistry().apply {
            register(SpecialAccessSkills.readNotifications({ ActiveNotifications.Available(emptyList()) }, settings))
            register(SpecialAccessSkills.speakNotificationsOn(settings))
            register(SpecialAccessSkills.speakNotificationsOff(settings))
            register(SpecialAccessSkills.screenTime({ UsageReport.Unavailable("x") }))
            register(SpecialAccessSkills.globalAction(screen))
            register(SpecialAccessSkills.readScreen(screen))
            register(SpecialAccessSkills.tapOnScreen(screen))
            register(SpecialAccessSkills.assistantSetup { false })
        }
        val matcher = KeywordSkillMatcher(registry)
        fun route(text: String) = matcher.matchCommand(text)?.id
        assertEquals("notifications.read_recent", route("read my notifications"))
        assertEquals("notifications.read_recent", route("any notifications?"))
        assertEquals("notifications.speak_on", route("speak my notifications"))
        assertEquals("notifications.speak_on", route("read my notifications aloud"))
        assertEquals("notifications.speak_off", route("stop speaking notifications"))
        assertNull(route("don't read my notifications"))
        assertEquals("usage.screen_time", route("what's my screen time today"))
        assertEquals("device.global_action", route("go home"))
        assertEquals("device.global_action", route("lock the screen"))
        assertNull(route("how do I lock the screen?"))
        assertEquals("screen.read", route("what's on my screen"))
        assertEquals("screen.tap", route("tap Next"))
        assertNull(route("my laptop is slow"))
        assertEquals("assistant.setup", route("make ZARVIS my default assistant"))
        assertNull(route("what is a default assistant"))

        assertEquals("LOCK_SCREEN", OnDeviceInputBuilder.build(registry.find("device.global_action")!!, "lock the screen").values["action"])
        assertEquals("Next", OnDeviceInputBuilder.build(registry.find("screen.tap")!!, "tap Next").values["label"])
        assertTrue(DeviceCommandGate.accepts("screen.read", "read the screen"))
    }
}
