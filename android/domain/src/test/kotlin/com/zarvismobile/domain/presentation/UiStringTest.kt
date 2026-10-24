package com.zarvismobile.domain.presentation

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class UiStringTest {
    private val placeholder = Regex("%[sd]")

    private fun hasDevanagari(text: String) = text.any { it in 'ऀ'..'ॿ' }

    @Test
    fun `every entry has Hindi text that is Devanagari`() {
        // "AI" is a name, not a word: it is the same in both languages.
        val sameInBoth = setOf(UiString.SETTINGS_PAGE_AI)
        for (entry in UiString.entries) {
            assertTrue(entry.hi.isNotBlank(), "${entry.name} has no Hindi")
            if (entry in sameInBoth) continue
            assertTrue(hasDevanagari(entry.hi), "${entry.name}: the Hindi is not Devanagari (${entry.hi})")
            assertTrue(entry.hi != entry.en, "${entry.name}: the Hindi is the English text")
        }
    }

    @Test
    fun `a placeholder in one language is in the other, in the same order`() {
        for (entry in UiString.entries) {
            assertEquals(
                placeholder.findAll(entry.en).map { it.value }.toList(),
                placeholder.findAll(entry.hi).map { it.value }.toList(),
                "${entry.name}: the placeholders differ between English and Hindi",
            )
        }
    }

    @Test
    fun `text follows the locale and an unknown locale is English`() {
        assertEquals("Home", UiString.NAV_HOME.text("en"))
        assertEquals("होम", UiString.NAV_HOME.text("hi"))
        assertEquals("होम", UiString.NAV_HOME.text("hi-IN"))
        assertEquals("Home", UiString.NAV_HOME.text("fr"))
        assertEquals("Home", UiString.NAV_HOME.text(""))
    }

    @Test
    fun `format fills the placeholders and keeps Latin digits`() {
        assertEquals("Plan: Pro · credits left: 12", UiString.HOME_PLAN_LINE.format("en", "Pro", 12))
        assertEquals("प्लान: Pro · बचे क्रेडिट: 12", UiString.HOME_PLAN_LINE.format("hi", "Pro", 12))
    }

    /** The emulator tests (android/app/src/androidTest) find these by their English text; changing one breaks them. */
    @Test
    fun `English text the emulator tests look for is unchanged`() {
        assertEquals("Skip", UiString.ONBOARDING_SKIP.en)
        assertEquals("Creative", UiString.HOME_CAT_CREATIVE.en)
        assertEquals("Settings", UiString.COMMON_SETTINGS.en)
        assertEquals("Notifications", UiString.SETTINGS_PAGE_NOTIFICATIONS.en)
        assertEquals("Permissions & Device Access", UiString.SETTINGS_PAGE_PERMISSIONS.en)
    }

    @Test
    fun `the Language page never claims Hindi covers everything`() {
        assertTrue("still in English" in UiString.LANGUAGE_SCOPE_BODY.en, UiString.LANGUAGE_SCOPE_BODY.en)
        assertTrue("अंग्रेज़ी में हैं" in UiString.LANGUAGE_SCOPE_BODY.hi, UiString.LANGUAGE_SCOPE_BODY.hi)
        assertFalse(UiString.LANGUAGE_SCOPE_BODY.en.contains("fully", ignoreCase = true))
    }

    @Test
    fun `the Language page keeps the app language apart from the language of the conversation`() {
        val en = UiString.LANGUAGE_SCOPE_BODY.en
        val hi = UiString.LANGUAGE_SCOPE_BODY.hi
        // Replies follow the language of the message; the app language is only a tie-breaker (backend/src/language/textLanguage.ts detectReplyLanguage).
        assertTrue("does not decide the language of your conversation" in en, en)
        assertTrue("you write or speak in" in en, en)
        assertTrue("बातचीत की भाषा तय नहीं करता" in hi, hi)
        // The earlier text said ZARVIS "is asked to reply in Hindi" and the rows said "Replies and app copy": neither is what happens.
        assertFalse("asked to reply" in en, en)
        assertFalse("reply in Hindi" in en, en)
        for (row in listOf(UiString.LANGUAGE_ENGLISH_SUB, UiString.LANGUAGE_HINDI_SUB)) {
            assertFalse(row.en.contains("repl", ignoreCase = true), row.en)
            assertFalse(row.en.contains("request", ignoreCase = true), row.en)
        }
        // Voice input and read-aloud do follow the app language (ConversationViewModel passes hi-IN or en-US), and the page says so.
        assertTrue("voice input and read-aloud" in en, en)
        // What is still English is named, after "Hindi switches" has named what is translated (Plans and Developer Agent moved to UiString).
        val stillEnglish = en.substringAfter("Error messages")
        assertTrue("Error messages" in en && "Permissions & Device Access" in stillEnglish, en)
        val translated = en.substringBefore("It does not decide")
        for (page in listOf("Skills", "Plans", "Developer Agent")) {
            assertTrue(page in translated, "$page is named as translated")
            assertFalse(page in stillEnglish, "$page is no longer English")
        }
    }

    @Test
    fun `the welcome pages only promise what the app does`() {
        // Export does not exist (Settings > Data says so); viewing and deleting memory does (Settings > Memory).
        val promise = UiString.ONBOARDING_5_BODY.en.lowercase()
        // Saying "no data export" is fine; offering one is not.
        assertFalse("export" in promise.replace("no data export", ""), promise)
        assertTrue("no data export" in promise, promise)
        assertTrue("memory" in promise, promise)
    }

    @Test
    fun `Hindi wording matches the website for the shared terms`() {
        // web/i18n.js: Home, Chat, Capabilities, Tasks, Work, New chat, Low/Medium risk.
        assertEquals("होम", UiString.NAV_HOME.hi)
        assertEquals("चैट", UiString.NAV_CHAT.hi)
        assertEquals("क्षमताएँ", UiString.NAV_CAPABILITIES.hi)
        assertEquals("कार्य", UiString.NAV_TASKS.hi)
        assertEquals("काम", UiString.NAV_WORK.hi)
        assertEquals("नई चैट", UiString.CHAT_NEW.hi)
        assertEquals("कम जोखिम", UiString.RISK_LOW.hi)
        assertEquals("मध्यम जोखिम", UiString.RISK_MEDIUM.hi)
    }

    @Test
    fun `the words TalkBack reads for the orb and the composer exist in both languages`() {
        val labels = listOf(
            UiString.A11Y_SPEAK, UiString.A11Y_SEND, UiString.A11Y_ORB_IDLE, UiString.A11Y_ORB_LISTENING, UiString.A11Y_ORB_UNDERSTANDING,
            UiString.A11Y_ORB_PLANNING, UiString.A11Y_ORB_WORKING, UiString.A11Y_ORB_DONE, UiString.A11Y_ORB_SPEAKING, UiString.A11Y_ORB_ERROR,
        )
        // The orb used to be announced in English whatever the app language was; these keep it from slipping back.
        assertEquals(labels.size, labels.map { it.en }.toSet().size, "two orb states would be announced with the same words")
        for (label in labels) {
            assertTrue(label.en.isNotBlank() && hasDevanagari(label.hi), label.name)
        }
        assertEquals("Tap to speak", UiString.A11Y_ORB_IDLE.en)
        assertEquals("Speak", UiString.A11Y_SPEAK.en)
        assertEquals("Send", UiString.A11Y_SEND.en)
    }

    @Test
    fun `the Settings pages that moved to UiString keep the English they always had`() {
        // The emulator and the website use these words; only the Hindi is new. The appearance lines name the Queen theme.
        assertEquals("Dark theme", UiString.APPEARANCE_DARK_TITLE.en)
        assertEquals("Queen Dark is active", UiString.APPEARANCE_DARK_ON.en)
        assertEquals("Queen Light is active", UiString.APPEARANCE_DARK_OFF.en)
        assertEquals("Queen Dark is the default appearance.", UiString.APPEARANCE_DEFAULT_NOTE.en)
        assertEquals("Speak replies aloud", UiString.VOICE_SPEAK_TITLE.en)
        assertEquals("Voice style", UiString.VOICE_STYLE.en)
        assertEquals("Sign out", UiString.SIGN_OUT.en)
        assertEquals("Sign out?", UiString.SIGN_OUT_TITLE.en)
        assertEquals("Delete account", UiString.DELETE_ACCOUNT.en)
        assertEquals("Delete your account?", UiString.DELETE_ACCOUNT_TITLE.en)
        assertEquals("Deleting…", UiString.DELETE_ACCOUNT_BUSY.en)
    }

    @Test
    fun `the Language page names the Settings pages that are translated and the ones that are not`() {
        val en = UiString.LANGUAGE_SCOPE_BODY.en
        val hi = UiString.LANGUAGE_SCOPE_BODY.hi
        assertTrue("Appearance, Voice" in en, en)
        assertTrue("sign-out and delete-account" in en, en)
        // What is still English is listed by name, so the claim can be checked page by page.
        for (page in listOf("AI", "Notifications", "Privacy", "Data", "Rules & Protection")) assertTrue(page in en, "$page is not named as still English")
        assertTrue("दिखावट, वॉइस" in hi, hi)
        assertTrue("अभी अंग्रेज़ी में हैं" in hi, hi)
    }
}
