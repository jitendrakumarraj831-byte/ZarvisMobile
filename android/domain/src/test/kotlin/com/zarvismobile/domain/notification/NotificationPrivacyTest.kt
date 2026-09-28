package com.zarvismobile.domain.notification

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NotificationPrivacyTest {
    private fun n(
        pkg: String = "com.whatsapp",
        app: String = "WhatsApp",
        category: String? = "msg",
        sender: String? = "Asha",
        title: String? = "Asha",
        text: String? = "Are we still on for dinner tonight at eight?",
        at: Long = 1_000,
    ) = NotificationSnapshot("k$at", pkg, app, category, sender, title, text, at)

    private val base = NotificationPrivacySettings()

    @Test
    fun `each privacy mode exposes only what it allows`() {
        assertNull(NotificationPrivacy.describe(n(), base.copy(mode = NotificationMode.OFF)))
        assertEquals("Message from WhatsApp", NotificationPrivacy.describe(n(), base.copy(mode = NotificationMode.APP_AND_TYPE)))
        assertEquals("Message from Asha on WhatsApp", NotificationPrivacy.describe(n(), base.copy(mode = NotificationMode.CONTACT_AND_APP)))
        assertEquals(
            "Message from Asha on WhatsApp: Are we still on for dinner tonight at eight?",
            NotificationPrivacy.describe(n(), base.copy(mode = NotificationMode.CONTACT_APP_PREVIEW)),
        )
        val full = NotificationPrivacy.describe(n(text = "x".repeat(400)), base.copy(mode = NotificationMode.FULL_CONTENT))!!
        assertTrue(full.length < 400)
    }

    @Test
    fun `a sender is never invented when Android gave none`() {
        val noSender = n(category = "promo", sender = null, title = "Big sale")
        assertEquals("Promotion from WhatsApp", NotificationPrivacy.describe(noSender, base.copy(mode = NotificationMode.CONTACT_AND_APP)))
    }

    @Test
    fun `OTP, banking and authenticator alerts are hidden by default and shown only when opted in`() {
        val otp = n(pkg = "com.google.android.apps.messaging", app = "Messages", sender = "AX-HDFC", text = "Your OTP is 482913. Do not share it.")
        val bank = n(pkg = "com.example.sms", app = "SMS", category = null, sender = null, text = "Rs 500 debited from A/c XX12")
        val authApp = n(pkg = "com.google.android.apps.authenticator2", app = "Authenticator", text = "Sign-in request")
        val code = n(text = "Use code 123456 to log in")
        listOf(otp, bank, authApp, code).forEach { assertTrue(NotificationPrivacy.isSensitive(it), it.text) }
        assertEquals("Security or banking alert from Messages (content hidden)", NotificationPrivacy.describe(otp, base.copy(mode = NotificationMode.FULL_CONTENT)))
        assertTrue(NotificationPrivacy.describe(otp, base.copy(mode = NotificationMode.FULL_CONTENT, includeSensitive = true))!!.contains("482913"))
        assertFalse(NotificationPrivacy.isSensitive(n()))
    }

    @Test
    fun `excluded apps are never described`() {
        assertNull(NotificationPrivacy.describe(n(), base.copy(excludedPackages = setOf("com.whatsapp"))))
    }

    @Test
    fun `quiet hours wrap past midnight`() {
        val q = QuietHours(true, 22 * 60, 7 * 60)
        assertTrue(q.contains(23 * 60))
        assertTrue(q.contains(3 * 60))
        assertFalse(q.contains(12 * 60))
        assertFalse(QuietHours(false, 22 * 60, 7 * 60).contains(23 * 60))
        assertTrue(QuietHours(true, 13 * 60, 14 * 60).contains(13 * 60 + 30))
    }

    private val on = base.copy(speakEnabled = true, headphonesOnly = false, quietHours = QuietHours(false, 0, 0), lockScreen = LockScreenBehavior.SAME_AS_UNLOCKED)
    private val noon = SpeakContext(minuteOfDay = 12 * 60, deviceLocked = false, headphonesConnected = false)

    @Test
    fun `speaking is off by default and follows every rule when on`() {
        assertIs<SpeakDecision.Skip>(NotificationPrivacy.speakDecision(n(), base, noon))
        assertEquals(SpeakDecision.Speak("Message from WhatsApp"), NotificationPrivacy.speakDecision(n(), on, noon))
        assertEquals(SpeakDecision.Skip("quiet hours"), NotificationPrivacy.speakDecision(n(), on.copy(quietHours = QuietHours(true, 11 * 60, 13 * 60)), noon))
        assertEquals(SpeakDecision.Skip("no headphones connected"), NotificationPrivacy.speakDecision(n(), on.copy(headphonesOnly = true), noon))
        assertIs<SpeakDecision.Speak>(NotificationPrivacy.speakDecision(n(), on.copy(headphonesOnly = true), noon.copy(headphonesConnected = true)))
        assertEquals(SpeakDecision.Skip("security or banking alert"), NotificationPrivacy.speakDecision(n(text = "Your OTP is 1234"), on, noon))
        assertEquals(SpeakDecision.Skip("app is excluded"), NotificationPrivacy.speakDecision(n(), on.copy(excludedPackages = setOf("com.whatsapp")), noon))
    }

    @Test
    fun `lock screen behaviour`() {
        val locked = noon.copy(deviceLocked = true)
        val contact = on.copy(mode = NotificationMode.CONTACT_APP_PREVIEW)
        assertEquals(SpeakDecision.Skip("phone is locked"), NotificationPrivacy.speakDecision(n(), contact.copy(lockScreen = LockScreenBehavior.SILENT_WHEN_LOCKED), locked))
        assertEquals(SpeakDecision.Speak("Message from WhatsApp"), NotificationPrivacy.speakDecision(n(), contact.copy(lockScreen = LockScreenBehavior.APP_ONLY_WHEN_LOCKED), locked))
        assertTrue((NotificationPrivacy.speakDecision(n(), contact, locked) as SpeakDecision.Speak).text.contains("dinner"))
    }

    @Test
    fun `summary is newest first, capped, and counts what was hidden`() {
        val items = (1..15).map { n(at = it.toLong(), sender = "S$it") } + n(at = 100, text = "OTP 9999 for login") + n(pkg = "com.x", app = "X", at = 50)
        val summary = NotificationPrivacy.summarize(items, base.copy(mode = NotificationMode.CONTACT_AND_APP, excludedPackages = setOf("com.x")))
        assertEquals(10, summary.lines.size)
        assertEquals(1, summary.hiddenSensitive)
        assertEquals(1, summary.excluded)
        assertEquals(17, summary.total)
        assertTrue(summary.lines.first().startsWith("Security or banking alert"))
    }
}
