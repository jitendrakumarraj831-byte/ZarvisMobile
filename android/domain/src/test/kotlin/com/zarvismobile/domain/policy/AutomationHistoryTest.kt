package com.zarvismobile.domain.policy

import com.zarvismobile.domain.privacy.SensitiveApps
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AutomationHistoryTest {

    private fun record(i: Int, outcome: AutomationOutcome = AutomationOutcome.DONE) =
        AutomationRecord(Instant.ofEpochMilli(1_000L * i), "phone.open_app", "Open app number $i", outcome)

    @Test
    fun `the history keeps the newest entries first and at most a hundred`() {
        var history = emptyList<AutomationRecord>()
        for (i in 1..130) history = AutomationHistory.append(history, record(i))

        assertEquals(AutomationHistory.LIMIT, history.size)
        assertEquals("Open app number 130", history.first().action)
        assertEquals("Open app number 31", history.last().action)
    }

    @Test
    fun `what is stored reads back the same, Hindi included, and a long description is cut`() {
        val long = AutomationRecord(Instant.ofEpochMilli(5), "screen.read", "पढ़ो ".repeat(200), AutomationOutcome.REFUSED)
        val history = AutomationHistory.append(listOf(record(1, AutomationOutcome.PAUSED)), long)

        val decoded = AutomationHistory.decode(AutomationHistory.encode(history))

        assertEquals(history, decoded)
        assertEquals(AutomationHistory.MAX_ACTION_CHARS, decoded.first().action.length)
    }

    @Test
    fun `an unreadable store reads as empty and unknown entries are skipped`() {
        assertEquals(emptyList(), AutomationHistory.decode(null))
        assertEquals(emptyList(), AutomationHistory.decode("not json"))
        assertEquals(emptyList(), AutomationHistory.decode("""{"at":1}"""))
        val mixed = """[{"at":1,"skillId":"a.b","action":"x","outcome":"SOMETHING_NEW"},{"at":2,"skillId":"a.b","action":"y","outcome":"DONE"}]"""
        assertEquals(listOf(AutomationRecord(Instant.ofEpochMilli(2), "a.b", "y", AutomationOutcome.DONE)), AutomationHistory.decode(mixed))
    }

    @Test
    fun `banking, payment, trading and authenticator apps are sensitive, including ones whose names hide it`() {
        val sensitive = listOf(
            "com.snapwork.hdfc", // HDFC Bank
            "com.sbi.lotusintouch", // YONO SBI
            "com.sbi.SBIFreedomPlus",
            "com.axis.mobile", // Axis Mobile
            "com.Version1", // PNB ONE
            "com.dreamplug.androidapp", // CRED
            "com.zerodha.kite3", // Kite
            "com.msf.angelmobile", // Angel One
            "com.nextbillion.groww",
            "com.samsung.android.spay", // Samsung Wallet
            "com.authy.authy",
            "com.mobikwik_new",
            "com.csam.icici.bank.imobile",
            "net.one97.paytm",
            "com.phonepe.app",
            "com.google.android.apps.nbu.paisa.user",
            "in.org.npci.upiapp",
            "com.google.android.apps.authenticator2",
            "com.x8bit.bitwarden",
        )
        sensitive.forEach { assertTrue(SensitiveApps.isSensitivePackage(it), it) }
    }

    @Test
    fun `everyday apps are not sensitive, and a publisher prefix does not catch look-alike names`() {
        val ordinary = listOf(
            "com.whatsapp", "com.google.android.youtube", "com.android.chrome", "com.spotify.music", "com.google.android.apps.maps",
            "com.sbinfo.reader", "com.axis.mobilegames", "com.version10.app",
        )
        ordinary.forEach { assertFalse(SensitiveApps.isSensitivePackage(it), it) }
    }
}
