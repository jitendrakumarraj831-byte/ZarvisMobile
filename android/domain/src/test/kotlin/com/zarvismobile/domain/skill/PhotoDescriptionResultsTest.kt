package com.zarvismobile.domain.skill

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class PhotoDescriptionResultsTest {
    private fun failed(status: Int, code: String? = null, text: String? = null) =
        assertIs<PhotoDescription.Failed>(PhotoDescriptionResults.fromHttp(status, code, text))

    @Test
    fun `a 200 with text is the description, trimmed`() {
        assertEquals(PhotoDescription.Described("A red bus."), PhotoDescriptionResults.fromHttp(200, null, "  A red bus.\n"))
    }

    @Test
    fun `a 200 with no text is not shown as a description`() {
        assertEquals("empty", failed(200, text = "   ").reason)
        assertEquals("empty", failed(200, text = null).reason)
    }

    @Test
    fun `every server refusal maps to an honest reason`() {
        assertEquals("image_analysis_unavailable", failed(503, "image_analysis_unavailable").reason)
        assertEquals("ai_unavailable", failed(503, "ai_unavailable").reason)
        assertEquals("ai_quota", failed(429, "ai_quota_exceeded").reason)
        assertEquals("rate_limited", failed(429, "rate_limited").reason)
        assertEquals("too_large", failed(413, "file_too_large").reason)
        assertEquals("unreadable", failed(422, "extraction_failed").reason)
        assertEquals("unreadable", failed(422, "empty_document").reason)
        assertEquals("signed_out", failed(401).reason)
        assertEquals("failed", failed(500).reason)
    }

    @Test
    fun `a missing vision model is not blamed on the photo or on the connection`() {
        val message = failed(503, "image_analysis_unavailable").message
        assertTrue(message.contains("can see images") && !message.contains("connection"))
    }

    @Test
    fun `network and on-device failures say nothing was described`() {
        val network = assertIs<PhotoDescription.Failed>(PhotoDescriptionResults.networkFailure())
        assertEquals("network", network.reason)
        assertTrue(network.message.contains("not described"))
        val local = assertIs<PhotoDescription.Failed>(PhotoDescriptionResults.unreadableOnDevice())
        assertTrue(local.message.contains("nothing was sent"))
    }

    @Test
    fun anUnexpectedBreakIsReportedNotSwallowed() {
        val failure = assertIs<PhotoDescription.Failed>(PhotoDescriptionResults.unexpected())
        assertEquals("failed", failure.reason)
        assertTrue(failure.message.contains("not described"))
    }
}
