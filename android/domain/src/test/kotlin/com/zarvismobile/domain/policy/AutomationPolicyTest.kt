package com.zarvismobile.domain.policy

import com.zarvismobile.domain.FixedClockPort
import com.zarvismobile.domain.capability.ActionPolicy
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.port.ClockPort
import com.zarvismobile.domain.skill.AppSearchSkillFactory
import com.zarvismobile.domain.skill.DeviceCapabilitySkills
import com.zarvismobile.domain.skill.MessageDraftSkillFactory
import com.zarvismobile.domain.skill.PhoneCallSkillFactory
import com.zarvismobile.domain.skill.PhoneFindContactSkillFactory
import com.zarvismobile.domain.skill.PhoneOpenAppSkillFactory
import com.zarvismobile.domain.skill.ReminderSkillFactory
import com.zarvismobile.domain.skill.SpecialAccessSkills
import java.io.File
import java.lang.reflect.Proxy
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The phone-automation policy (shared/automation-policy.json) and the phone actions the app really has must agree, rule for rule.
 * A new phone action fails here until it is written into the policy, and a policy entry fails here once its action is gone.
 */
class AutomationPolicyTest {

    private val policy = AutomationPolicy.default

    /** A port that is never called: building a skill only keeps its ports. */
    private inline fun <reified T : Any> port(): T =
        Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, method, _ ->
            error("${T::class.simpleName}.${method.name} is not used to build a skill")
        } as T

    private val clock: ClockPort = FixedClockPort(Instant.parse("2026-10-23T00:00:00Z"))

    /** Every on-device skill, built the way skills/OnDeviceSkillRegistryFactory.kt registers them, in the same order. */
    private val onDeviceSkills: List<SkillDefinition> = listOf(
        ReminderSkillFactory.create(port(), clock),
        PhoneOpenAppSkillFactory.create(port()),
        PhoneFindContactSkillFactory.create(port()),
        PhoneCallSkillFactory.create(port(), port()),
        DeviceCapabilitySkills.pickDocument(port()),
        DeviceCapabilitySkills.pickPhoto(port()),
        DeviceCapabilitySkills.capturePhoto(port()),
        DeviceCapabilitySkills.describePhoto(port(), port()),
        DeviceCapabilitySkills.currentLocation(port(), clock),
        DeviceCapabilitySkills.openBluetoothSettings(port()),
        DeviceCapabilitySkills.openSystemSettings(port()),
        DeviceCapabilitySkills.setAlarm(port(), clock),
        DeviceCapabilitySkills.createCalendarEvent(port(), clock),
        SpecialAccessSkills.readNotifications(port(), port()),
        SpecialAccessSkills.speakNotificationsOn(port()),
        SpecialAccessSkills.speakNotificationsOff(port()),
        SpecialAccessSkills.screenTime(port()),
        SpecialAccessSkills.globalAction(port()),
        SpecialAccessSkills.readScreen(port()),
        SpecialAccessSkills.tapOnScreen(port()),
        SpecialAccessSkills.assistantSetup(port()),
        MessageDraftSkillFactory.create(port(), port()),
        AppSearchSkillFactory.create(port()),
    )

    @Test
    fun `the packaged policy is the one in shared and reads completely`() {
        assertEquals(AutomationPolicy.parse(File("../../shared/automation-policy.json").readText()).rules, policy.rules)
        assertEquals(1, policy.version)
        assertEquals(5, policy.maxPhoneSteps)
        assertTrue(policy.neverDoes.size >= 8, "the user is told what ZARVIS never does")
        assertTrue(policy.neverDoes.all { it.en.isNotBlank() && it.hi.isNotBlank() }, "in English and in Hindi")
    }

    @Test
    fun `this test builds exactly the skills the app registers`() {
        val factory = File("../skills/src/main/kotlin/com/zarvismobile/skills/OnDeviceSkillRegistryFactory.kt").readText()
        val registered = Regex("""registry\.register\(""").findAll(factory).count()
        assertEquals(registered, onDeviceSkills.size, "OnDeviceSkillRegistryFactory registers a skill this test does not build: add it here and to the policy")
        assertTrue(onDeviceSkills.all { it.executesOnDevice }, "every phone action runs under the on-device pipeline's policy")
    }

    @Test
    fun `every phone action is in the policy with exactly its own rules`() {
        for (skill in onDeviceSkills) {
            val rule = policy.rule(skill.id)
            requireNotNull(rule) { "${skill.id} is not in shared/automation-policy.json, so the pipeline would refuse it" }
            assertEquals(skill.riskLevel, rule.risk, "${skill.id} risk")
            assertEquals(skill.actionClass, rule.actionClass, "${skill.id} action class")
            assertEquals(skill.capabilityId, rule.capabilityId, "${skill.id} capability")
        }
        assertEquals(onDeviceSkills.map { it.id }.toSet(), policy.rules.map { it.skillId }.toSet(), "the policy lists no action the app does not have")
    }

    @Test
    fun `the policy says confirm wherever the action's class or risk already requires it`() {
        for (rule in policy.rules) {
            if (ActionPolicy.requiresConfirmation(rule.actionClass, rule.risk)) {
                assertTrue(rule.confirm, "${rule.skillId} must be marked confirm in the policy, as its class and risk require")
            }
            assertEquals(ActionPolicy.requiresConfirmation(rule.actionClass, rule.risk), policy.requiresConfirmation(rule.copy(confirm = false)))
        }
        val confirmed = policy.rules.filter { policy.requiresConfirmation(it) }.map { it.skillId }.toSet()
        assertEquals(
            setOf("message.draft", "phone.call", "notifications.read_recent", "usage.screen_time", "device.global_action", "screen.read", "screen.tap"),
            confirmed,
        )
    }

    @Test
    fun `actions that reach into other apps are the screen ones, and their results that are private stay marked private`() {
        assertEquals(setOf("screen.read", "screen.tap"), policy.rules.filter { it.actsInOtherApps }.map { it.skillId }.toSet())
        assertEquals(
            setOf("screen.read", "notifications.read_recent", "usage.screen_time", "location.current", "phone.find_contact"),
            policy.privateResultSkills,
        )
        assertTrue(policy.rules.filter { it.actsInOtherApps }.all { policy.requiresConfirmation(it) }, "reaching into another app is always confirmed")
    }
}
