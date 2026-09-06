package com.zarvismobile.domain.skill

import com.zarvismobile.domain.FakeAppLauncherPort
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.SkillResult
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class PhoneOpenAppSkillFactoryTest {

    private val context = SkillExecutionContext(accountId = "acc-1")

    @Test
    fun `opening an installed app succeeds`() = runTest {
        val launcher = FakeAppLauncherPort(installedApps = setOf("WhatsApp", "Chrome"))
        val skill = PhoneOpenAppSkillFactory.create(launcher)
        val result = skill.handler.execute(SkillInput(mapOf("appName" to "whatsapp")), context)
        val success = assertIs<SkillResult.Success>(result)
        assertEquals("Opening WhatsApp.", success.summary)
        assertEquals(listOf("WhatsApp"), launcher.launched)
    }

    @Test
    fun `an app that isn't installed fails with a clear reason, not a crash`() = runTest {
        val skill = PhoneOpenAppSkillFactory.create(FakeAppLauncherPort())
        val result = skill.handler.execute(SkillInput(mapOf("appName" to "NoSuchApp")), context)
        val failure = assertIs<SkillResult.Failure>(result)
        assertEquals("app_not_found", failure.reason)
    }

    @Test
    fun `a blank app name is rejected before touching the launcher`() = runTest {
        val skill = PhoneOpenAppSkillFactory.create(FakeAppLauncherPort())
        val result = skill.handler.execute(SkillInput(mapOf("appName" to "  ")), context)
        val failure = assertIs<SkillResult.Failure>(result)
        assertEquals("missing_app_name", failure.reason)
    }
}
