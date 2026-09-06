package com.zarvismobile.domain.skill

import com.zarvismobile.domain.entity.EntitlementLevel
import com.zarvismobile.domain.entity.JsonSchema
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillCategory
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillHandler
import com.zarvismobile.domain.entity.SkillResult
import com.zarvismobile.domain.entity.UsageCost

/**
 * The `phone.open_app` reference skill — LOW risk (search/open per the SKILLS.md risk
 * rubric), free, on-device. First real Phone Agent skill (MASTER_SPEC.md §28 Phase 4);
 * `phone.find_contact`/`phone.call` are its siblings. No [com.zarvismobile.domain.entity
 * .PermissionType] is required: launching another app by name only needs package
 * *visibility* (an Android `<queries>` manifest declaration), not a runtime permission —
 * see `app/AndroidManifest.xml`.
 */
object PhoneOpenAppSkillFactory {

    fun create(launcher: AppLauncherPort): SkillDefinition = SkillDefinition(
        id = "phone.open_app",
        name = "Open App",
        description = "Open another app on the phone, e.g. \"open WhatsApp\" or \"khol do Chrome\".",
        category = SkillCategory.PHONE,
        capabilities = listOf("open", "launch", "khol", "kholo", "chalu kar"),
        requiredPermissions = emptyList(),
        requiredEntitlement = EntitlementLevel.FREE,
        usageCost = UsageCost.FREE,
        riskLevel = RiskLevel.LOW,
        requiresConfirmation = false,
        executesOnDevice = true,
        inputSchema = JsonSchema(requiredFields = setOf("appName")),
        handler = handler(launcher),
    )

    private fun handler(launcher: AppLauncherPort) = SkillHandler { input, _ ->
        val appName = (input.values["appName"] as? String)?.trim()
        if (appName.isNullOrEmpty()) {
            return@SkillHandler SkillResult.Failure("missing_app_name", "Which app would you like me to open?")
        }
        when (val result = launcher.openApp(appName)) {
            is AppLaunchResult.Opened -> SkillResult.Success(
                output = mapOf("appName" to result.appName),
                summary = "Opening ${result.appName}.",
            )
            AppLaunchResult.NotFound -> SkillResult.Failure(
                reason = "app_not_found",
                userMessage = "I couldn't find an app called \"$appName\" on this phone.",
            )
        }
    }
}
