package com.zarvismobile.domain.orchestrator

/**
 * Keeps short capability words ("open", "call", "number") from hijacking ordinary chat.
 * A phone or reminder skill runs on device only when the utterance is shaped like that command.
 */
object DeviceCommandGate {
    private val blockedSubjects = setOf("this", "that", "it", "up", "topic", "day", "them", "him", "her", "time")

    fun accepts(skillId: String, utterance: String): Boolean {
        val words = utterance.lowercase().trim().split(Regex("\\s+")).filter { it.isNotBlank() }
        if (words.isEmpty()) return false
        return when (skillId) {
            "phone.open_app" -> commandSubject(words, listOf("open", "launch", "kholo", "khol")) != null
            "phone.call" -> !utterance.contains("call it", ignoreCase = true) &&
                commandSubject(words, listOf("call", "dial")) != null
            "phone.find_contact" -> words.take(4).any { it == "find" || it == "contact" || it == "number" } && words.size >= 2
            "personal.reminder" -> words.take(4).any { it == "remind" || it == "reminder" || it == "yaad" }
            else -> false
        }
    }

    private fun commandSubject(words: List<String>, verbs: List<String>): String? {
        val index = words.indexOfFirst { word -> verbs.any { verb -> word == verb } }
        if (index < 0 || index > 2) return null
        val subject = words.getOrNull(index + 1) ?: return null
        if (subject in blockedSubjects) return null
        return subject
    }
}
