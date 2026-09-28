package com.zarvismobile.domain.orchestrator

import com.zarvismobile.domain.skill.SpecialAccessSkills

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
                !containsAny(lower, "settings", "bluetooth", "wifi", "wi-fi", "notification", "recent")
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
            "notifications.read_recent" -> !containsAny(lower, "speak", "aloud", "announce", "bol", "stop", "turn off", "don't", "dont", "बोलो") &&
                containsAny(lower, "read", "padho", "batao", "check", "what", "any", "show", "पढ़ो", "my notifications")
            "notifications.speak_on" -> containsAny(lower, "speak", "aloud", "announce", "bolkar", "bol kar", "bolo", "बोलो") &&
                !containsAny(lower, "stop", "turn off", "don't", "dont", "mat ", "band", "मत")
            "notifications.speak_off" -> containsAny(lower, "stop", "turn off", "don't", "dont", "mat bolo", "band", "मत") &&
                containsAny(lower, "speak", "spoken", "announc", "aloud", "bol", "बोल")
            "usage.screen_time" -> containsAny(lower, "screen time", "usage", "how long have i", "how much time", "kitna phone", "which apps did", "स्क्रीन टाइम")
            "device.global_action" -> !isQuestion && SpecialAccessSkills.parseGlobalAction(utterance) != null
            "screen.read" -> containsAny(lower, "screen", "स्क्रीन") && containsAny(lower, "read", "what's on", "what is on", "padho", "kya hai", "पढ़ो")
            "screen.tap" -> SpecialAccessSkills.parseTapLabel(utterance) != null
            "assistant.setup" -> !isQuestion && containsAny(lower, "make", "set", "become", "banao", "change", "use zarvis")
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
