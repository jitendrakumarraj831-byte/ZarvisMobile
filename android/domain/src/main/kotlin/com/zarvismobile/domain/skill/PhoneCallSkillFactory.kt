package com.zarvismobile.domain.skill

import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.domain.entity.EntitlementLevel
import com.zarvismobile.domain.entity.JsonSchema
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.entity.PreparedAction
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillCategory
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillHandler
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.SkillPreparer
import com.zarvismobile.domain.entity.SkillResult
import com.zarvismobile.domain.entity.UsageCost

/**
 * `phone.call` — capability `phone_call`, HIGH risk, EXTERNAL_COMMUNICATION, so the policy
 * always requires a per-call confirmation. The [SkillPreparer] resolves a contact name to one
 * exact number *before* the confirmation, the confirmation shows that name and number, and
 * the handler dials exactly the confirmed number — Phone permission alone never authorizes a
 * call (blueprint §10 "Permission ≠ action authorization").
 */
object PhoneCallSkillFactory {

    const val RESOLVED_NAME = "resolvedName"
    const val RESOLVED_NUMBER = "resolvedNumber"

    fun create(contacts: ContactLookupPort, caller: PhoneCallPort): SkillDefinition = SkillDefinition(
        id = "phone.call",
        name = "Call",
        description = "Call a contact or phone number, e.g. \"call mom\" or \"call 9876543210\".",
        category = SkillCategory.PHONE,
        capabilities = listOf("call", "dial", "phone", "call kar", "call karo"),
        requiredPermissions = listOf(PermissionType.PHONE_CALL),
        requiredEntitlement = EntitlementLevel.FREE,
        usageCost = UsageCost.FREE,
        riskLevel = RiskLevel.HIGH,
        actionClass = ActionClass.EXTERNAL_COMMUNICATION,
        capabilityId = "phone_call",
        requiresConfirmation = true,
        executesOnDevice = true,
        inputSchema = JsonSchema(requiredFields = setOf("target")),
        preparer = preparer(contacts),
        handler = handler(caller),
    )

    private fun preparer(contacts: ContactLookupPort) = SkillPreparer { input, _ ->
        val target = (input.values["target"] as? String)?.trim().orEmpty()
        if (looksLikePhoneNumber(target)) {
            val number = normalizeNumber(target)
            return@SkillPreparer PreparedAction.Ready(
                description = "Call $number",
                input = SkillInput(input.values + mapOf(RESOLVED_NAME to number, RESOLVED_NUMBER to number)),
            )
        }
        val contact = contacts.findByName(target)
            ?: return@SkillPreparer PreparedAction.Failed(
                SkillResult.Failure("contact_not_found", "I couldn't find a contact matching \"$target\", so I didn't call anyone."),
            )
        PreparedAction.Ready(
            description = "Call ${contact.displayName} at ${contact.phoneNumber}",
            input = SkillInput(input.values + mapOf(RESOLVED_NAME to contact.displayName, RESOLVED_NUMBER to contact.phoneNumber)),
        )
    }

    private fun handler(caller: PhoneCallPort) = SkillHandler { input, _ ->
        val number = input.values[RESOLVED_NUMBER] as? String
        val name = input.values[RESOLVED_NAME] as? String
        if (number.isNullOrBlank() || name.isNullOrBlank()) {
            // Only reachable if the pipeline's prepare stage was bypassed — refuse rather than guess.
            return@SkillHandler SkillResult.Failure("not_prepared", "I couldn't confirm which number to call, so I didn't call anyone.")
        }
        if (!caller.call(number)) {
            return@SkillHandler SkillResult.Failure("call_failed", "Android couldn't start the call to $name.")
        }
        SkillResult.Success(
            output = mapOf("calledName" to name, "phoneNumber" to number),
            summary = "Calling $name ($number). Android's dialer accepted the call request.",
            evidence = mapOf("dialerAcceptedIntent" to "ACTION_CALL", "number" to number),
        )
    }

    /** Digits plus common dialing punctuation, at least 7 digits. */
    fun looksLikePhoneNumber(target: String): Boolean =
        target.count { it.isDigit() } >= 7 && target.all { it.isDigit() || it in "+-() " }

    private fun normalizeNumber(target: String): String = target.filter { it.isDigit() || it == '+' }
}
