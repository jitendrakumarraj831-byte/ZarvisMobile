package com.zarvismobile.domain.skill

import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.domain.entity.EntitlementLevel
import com.zarvismobile.domain.entity.JsonSchema
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
 * `message.draft` — opens a message in WhatsApp, the SMS app, an email app or another app, ready for the user to send
 * (blueprint Phase 11 SHARE_FLOW_AVAILABLE). The exact recipient and message are confirmed before the draft opens; ZARVIS never
 * sends it. The user reviews the draft in that app and presses Send themselves. A contact's name is resolved to one number first (Contacts permission, explained by the
 * orchestrator), and an unknown or ambiguous name opens nothing, so a draft never goes to the wrong person's chat.
 *
 * It has no trigger words: a message is put in words the Brain understands ("Rahul ko WhatsApp pe bolo ki main late hoon"),
 * and the Brain hands it to the phone as a device action.
 */
object MessageDraftSkillFactory {
    const val CHANNEL = "channel"
    const val RECIPIENT_NAME = "recipientName"
    const val RECIPIENT_ADDRESS = "recipientAddress"

    fun create(contacts: ContactLookupPort, drafts: MessageDraftPort): SkillDefinition = SkillDefinition(
        id = "message.draft",
        name = "Message draft",
        description = "Open a message draft in WhatsApp, SMS, email or another app for you to send, e.g. \"Rahul ko WhatsApp pe hi bhejo\".",
        category = SkillCategory.PHONE,
        capabilities = emptyList(),
        requiredPermissions = emptyList(),
        requiredEntitlement = EntitlementLevel.FREE,
        usageCost = UsageCost.FREE,
        riskLevel = RiskLevel.MEDIUM,
        actionClass = ActionClass.EXTERNAL_COMMUNICATION,
        capabilityId = null,
        requiresConfirmation = true,
        executesOnDevice = true,
        inputSchema = JsonSchema(requiredFields = setOf("text")),
        preparer = preparer(contacts),
        handler = handler(drafts),
    )

    /** Which app the user asked for ("WhatsApp", "sms", "व्हाट्सएप", "Telegram"), or null for none. */
    fun channelOf(app: String?, recipient: String?): MessageChannel {
        val key = AppAliases.normalize(app.orEmpty())
        return when {
            key.isEmpty() -> if (recipient.isNullOrBlank()) MessageChannel.ANY_APP else MessageChannel.SMS
            key in WHATSAPP -> MessageChannel.WHATSAPP
            key in SMS -> MessageChannel.SMS
            key in EMAIL -> MessageChannel.EMAIL
            else -> MessageChannel.OTHER_APP
        }
    }

    /** True when opening this draft means looking up a contact's number (the orchestrator asks for Contacts access first). */
    fun needsContacts(values: Map<String, Any?>): Boolean {
        val to = (values["to"] as? String)?.trim().orEmpty()
        if (to.isEmpty() || PhoneCallSkillFactory.looksLikePhoneNumber(to)) return false
        val channel = channelOf(values["app"] as? String, to)
        return channel == MessageChannel.WHATSAPP || channel == MessageChannel.SMS
    }

    private fun preparer(contacts: ContactLookupPort) = SkillPreparer { input, _ ->
        val text = (input.values["text"] as? String)?.trim().orEmpty()
        if (text.isEmpty()) {
            return@SkillPreparer PreparedAction.Failed(SkillResult.Failure("missing_text", "What should the message say?"))
        }
        val to = (input.values["to"] as? String)?.trim()?.takeIf { it.isNotEmpty() }
        val channel = channelOf(input.values["app"] as? String, to)
        var name: String? = to
        var address: String? = null
        when {
            to == null -> Unit
            channel == MessageChannel.EMAIL -> if (to.contains('@')) address = to
            channel != MessageChannel.WHATSAPP && channel != MessageChannel.SMS -> Unit
            PhoneCallSkillFactory.looksLikePhoneNumber(to) -> address = to.filter { it.isDigit() || it == '+' }
            else -> {
                val matches = ContactMatching.bestMatches(to, contacts.search(to))
                val contact = when (matches.size) {
                    0 -> return@SkillPreparer PreparedAction.Failed(
                        SkillResult.Failure("contact_not_found", "I couldn't find a contact matching \"$to\", so I didn't open a message."),
                    )
                    1 -> matches.single()
                    else -> return@SkillPreparer PreparedAction.Failed(
                        SkillResult.Failure(
                            "ambiguous_contact",
                            "More than one contact matches \"$to\": " + matches.take(3).joinToString(", ") { it.displayName } +
                                ". Say the full name, so the message doesn't go to the wrong chat. I didn't open a message.",
                        ),
                    )
                }
                name = contact.displayName
                address = contact.phoneNumber
            }
        }
        PreparedAction.Ready(
            description = "Open a message" + (name?.let { " to $it" } ?: "") + ": \"$text\"",
            input = SkillInput(
                input.values + mapOf(CHANNEL to channel.name, RECIPIENT_NAME to name, RECIPIENT_ADDRESS to address),
            ),
        )
    }

    private fun handler(drafts: MessageDraftPort) = SkillHandler { input, _ ->
        val text = (input.values["text"] as? String)?.trim().orEmpty()
        val channel = (input.values[CHANNEL] as? String)?.let { runCatching { MessageChannel.valueOf(it) }.getOrNull() }
        if (text.isEmpty() || channel == null) {
            // Only reachable if the pipeline's prepare stage was bypassed: refuse rather than guess.
            return@SkillHandler SkillResult.Failure("not_prepared", "I couldn't prepare that message, so I didn't open anything.")
        }
        val name = input.values[RECIPIENT_NAME] as? String
        val draft = MessageDraft(
            text = text,
            channel = channel,
            appName = (input.values["app"] as? String)?.trim()?.takeIf { it.isNotEmpty() },
            recipientName = name,
            recipientAddress = input.values[RECIPIENT_ADDRESS] as? String,
        )
        when (val result = drafts.open(draft)) {
            is DraftResult.Opened -> {
                // Where the app could not be told who it is for (a share), the user picks the chat.
                val addressed = result.addressed && draft.recipientAddress != null
                val forWhom = when {
                    name == null -> ""
                    addressed -> " to $name"
                    else -> " (choose $name there)"
                }
                SkillResult.Success(
                    output = mapOf("openedIn" to result.appName, "text" to text),
                    summary = "I opened ${result.appName} with your message$forWhom ready: \"$text\". Press Send to send it. " +
                        "ZARVIS doesn't send messages for you.",
                    userActionRequired = true,
                    evidence = mapOf("draftOpenedIn" to result.appName),
                )
            }
            is DraftResult.Unavailable -> SkillResult.Failure("draft_unavailable", result.message)
        }
    }

    private val WHATSAPP = setOf("whatsapp", "whatsap", "watsapp", "watsap", "wa", "whatsappbusiness", "व्हाट्सएप", "व्हाट्सऐप", "वॉट्सऐप")
    private val SMS = setOf("sms", "text", "textmessage", "message", "messages", "messaging", "मैसेज", "एसएमएस")
    private val EMAIL = setOf("email", "mail", "gmail", "emailapp", "ईमेल", "मेल")
}
