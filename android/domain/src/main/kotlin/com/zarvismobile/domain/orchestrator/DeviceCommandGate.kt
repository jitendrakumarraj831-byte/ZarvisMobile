package com.zarvismobile.domain.orchestrator

/**
 * Keeps short capability words ("open", "call", "alarm", "bluetooth") from hijacking ordinary
 * chat. A device skill runs on-device only when the utterance is shaped like a command for
 * it; questions *about* a topic ("how does bluetooth work?") go to the shared Brain instead.
 */
object DeviceCommandGate {
    private val blockedSubjects = setOf("this", "that", "it", "up", "topic", "day", "them", "him", "her", "time")
    private val questionStarts = setOf("what", "why", "how", "which", "explain", "kya", "kaise", "kyun", "kyon", "क्या", "कैसे", "क्यों")

    fun accepts(skillId: String, utterance: String): Boolean {
        val lower = utterance.lowercase().trim()
        val words = lower.split(Regex("\\s+")).filter { it.isNotBlank() }
        if (words.isEmpty()) return false
        val isQuestion = words.first() in questionStarts
        return when (skillId) {
            "phone.open_app" -> commandSubject(words, listOf("open", "launch", "kholo", "khol")) != null &&
                !lower.contains("settings") && !lower.contains("bluetooth") && !lower.contains("wifi") && !lower.contains("wi-fi")
            "phone.call" -> !utterance.contains("call it", ignoreCase = true) &&
                commandSubject(words, listOf("call", "dial")) != null
            "phone.find_contact" -> words.take(4).any { it == "find" || it == "contact" || it == "number" } && words.size >= 2
            "personal.reminder" -> words.take(4).any { it == "remind" || it == "reminder" || it == "reminders" || it == "yaad" }
            "files.pick_document", "photos.pick_photo", "camera.capture_photo" -> !isQuestion
            "location.current" -> lower.contains("where am i") || !isQuestion
            "bluetooth.open_settings" -> !isQuestion && containsAny(lower, "open", "settings", "connect", "pair", "turn on", "on karo", "chalu", "kholo")
            "device.open_settings" -> !isQuestion && containsAny(lower, "open", "settings", "kholo", "turn on", "chalu")
            "alarm.set" -> !isQuestion && containsAny(lower, "set", "laga", "wake me", "जगा", "लगा")
            "calendar.create_event" -> !isQuestion && containsAny(lower, "add", "create", "schedule", "put", "daal", "banao", "जोड़")
            else -> false
        }
    }

    private fun containsAny(text: String, vararg needles: String) = needles.any { text.contains(it) }

    private fun commandSubject(words: List<String>, verbs: List<String>): String? {
        val index = words.indexOfFirst { word -> verbs.any { verb -> word == verb } }
        if (index < 0 || index > 2) return null
        val subject = words.getOrNull(index + 1) ?: return null
        if (subject in blockedSubjects) return null
        return subject
    }
}
