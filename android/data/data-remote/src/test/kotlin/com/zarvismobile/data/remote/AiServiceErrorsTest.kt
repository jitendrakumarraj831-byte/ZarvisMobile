package com.zarvismobile.data.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AiServiceErrorsTest {
    @Test
    fun dailyQuotaIsReportedAsSuchNotAsAConnectionProblem() {
        val body = """{"type":"AI_QUOTA_EXCEEDED","code":"AI_QUOTA_EXCEEDED","retryable":false,"quotaType":"daily","error":"x"}"""
        val error = AiServiceErrors.classify(429, body)!!
        assertTrue(error.message.contains("today's AI usage limit"))
        assertTrue(!error.message.contains("connection"))
        assertEquals(false, error.retryable)
    }

    @Test
    fun providerAndAccountRateLimitsShareOneMessage() {
        val provider = AiServiceErrors.classify(429, """{"code":"AI_RATE_LIMITED","retryAfterMs":4000}""")
        val limiter = AiServiceErrors.classify(429, """{"error":"Too many requests","code":"rate_limited"}""")
        assertTrue(provider!!.message.contains("too many requests"))
        assertEquals(true, provider.retryable)
        assertEquals(provider, limiter)
    }

    @Test
    fun anythingElseIsNotAnAiServiceError() {
        assertNull(AiServiceErrors.classify(500, """{"code":"AI_QUOTA_EXCEEDED"}"""))
        assertNull(AiServiceErrors.classify(429, "<html>proxy</html>"))
        assertNull(AiServiceErrors.classify(429, null))
        assertNull(AiServiceErrors.classify(503, """{"error":"down"}"""))
    }
}
