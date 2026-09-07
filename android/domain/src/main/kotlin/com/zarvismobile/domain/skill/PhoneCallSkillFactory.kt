package com.zarvismobile.domain.skill

import com.zarvismobile.domain.entity.EntitlementLevel
import com.zarvismobile.domain.entity.JsonSchema
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillCategory
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillHandler
import com.zarvismobile.domain.entity.SkillResult
import com.zarvismobile.domain.entity.UsageCost

/**
 * The `phone.call` reference skill — placing a call is MEDIUM risk per the SKILLS.md rubric
 * ("send/call/modify-files"), which makes `requiresConfirmation` true by
 * [SkillDefinition]'s own default — the Tool pipeline blocks on an explicit user "yes"
 * before this handler ever runs (MASTER_SPEC.md §7). Free, on-device, requires both
 * [PermissionType.PHONE_CALL] (to place the call) and [PermissionType.CONTACTS] (to resolve
 * a spoken name to a number — not needed when `target` is already a raw phone number).
 */
object PhoneCallSkillFactory {

    fun create(contacts: ContactLookupPort, caller: PhoneCallPort): SkillDefinition = SkillDefinition(
        id = "phone.call",
        name = "Call",
        description = "Call a contact or phone number, e.g. \"call mom\" or \"call 9876543210\".",
        category = SkillCategory.PHONE,
        capabilities = listOf("call", "dial", "phone", "call kar", "call karo"),
        requiredPermissions = listOf(PermissionType.PHONE_CALL, PermissionType.CONTACTS),
        requiredEntitlement = EntitlementLevel.FREE,
        usageCost = UsageCost.FREE,
        riskLevel = RiskLevel.MEDIUM,
        executesOnDevice = true,
        inputSchema = JsonSchema(requiredFields = setOf("target")),
        handler = handler(contacts, caller),
    )

    private fun handler(contacts: ContactLookupPort, caller: PhoneCallPort) = SkillHandler { input, _ ->
        val target = (input.values["target"] as? String)?.trim()
        if (target.isNullOrEmpty()) {
            return@SkillHandler SkillResult.Failure("missing_target", "Who or what number should I call?")
        }

        val resolved = if (looksLikePhoneNumber(target)) {
            ResolvedTarget(displayName = target, phoneNumber = target)
        } else {
            val contact = contacts.findByName(target)
                ?: return@SkillHandler SkillResult.Failure(
                    reason = "contact_not_found",
                    userMessage = "I couldn't find a contact matching \"$target\" to call.",
                )
            ResolvedTarget(displayName = contact.displayName, phoneNumber = contact.phoneNumber)
        }

        val placed = caller.call(resolved.phoneNumber)
        if (!placed) {
            return@SkillHandler SkillResult.Failure(
                reason = "call_failed",
                userMessage = "I couldn't place the call to ${resolved.displayName}.",
            )
        }
        SkillResult.Success(
            output = mapOf("calledName" to resolved.displayName, "phoneNumber" to resolved.phoneNumber),
            summary = "Calling ${resolved.displayName}.",
        )
    }

    /** A crude "is this already a number, not a name" check — digits plus common dialing punctuation. */
    private fun looksLikePhoneNumber(target: String): Boolean = target.count { it.isDigit() } >= 7 &&
        target.all { it.isDigit() || it in "+-() " }

    private data class ResolvedTarget(val displayName: String, val phoneNumber: String)
}
