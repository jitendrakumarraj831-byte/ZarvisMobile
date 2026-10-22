package com.zarvismobile.domain.skill

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AppAliasesTest {

    @Test
    fun `a kind of app is found by its role, in English, Hinglish or Devanagari`() {
        val cases = mapOf(
            "gallery" to AppRole.GALLERY, "Gallery" to AppRole.GALLERY, "photos" to AppRole.GALLERY, "गैलरी" to AppRole.GALLERY,
            "camera" to AppRole.CAMERA, "कैमरा" to AppRole.CAMERA,
            "settings" to AppRole.SETTINGS, "सेटिंग्स" to AppRole.SETTINGS,
            "contacts" to AppRole.CONTACTS, "dialer" to AppRole.DIALER, "messages" to AppRole.MESSAGES,
            "calculator" to AppRole.CALCULATOR, "calendar" to AppRole.CALENDAR, "clock" to AppRole.CLOCK,
            "maps" to AppRole.MAPS, "play store" to AppRole.PLAY_STORE, "Play Store" to AppRole.PLAY_STORE,
        )
        for ((spoken, role) in cases) assertEquals(role, AppAliases.resolve(spoken).role, "\"$spoken\"")
        // "ड़" typed as one character or as "ड" + nukta.
        assertEquals(AppRole.CLOCK, AppAliases.resolve("\u0918\u095C\u0940").role)
        assertEquals(AppRole.CLOCK, AppAliases.resolve("\u0918\u0921\u093C\u0940").role)
        // When no app answers the role's intent, the usual labels are tried, the phone's own words first.
        assertEquals(listOf("Gallery", "Photos"), AppAliases.resolve("गैलरी").labels)
    }

    @Test
    fun `a named app is looked for by its launcher label, including how it is written in Devanagari`() {
        assertEquals(AppAliases.Resolution(null, listOf("WhatsApp")), AppAliases.resolve("व्हाट्सएप"))
        assertEquals(AppAliases.Resolution(null, listOf("YouTube")), AppAliases.resolve("यूट्यूब"))
        assertEquals(AppAliases.Resolution(null, listOf("whatsapp")), AppAliases.resolve(" whatsapp "))
        assertEquals(AppAliases.Resolution(null, listOf("Clash of Clans")), AppAliases.resolve("Clash of Clans"))
        assertEquals(AppAliases.Resolution(null, emptyList()), AppAliases.resolve("  "))
    }

    @Test
    fun `the closest launcher label wins, and a vague name opens nothing`() {
        val labels = listOf("Phone Link", "Phone", "YouTube Music", "YouTube", "Google Play Store", "Clash of Clans", "Photos")
        assertEquals(labels.indexOf("YouTube"), AppAliases.bestLabelMatch("youtube", labels))
        assertEquals(labels.indexOf("YouTube"), AppAliases.bestLabelMatch("you tube", labels))
        assertEquals(labels.indexOf("Phone"), AppAliases.bestLabelMatch("phone", labels))
        assertEquals(labels.indexOf("YouTube Music"), AppAliases.bestLabelMatch("youtube music", labels))
        assertEquals(labels.indexOf("Google Play Store"), AppAliases.bestLabelMatch("play store", labels))
        assertEquals(labels.indexOf("Clash of Clans"), AppAliases.bestLabelMatch("clash clans", labels))
        assertNull(AppAliases.bestLabelMatch("p", labels))
        assertNull(AppAliases.bestLabelMatch("whatsapp", labels))
        assertNull(AppAliases.bestLabelMatch("", labels))
    }
}
