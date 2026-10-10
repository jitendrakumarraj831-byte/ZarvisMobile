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
}
