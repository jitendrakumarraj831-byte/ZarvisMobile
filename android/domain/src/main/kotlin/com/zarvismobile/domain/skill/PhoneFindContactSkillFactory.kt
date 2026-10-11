package com.zarvismobile.domain.skill

import com.zarvismobile.domain.entity.ActionClass
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
        actionClass = ActionClass.READ_ONLY,
        capabilityId = "contacts",
        // Read-only and shown only on this phone: the Contacts permission is the gate; nothing
        // is shared or uploaded, so no extra per-lookup confirmation (policy agrees: READ_ONLY/MEDIUM).
        requiresConfirmation = false,
        executesOnDevice = true,
        inputSchema = JsonSchema(requiredFields = setOf("name")),
        handler = handler(contacts),
    )

    private fun handler(contacts: ContactLookupPort) = SkillHandler { input, _ ->
        val name = (input.values["name"] as? String)?.trim()
        if (name.isNullOrEmpty()) {
            return@SkillHandler SkillResult.Failure("missing_name", "Whose contact should I look up?")
        }
        val matches = ContactMatching.bestMatches(name, contacts.search(name))
        if (matches.isEmpty()) {
            return@SkillHandler SkillResult.Failure(
                reason = "contact_not_found",
                userMessage = "I couldn't find a contact matching \"$name\".",
            )
        }
        val contact = matches.singleOrNull()
            ?: return@SkillHandler SkillResult.Success(
                // A name that fits several people is answered with all of them (this is read-only), never with whichever came first.
                output = mapOf(
                    "count" to matches.size,
                    "matches" to matches.take(MAX_LISTED).map { mapOf("name" to it.displayName, "phoneNumber" to it.phoneNumber) },
                ),
                summary = "${matches.size} contacts match \"$name\": " +
                    matches.take(MAX_LISTED).joinToString("; ") { "${it.displayName}: ${it.phoneNumber}" } +
                    if (matches.size > MAX_LISTED) " (and ${matches.size - MAX_LISTED} more)" else "",
                evidence = mapOf("source" to "ContactsContract"),
            )
        SkillResult.Success(
            output = mapOf("name" to contact.displayName, "phoneNumber" to contact.phoneNumber),
            summary = "${contact.displayName}: ${contact.phoneNumber}",
            evidence = mapOf("source" to "ContactsContract"),
        )
    }

    private const val MAX_LISTED = 5
}
