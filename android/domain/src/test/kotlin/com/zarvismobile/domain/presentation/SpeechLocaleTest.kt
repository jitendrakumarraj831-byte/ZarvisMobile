package com.zarvismobile.domain.presentation

import kotlin.test.Test
import kotlin.test.assertEquals

/** Which language the phone's own voice is asked to read a reply in. */
class SpeechLocaleTest {
    @Test
    fun `an English reply follows the app's language`() {
        assertEquals("en-US", SpeechLocale.forReply("Here is your plan for the week.", "en"))
        assertEquals("hi-IN", SpeechLocale.forReply("Here is your plan for the week.", "hi"))
    }

    @Test
    fun `a reply in Devanagari is read in Hindi even with the app in English`() {
        assertEquals("hi-IN", SpeechLocale.forReply("आपका हफ़्ता तैयार है।", "en"))
        assertEquals("hi-IN", SpeechLocale.forReply("Done — कल सुबह 7 बजे का alarm लगा दिया।", "en"))
        assertEquals("hi-IN", SpeechLocale.forReply("आपका हफ़्ता तैयार है।", "hi"))
    }

    @Test
    fun `Hinglish in Latin letters follows the app's language`() {
        assertEquals("en-US", SpeechLocale.forReply("Theek hai, kal ka reminder laga diya.", "en"))
        assertEquals("hi-IN", SpeechLocale.forReply("Theek hai, kal ka reminder laga diya.", "hi"))
    }

    @Test
    fun `an unknown app language falls back to English`() {
        assertEquals("en-US", SpeechLocale.forReply("Hello", ""))
        assertEquals("en-US", SpeechLocale.forReply("Hello", "fr"))
    }
}
