package com.zarvismobile.domain.skill

import java.text.Normalizer

/**
 * A kind of app Android can find by its role (an intent category or action), whatever it is called on this phone: the
 * gallery is "Photos" on a Pixel and "Gallery" on a Samsung, the dialer is "Phone", the browser may be Chrome or another.
 */
enum class AppRole(val displayName: String) {
    GALLERY("Gallery"),
    CAMERA("Camera"),
    SETTINGS("Settings"),
    CONTACTS("Contacts"),
    DIALER("Phone"),
    MESSAGES("Messages"),
    BROWSER("Browser"),
    CALCULATOR("Calculator"),
    CALENDAR("Calendar"),
    CLOCK("Clock"),
    MAPS("Maps"),
    MUSIC("Music"),
    EMAIL("Email"),
    FILES("Files"),
    PLAY_STORE("Play Store"),
}

/**
 * What the user called an app ("gallery", "गैलरी", "kamera", "व्हाट्सएप", "WhatsApp") turned into what `phone.open_app` looks for on
 * the phone: a [AppRole] Android resolves to the right app, and launcher labels to try (for a role whose intent no app handles, and
 * for every other app). Pure, so the words are unit-tested; the Android side (core-tooling AndroidAppLauncherPort) only resolves.
 */
object AppAliases {
    data class Resolution(val role: AppRole?, val labels: List<String>)

    fun resolve(spoken: String): Resolution {
        val key = normalize(spoken)
        if (key.isEmpty()) return Resolution(null, emptyList())
        for ((role, words) in ROLE_WORDS) {
            if (words.any { normalize(it) == key }) return Resolution(role, ROLE_LABELS[role].orEmpty())
        }
        NAMED_APPS.entries.firstOrNull { (spokenName, _) -> normalize(spokenName) == key }?.let { return Resolution(null, listOf(it.value)) }
        return Resolution(null, listOf(spoken.trim()))
    }

    /**
     * The index of the launcher label that best matches [spoken]: the same name, then a label that starts with it, then one that
     * contains it, then one containing every word of it; the shortest label wins within a tier ("Phone" over "Phone Link"). Case,
     * spaces and punctuation are ignored ("youtube" finds "YouTube", "play store" finds "Play Store"). Null when nothing matches. A
     * one-letter name must match exactly, so "a" does not open the first app with an "a" in it.
     */
    fun bestLabelMatch(spoken: String, labels: List<String>): Int? {
        val key = normalize(spoken)
        if (key.isEmpty()) return null
        val normalized = labels.map(::normalize)
        fun shortest(test: (String) -> Boolean): Int? =
            normalized.indices.filter { test(normalized[it]) }.minByOrNull { normalized[it].length }
        shortest { it == key }?.let { return it }
        if (key.length < 2) return null
        shortest { it.startsWith(key) }?.let { return it }
        shortest { it.contains(key) }?.let { return it }
        val words = spoken.lowercase().split(Regex("\\s+")).map(::normalize).filter { it.length >= 2 }
        if (words.size > 1) shortest { label -> words.all { label.contains(it) } }?.let { return it }
        return null
    }

    /**
     * Lower case, letters and digits only (Devanagari vowel signs and nuktas are letters' marks and are kept). NFC first, so "ड़" typed as
     * one character or as "ड" + nukta is the same word.
     */
    fun normalize(text: String): String =
        Normalizer.normalize(text, Normalizer.Form.NFC).lowercase().replace(Regex("[^\\p{L}\\p{M}\\p{N}]"), "")

    private val ROLE_WORDS: Map<AppRole, List<String>> = mapOf(
        AppRole.GALLERY to listOf("gallery", "gallary", "galary", "photos", "photo gallery", "pictures", "my photos", "गैलरी", "गैलेरी", "फोटो गैलरी", "फ़ोटो गैलरी"),
        AppRole.CAMERA to listOf("camera", "kamera", "camera app", "कैमरा", "कैमरे"),
        AppRole.SETTINGS to listOf("settings", "setting", "settings app", "सेटिंग्स", "सेटिंग"),
        AppRole.CONTACTS to listOf("contacts", "contact list", "contacts app", "कॉन्टैक्ट्स", "कांटेक्ट", "संपर्क"),
        AppRole.DIALER to listOf("dialer", "dialpad", "dial pad", "phone app", "डायलर"),
        AppRole.MESSAGES to listOf("messages", "message", "sms", "messaging", "मैसेज", "मैसेजेस", "संदेश"),
        AppRole.BROWSER to listOf("browser", "internet", "web browser", "ब्राउज़र", "ब्राउजर"),
        AppRole.CALCULATOR to listOf("calculator", "calc", "कैलकुलेटर"),
        AppRole.CALENDAR to listOf("calendar", "कैलेंडर"),
        AppRole.CLOCK to listOf("clock", "clock app", "घड़ी"),
        AppRole.MAPS to listOf("maps", "map", "google maps", "मैप्स", "मैप", "नक्शा"),
        AppRole.MUSIC to listOf("music", "music app", "songs", "म्यूज़िक", "म्यूजिक", "गाने"),
        AppRole.EMAIL to listOf("email", "mail", "e-mail", "ईमेल"),
        AppRole.FILES to listOf("files", "file manager", "my files", "फ़ाइलें", "फाइलें", "फाइल मैनेजर"),
        AppRole.PLAY_STORE to listOf("play store", "playstore", "google play", "प्ले स्टोर"),
    )

    /** Labels to look for when no app answers the role's intent (or for a role Android has no intent for). */
    private val ROLE_LABELS: Map<AppRole, List<String>> = mapOf(
        AppRole.GALLERY to listOf("Gallery", "Photos"),
        AppRole.CAMERA to listOf("Camera"),
        AppRole.SETTINGS to listOf("Settings"),
        AppRole.CONTACTS to listOf("Contacts"),
        AppRole.DIALER to listOf("Phone"),
        AppRole.MESSAGES to listOf("Messages", "Messaging"),
        AppRole.BROWSER to listOf("Chrome", "Browser", "Internet"),
        AppRole.CALCULATOR to listOf("Calculator"),
        AppRole.CALENDAR to listOf("Calendar"),
        AppRole.CLOCK to listOf("Clock"),
        AppRole.MAPS to listOf("Maps"),
        AppRole.MUSIC to listOf("YouTube Music", "Music"),
        AppRole.EMAIL to listOf("Gmail", "Email"),
        AppRole.FILES to listOf("Files", "File Manager", "My Files"),
        AppRole.PLAY_STORE to listOf("Play Store"),
    )

    /** Common apps by how people say or write them (Devanagari, short forms, misspellings) → their launcher label. */
    private val NAMED_APPS: Map<String, String> = mapOf(
        "व्हाट्सएप" to "WhatsApp", "व्हाट्सऐप" to "WhatsApp", "वॉट्सऐप" to "WhatsApp", "whatsap" to "WhatsApp", "watsapp" to "WhatsApp", "watsap" to "WhatsApp",
        "यूट्यूब" to "YouTube", "youtub" to "YouTube", "you tube" to "YouTube",
        "क्रोम" to "Chrome",
        "इंस्टाग्राम" to "Instagram", "insta" to "Instagram",
        "फेसबुक" to "Facebook", "fb" to "Facebook",
        "जीमेल" to "Gmail",
        "टेलीग्राम" to "Telegram",
        "पेटीएम" to "Paytm",
        "फोनपे" to "PhonePe", "phone pe" to "PhonePe",
        "स्पॉटिफाई" to "Spotify",
    )
}
