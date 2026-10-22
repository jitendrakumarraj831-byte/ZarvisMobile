package com.zarvismobile.domain.orchestrator

import com.zarvismobile.domain.skill.SpecialAccessSkills

/**
 * Keeps short capability words ("open", "call", "alarm", "bluetooth") from hijacking ordinary
 * chat. A device skill runs on-device only when the utterance is shaped like a command for
 * it; questions *about* a topic ("how does bluetooth work?") go to the shared Brain instead.
 */
object DeviceCommandGate {
    private val blockedSubjects = setOf("this", "that", "it", "up", "topic", "day", "them", "him", "her", "time")

    /**
     * Words after "call"/"dial" that show it is not a request to ring a contact: "call me later" and "call us back" ask to be called,
     * "call off the meeting" and "call in sick" are other meanings of the word. Without this, "call me later" tried to ring a contact named
     * "later".
     */
    private val notACallTarget = setOf("me", "us", "later", "back", "tomorrow", "tonight", "soon", "again", "off", "out", "in")

    /**
     * Words that make a sentence with "call" something other than "ring this person now": a negation ("call mat karo", "don't call
     * Rahul"), a deferral ("baad mein call karna") or a question about calling ("call kaise karte hain"). Hindi puts them after the
     * verb, so they are looked for anywhere in the sentence, as whole words. Such a sentence goes to the Brain, which only answers it:
     * "call mat karo" used to open the call flow for a contact matching "mat".
     */
    private val notACallRequest = setOf(
        "mat", "nahi", "nahin", "don't", "dont", "don’t", "never", "baad", "later", "kaise", "kyun", "kyon", "kab",
        "मत", "नहीं", "बाद", "कैसे", "क्यों", "कब",
    )
    /**
     * "Don't", "not", "when", "how" and "why" words in a sentence with "open"/"kholo": "WhatsApp mat kholo", "dukaan kab kholo" and
     * "app kaise kholte hain" are not requests to open anything now.
     */
    private val notAnOpenRequest = setOf(
        "mat", "nahi", "nahin", "don't", "dont", "don’t", "never", "kab", "kaise", "kyun", "kyon",
        "मत", "नहीं", "कब", "कैसे", "क्यों",
    )

    /**
     * "na" is "not" before a verb ("WhatsApp na kholo", "call na karo") but only a softener at the end ("chrome kholo na", "call karo na
     * please"), which is still a request.
     */
    private fun saysNa(words: List<String>): Boolean = words.indices.any { index ->
        words[index] in setOf("na", "ना") && words.drop(index + 1).any { it !in setOf("please", "plz", "yaar", "bhai", "ji") }
    }

    /** Verbs that open an app. The Hindi ones may close the sentence ("WhatsApp kholo"); the English ones open it ("open WhatsApp"). */
    private val openVerbs = setOf("open", "launch", "kholo", "khol", "kholdo", "kholiye", "chalu", "chalao", "खोलो", "खोल", "खोलें", "खोलिए", "चालू", "चलाओ")
    private val hindiOpenVerbs = setOf("kholo", "khol", "kholdo", "kholiye", "chalu", "chalao", "खोलो", "खोल", "खोलें", "खोलिए", "चालू", "चलाओ")

    /** "call", "dial", and "phone"/"फ़ोन" when a Hindi verb follows it ("mummy ko phone lagao"). */
    private val callVerbs = setOf("call", "dial", "कॉल", "काल")
    private val phoneWords = setOf("phone", "fone", "फोन", "फ़ोन")
    private val dialWords = setOf("lagao", "laga", "lagado", "lagaiye", "milao", "mila", "लगाओ", "लगा", "मिलाओ", "मिला")

    /**
     * Hindi helper verbs and politeness words that come after the main verb ("call karo", "khol do", "open kar do na") or around a
     * name ("Rahul ko"). A sentence whose verb is followed only by these is in Hindi order: the name or app is BEFORE the verb.
     */
    private val trailingFillers = setOf(
        "karo", "kar", "kardo", "karde", "karna", "karni", "do", "de", "dena", "dijiye", "na", "please", "plz", "zara", "jaldi", "abhi",
        "hai", "ho", "se", "ko", "lagao", "laga", "lagado", "milao",
        "करो", "कर", "करें", "करना", "दो", "दें", "दीजिए", "ना", "ज़रा", "जरा", "जल्दी", "अभी", "है", "से", "को", "लगाओ", "मिलाओ",
    )

    /** Words before the name in a Hindi-order command that are not the name: "mera WhatsApp kholo", "Rahul ko call karo". */
    private val leadingFillers = trailingFillers + setOf("mera", "meri", "mere", "the", "my", "a", "an", "app", "ऐप", "मेरा", "मेरी", "मेरे")

    private val describeVerbs = setOf("describe", "analyze", "analyse", "identify", "explain")
    private val questionStarts = setOf("what", "why", "how", "which", "explain", "kya", "kaise", "kyun", "kyon", "क्या", "कैसे", "क्यों")

    fun accepts(skillId: String, utterance: String): Boolean {
        val lower = utterance.lowercase().trim()
        val words = lower.split(Regex("\\s+")).filter { it.isNotBlank() }
        if (words.isEmpty()) return false
        val isQuestion = words.first() in questionStarts
        val clean = words.map { it.trim(',', '.', '!', '?') }
        return when (skillId) {
            "phone.open_app" -> !isQuestion &&
                words.none { it.trim(',', '.', '!', '?') in notAnOpenRequest } && !saysNa(clean) &&
                openSubject(words) != null &&
                !containsAny(lower, "settings", "setting", "सेटिंग", "bluetooth", "ब्लूटूथ", "wifi", "wi-fi", "वाईफाई", "location", "gps", "लोकेशन", "notification", "recent")
            "phone.call" -> !utterance.contains("call it", ignoreCase = true) &&
                words.none { it.trim(',', '.', '!', '?') in notACallRequest } && !saysNa(clean) &&
                callSubject(words) != null
            "phone.find_contact" -> words.take(4).any { it == "find" || it == "contact" || it == "number" } && words.size >= 2
            "personal.reminder" -> words.take(4).any { it == "remind" || it == "reminder" || it == "reminders" || it == "yaad" }
            "files.pick_document", "photos.pick_photo", "camera.capture_photo" -> !isQuestion
            // A command about a photo ("describe a photo", "what's in this photo"), not a writing request that merely mentions one
            // ("write a poem describing a photo"): the describing word must open the sentence.
            "photos.describe_photo" -> containsAny(lower, "photo", "picture", "image", "pic ", "तस्वीर", "फोटो", "tasveer") &&
                (words.take(3).any { it in describeVerbs } || lower.startsWith("what is in") || lower.startsWith("what's in") ||
                    lower.startsWith("photo ") || lower.startsWith("फोटो"))
            // "Where am I", "meri location batao" — not "location chalu karo" / "turn on location", which open the location settings.
            "location.current" -> lower.contains("where am i") ||
                (!isQuestion && !containsAny(lower, "chalu", "on karo", "on kar", "turn on", "enable", "kholo", "open", "settings", "चालू", "खोलो"))
            "bluetooth.open_settings" -> !isQuestion && containsAny(lower, "open", "settings", "connect", "pair", "turn on", "on karo", "chalu", "kholo")
            // Wi-Fi or location: "wifi chalu karo", "open location settings". The Settings app itself needs an open verb, so a sentence
            // that only mentions settings ("change my privacy settings in Facebook") is not a command to open it. Quick settings is
            // the notification shade's panel (device.global_action); Bluetooth has its own skill (bluetooth.open_settings).
            "device.open_settings" -> !isQuestion && !containsAny(lower, "quick settings", "bluetooth", "ब्लूटूथ") && if (containsAny(lower, "wifi", "wi-fi", "location", "gps", "वाईफाई", "लोकेशन")) {
                containsAny(lower, "open", "settings", "kholo", "turn on", "chalu", "on karo", "on kar", "enable", "चालू", "खोलो")
            } else {
                words.any { it.trim(',', '.', '!', '?') in openVerbs } && words.none { it.trim(',', '.', '!', '?') in notAnOpenRequest } && !saysNa(clean)
            }
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

    /** The app named in an open command, in English order ("open WhatsApp") or Hindi order ("WhatsApp kholo", "whatsapp open karo"). */
    private fun openSubject(words: List<String>): String? {
        val clean = words.map { it.trim(',', '.', '!', '?') }
        val index = clean.indexOfFirst { it in openVerbs }
        if (index < 0) return null
        return subjectAround(clean, index, index + 1, hindiVerb = clean[index] in hindiOpenVerbs)
    }

    /** Who to call, in English order ("call Mom") or Hindi order ("Mom ko call karo", "मम्मी को कॉल करो", "mummy ko phone lagao"). */
    private fun callSubject(words: List<String>): String? {
        val clean = words.map { it.trim(',', '.', '!', '?') }
        for (index in clean.indices) {
            val word = clean[index]
            if (word in callVerbs) return subjectAround(clean, index, index + 1, hindiVerb = word == "कॉल" || word == "काल", blocked = notACallTarget)
            // "phone lagao": the Hindi verb after "phone" makes it a call, with the name before it.
            if (word in phoneWords && clean.getOrNull(index + 1) in dialWords) return subjectAround(clean, index, index + 2, hindiVerb = true, blocked = notACallTarget)
        }
        return null
    }

    /**
     * English order: the verb is among the first three words and the subject is the first real word after it ("open the gallery").
     * Hindi order: only helper words follow the verb ([hindiVerb], or an English verb followed by one: "open karo", "call kar do"), and
     * the subject is the last real word before it ("mera WhatsApp jaldi se kholo"). A blocked subject ("call me", "open this") is not a
     * command. Long sentences are not commands, so "I want to know if the shop is open" stays chat.
     */
    private fun subjectAround(words: List<String>, verbStart: Int, verbEnd: Int, hindiVerb: Boolean, blocked: Set<String> = emptySet()): String? {
        if (words.size > 8) return null
        val after = words.drop(verbEnd)
        val hindiOrder = after.all { it in trailingFillers } && (hindiVerb || after.isNotEmpty())
        if (hindiOrder) {
            val subject = words.take(verbStart).lastOrNull { it !in leadingFillers } ?: return null
            return subject.takeUnless { it in blockedSubjects || it in blocked }
        }
        if (verbStart > 2) return null
        val subject = after.firstOrNull { it !in trailingFillers && it !in setOf("the", "a", "an", "my", "app") } ?: return null
        return subject.takeUnless { it in blockedSubjects || it in blocked }
    }
}
