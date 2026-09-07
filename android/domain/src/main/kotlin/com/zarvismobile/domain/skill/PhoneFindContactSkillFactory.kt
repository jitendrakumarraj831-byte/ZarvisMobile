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
 * The `phone.find_contact` reference skill — reading someone's personal contact details is
 * rounded up to MEDIUM risk per the SKILLS.md authoring rubric ("when unsure, round up"),
 * even though it's a read-only lookup, since contact details are personal data about a third
 * party, not just the asking user. Free, on-device, requires [PermissionType.CONTACTS].
 */
object PhoneFindContactSkillFactory {

    fun create(contacts: ContactLookupPort): SkillDefinition = SkillDefinition(
        id = "phone.find_contact",
        name = "Find Contact",
        description = "Look up a saved contact's phone number by name, e.g. \"find mom's number\".",
        category = SkillCategory.PHONE,
        capabilities = listOf("contact", "number", "phone number", "contact dhundo"),
        requiredPermissions = listOf(PermissionType.CONTACTS),
        requiredEntitlement = EntitlementLevel.FREE,
        usageCost = UsageCost.FREE,
        riskLevel = RiskLevel.MEDIUM,
        executesOnDevice = true,
        inputSchema = JsonSchema(requiredFields = setOf("name")),
        handler = handler(contacts),
    )

    private fun handler(contacts: ContactLookupPort) = SkillHandler { input, _ ->
        val name = (input.values["name"] as? String)?.trim()
        if (name.isNullOrEmpty()) {
            return@SkillHandler SkillResult.Failure("missing_name", "Whose contact should I look up?")
        }
        val contact = contacts.findByName(name)
            ?: return@SkillHandler SkillResult.Failure(
                reason = "contact_not_found",
                userMessage = "I couldn't find a contact matching \"$name\".",
            )
        SkillResult.Success(
            output = mapOf("name" to contact.displayName, "phoneNumber" to contact.phoneNumber),
            summary = "${contact.displayName}: ${contact.phoneNumber}",
        )
    }
}
