package com.zarvismobile.domain.presentation

/**
 * The language a reply is read aloud in, as a BCP 47 tag for the phone's own text-to-speech (the fallback when the server's voice
 * cannot speak). The server picks its voice from the text itself; the phone's engine needs to be told. A reply written in Devanagari
 * is Hindi whatever language the app is in (asked in Hindi with the app in English, the answer still comes in Hindi), and an English
 * voice would skip or garble it. Anything else follows the app's language, as before.
 */
object SpeechLocale {
    const val HINDI = "hi-IN"
    const val ENGLISH = "en-US"

    /** [appLanguage] is the app's language setting, `"en"` or `"hi"`. */
    fun forReply(text: String, appLanguage: String): String = when {
        text.any { it in DEVANAGARI } -> HINDI
        appLanguage == "hi" -> HINDI
        else -> ENGLISH
    }

    private val DEVANAGARI = 'ऀ'..'ॿ'
}
