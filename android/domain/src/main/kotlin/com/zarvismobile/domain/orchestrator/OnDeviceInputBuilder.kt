package com.zarvismobile.domain.orchestrator

import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.skill.SpecialAccessSkills

/**
 * Builds the [SkillInput] for a skill [KeywordSkillMatcher] matched, from the raw utterance
 * — for the same "offline, no AI provider" fallback path that matcher exists for (see its
 * own doc comment), NOT a real NLU/entity-extraction step. Before this existed, the
 * Android-side caller (`AndroidOrchestrator`, agents module) built one hardcoded
 * `{action, title}` shape for every match regardless of which skill actually matched — fine
 * when `personal.reminder` was the only on-device skill, silently wrong the moment a second
 * one (with a different `inputSchema`) was registered, since every match would still be fed
 * reminder-shaped input. Keyed on [SkillDefinition.id] and kept here rather than in
 * `AndroidOrchestrator` so this parsing logic is provable in a pure-Kotlin unit test
 * (`agents` is an Android library module and can't be) — see ARCHITECTURE.md "Why a
 * pure-Kotlin domain module".
 */
object OnDeviceInputBuilder {

    fun build(skill: SkillDefinition, utterance: String): SkillInput = when (skill.id) {
        "personal.reminder" -> if (isReminderListRequest(utterance)) {
            SkillInput(mapOf("action" to "list"))
        } else {
            // The skill parses the due time out of the text itself (ReminderTimeParser).
            SkillInput(mapOf("action" to "create", "title" to utterance))
        }
        "device.open_settings" -> SkillInput(mapOf("panel" to settingsPanel(utterance)))
        "alarm.set", "calendar.create_event" -> SkillInput(mapOf("utterance" to utterance))
        "phone.open_app" -> SkillInput(mapOf("appName" to subject(utterance, skill)))
        "phone.find_contact" -> SkillInput(mapOf("name" to subject(utterance, skill)))
        "phone.call" -> SkillInput(mapOf("target" to subject(utterance, skill)))
        "device.global_action" -> SkillInput(mapOf("action" to (SpecialAccessSkills.parseGlobalAction(utterance) ?: "")))
        "screen.tap" -> SkillInput(mapOf("label" to (SpecialAccessSkills.parseTapLabel(utterance) ?: "")))
        "app.search" -> SkillInput(SearchCommandParser.parse(utterance)?.let { mapOf("query" to it.query, "app" to it.app) } ?: mapOf("query" to ""))
        else -> SkillInput(mapOf("utterance" to utterance))
    }

    /**
     * Strips the skill's own trigger words (its declared capabilities/name) and a short list
     * of common filler words from the utterance, leaving — for the simple phrasings this is
     * meant to cover ("open WhatsApp", "call Mom", "call 9876543210") — just the subject.
     * Deliberately crude, same spirit as the untouched `personal.reminder` case above (which
     * does no stripping at all): this is the offline fallback, not real understanding
     * (AI_ARCHITECTURE.md's tool-calling loop is that).
     *
     * For the two contact skills the leftover must be exactly the person's name, because it is searched for in the address book (and a
     * wrong name rings the wrong person): so they also drop the words people put around a name ("what is mom's number", "mom ka number
     * batao", "call Rahul on speaker") — see [CONTACT_NOISE_WORDS].
     */
    private fun subject(utterance: String, skill: SkillDefinition): String {
        var remainder = " ${normalizePunctuation(utterance.lowercase())} "
        val triggerWords = skill.capabilities + skill.name.lowercase().split(" ")
        for (word in triggerWords) if (word.isNotBlank()) remainder = removeWord(remainder, word.lowercase())
        for (filler in FILLER_WORDS) remainder = removeWord(remainder, filler)
        val withoutNoise = if (skill.id in CONTACT_SKILL_IDS) {
            CONTACT_NOISE_WORDS.fold(remainder) { text, noise -> removeWord(text, noise) }
        } else {
            remainder
        }
        // "call mobile" would otherwise lose its only word; a lone noise word is better treated as the name than as nothing.
        val chosen = if (withoutNoise.isBlank()) remainder else withoutNoise
        // "call kar de", "whatsapp khol na": a helper word that ends the sentence; inside a name ("De Silva") it stays.
        val words = chosen.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
        val subject = words.dropLastWhile { it in TRAILING_FILLER_WORDS }.ifEmpty { words }.joinToString(" ")
        // "मम्मी को कॉल करो": the address book almost always has the relation in Latin letters ("Mummy").
        return if (skill.id in CONTACT_SKILL_IDS) RELATIONS_IN_LATIN[subject] ?: subject else subject
    }

    /** Whole-word removal that also works for neighbours ("call call") and keeps the spaces the next word needs. */
    private fun removeWord(text: String, word: String): String =
        text.replace(Regex("(?<!\\S)" + Regex.escape(word) + "(?!\\S)"), " ")

    /**
     * Commas and question/exclamation marks are not part of a name; a possessive ("mom's") or a bare trailing apostrophe ("Dennis'") is not
     * either, while one inside a name ("O'Brien") is. Typographic apostrophes are treated as plain ones.
     */
    private fun normalizePunctuation(text: String): String =
        text.replace('\u2019', '\'')
            .replace(Regex("[,!?;]"), " ")
            .replace(Regex("(?<=\\p{L})'s?(?!\\p{L})"), "")
            .replace(Regex("\\.+\\s*$"), "")

    private fun isReminderListRequest(utterance: String): Boolean {
        val lower = utterance.lowercase()
        // Any request about "reminders" that does not ask to be reminded: "show my reminders", "what reminders do I have",
        // "kal ke reminders dikhao".
        return !lower.contains("remind me") && !lower.contains("yaad dila") && !lower.contains("याद दिला") &&
            Regex("""\breminders\b""").containsMatchIn(lower)
    }

    private fun settingsPanel(utterance: String): String {
        val lower = utterance.lowercase()
        return when {
            lower.contains("wifi") || lower.contains("wi-fi") || lower.contains("वाईफाई") -> "WIFI"
            lower.contains("location") || lower.contains("gps") || lower.contains("लोकेशन") -> "LOCATION"
            lower.contains("bluetooth") -> "BLUETOOTH"
            // "open settings", "settings kholo": the Settings app itself.
            else -> "MAIN"
        }
    }

    private val CONTACT_SKILL_IDS = setOf("phone.find_contact", "phone.call")

    /**
     * Words around a person's name in "who is ...", "... ka number batao", "call ... on speaker" that are not part of the name. Removed only
     * for the contact skills, and only as whole words.
     */
    private val CONTACT_NOISE_WORDS = listOf(
        // what is / give me ... number
        "what", "whats", "who", "whose", "is", "are", "of", "show", "get", "give", "tell", "search", "lookup", "look",
        "number", "phone", "mobile", "cell", "contact",
        // Hinglish: ... ka number batao / dikhao / dhundo
        "batao", "bata", "bataiye", "dikhao", "dikha", "dhundo", "dhoondo", "khojo", "dedo", "dena", "chahiye", "hai", "kya",
        // how / when the call is made
        "now", "abhi", "jaldi", "speaker", "speakerphone", "lagao", "laga", "lagana", "lagado", "karna", "karde", "kardo", "kijiye", "karein",
        "milao", "mila", "hai",
        // the same in Devanagari
        "नंबर", "बताओ", "बता", "दिखाओ", "ढूंढो", "लगाओ", "लगा", "मिलाओ", "अभी", "करना", "कीजिए", "है",
    )

    /** Family words people say in Devanagari, as their contacts are usually saved (in Latin letters). Only a whole name is replaced. */
    private val RELATIONS_IN_LATIN = mapOf(
        "मम्मी" to "mummy", "मम्मा" to "mumma", "माँ" to "maa", "मां" to "maa", "पापा" to "papa", "पिताजी" to "pitaji",
        "भैया" to "bhaiya", "भाई" to "bhai", "दीदी" to "didi", "चाचा" to "chacha", "चाची" to "chachi", "मामा" to "mama",
        "मामी" to "mami", "नाना" to "nana", "नानी" to "nani", "दादा" to "dada", "दादी" to "dadi",
    )

    private val FILLER_WORDS = listOf(
        "please", "the", "to", "a", "an", "for", "me", "my", "on", "up", "app",
        "ka", "ki", "ko", "se", "kar", "karo", "do", "kro", "zara", "jaldi", "mera", "meri", "mere",
        "को", "का", "की", "से", "कर", "करो", "दो", "दें", "ज़रा", "जरा", "जल्दी", "मेरा", "मेरी", "मेरे", "ऐप",
    )

    /** Hindi helper words that only end a request ("kar de", "khol na"); removed from the end, never from inside a name. */
    private val TRAILING_FILLER_WORDS = setOf("de", "dena", "na", "dijiye", "दे", "देना", "ना", "दीजिए")
}
