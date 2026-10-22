package com.zarvismobile.domain.orchestrator

/**
 * A spoken or typed request to see search results in a named app, for `app.search` on the phone: "YouTube pe arijit ke gaane search
 * karo", "search pizza on the map", "airport ka rasta dikhao", "यूट्यूब पर भजन सर्च करो", "google pe best laptop search karo".
 *
 * Only with an app named and a search (or route) word, so ordinary questions ("search for the best laptop", "what is YouTube")
 * still go to the Brain, which can answer them. Negations, questions and long sentences are not commands.
 */
object SearchCommandParser {
    /** [app] is a name `AppSearchSkillFactory.targetOf` understands; [query] is what to search for, or the place. */
    data class Command(val app: String, val query: String)

    fun parse(utterance: String): Command? {
        val words = utterance.lowercase().split(Regex("\\s+")).map { it.trim(',', '.', '!', '?', '"', '\'') }.filter { it.isNotEmpty() }
        if (words.isEmpty() || words.size > 14) return null
        if (words.first() in QUESTION_STARTS || words.any { it in NEGATIONS }) return null
        val text = " " + words.joinToString(" ") + " "
        val directions = words.any { it in ROUTE_WORDS }
        val app = when {
            YOUTUBE.any { text.contains(" $it ") } -> "YouTube"
            PLAY_STORE.any { text.contains(" $it ") } -> "Play Store"
            directions -> "Directions"
            MAPS.any { text.contains(" $it ") } -> "Maps"
            GOOGLE.any { text.contains(" $it ") } -> "Web"
            else -> return null
        }
        val asked = directions || words.any { it in SEARCH_VERBS } ||
            (app == "Maps" && words.any { it in SHOW_VERBS }) || (app == "YouTube" && words.any { it in PLAY_VERBS })
        if (!asked) return null
        var rest = text
        for (name in YOUTUBE + PLAY_STORE + MAPS + GOOGLE) rest = rest.replace(" $name ", " ")
        val dropped = SEARCH_VERBS + SHOW_VERBS + PLAY_VERBS + ROUTE_WORDS + FILLERS + (if (app == "Directions") ROUTE_FILLERS else emptySet())
        val query = rest.split(' ').filter { it.isNotEmpty() && it !in dropped }.dropLastWhile { it in TRAILING }.joinToString(" ")
        return query.takeIf { it.isNotBlank() }?.let { Command(app, it) }
    }

    private val QUESTION_STARTS = setOf(
        "what", "why", "how", "which", "when", "who", "is", "are", "can", "could", "does", "do", "kya", "kaise", "kyun", "kyon", "kab",
        "क्या", "कैसे", "क्यों", "कब",
    )
    private val NEGATIONS = setOf("mat", "nahi", "nahin", "don't", "dont", "never", "मत", "नहीं")

    private val YOUTUBE = listOf("youtube", "you tube", "यूट्यूब")
    private val PLAY_STORE = listOf("play store", "playstore", "google play", "प्ले स्टोर")
    private val MAPS = listOf("google maps", "maps", "map", "मैप्स", "मैप", "नक्शे", "नक्शा")
    private val GOOGLE = listOf("google", "गूगल")

    private val SEARCH_VERBS = setOf(
        "search", "find", "look", "dhundo", "dhoondo", "dhundho", "dhoondho", "khojo", "sarch", "सर्च", "खोजो", "ढूंढो", "ढूँढो",
    )
    private val SHOW_VERBS = setOf("show", "dikhao", "dikha", "दिखाओ")
    private val PLAY_VERBS = setOf("play", "chalao", "bajao", "lagao", "चलाओ", "बजाओ", "लगाओ")
    private val ROUTE_WORDS = setOf("rasta", "raasta", "rastha", "directions", "direction", "navigate", "navigation", "route", "रास्ता")

    private val FILLERS = setOf(
        "pe", "par", "per", "mein", "me", "on", "in", "for", "the", "a", "an", "up", "karo", "kar", "kardo", "do", "de", "please",
        "plz", "zara", "jaldi", "mujhe", "my", "batao", "bata", "open", "kholo", "khol", "aur", "and", "then", "phir", "hai", "kya", "se",
        "पर", "में", "करो", "कर", "दो", "ज़रा", "जरा", "मुझे", "और", "फिर", "बताओ",
    )

    /** "the way to the airport", "airport tak": only around a destination. */
    private val ROUTE_FILLERS = setOf("to", "tak", "way", "ka", "ki", "ke", "तक", "का", "की", "के")

    /** "connaught place ka", "arijit ke": a word that only links the query to the verb that followed it. */
    private val TRAILING = setOf("ka", "ki", "ke", "का", "की", "के")
}
