package com.zarvismobile.domain.presentation

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** What the chat says when a message gets no answer: only what is known to have happened, and Retry only where it can help. */
class TurnFailuresTest {
    @Test
    fun `a connection that never got an answer is offline, and one lost mid-reply is interrupted`() {
        assertEquals(TurnFailure(TurnFailureKind.OFFLINE, retryable = true), TurnFailures.network(replyStarted = false))
        assertEquals(TurnFailure(TurnFailureKind.INTERRUPTED, retryable = true), TurnFailures.network(replyStarted = true))
        // Only the offline case may say nothing was done: once the server had started, part of the request may have run.
        assertTrue("nothing was done" in TurnFailureKind.OFFLINE.text.en)
        assertFalse("nothing was done" in TurnFailureKind.INTERRUPTED.text.en)
        assertTrue("may have run" in TurnFailureKind.INTERRUPTED.text.en)
    }

    @Test
    fun `server failures are not called connection problems`() {
        for (status in listOf(500, 502, 503, 504)) {
            val failure = TurnFailures.fromHttp(status, null)
            assertEquals(TurnFailureKind.SERVER, failure.kind, "HTTP $status")
            assertTrue(failure.retryable)
            assertFalse("connection" in failure.message("en"), "HTTP $status must not blame the connection")
        }
        assertEquals(TurnFailureKind.SERVER, TurnFailures.fromStreamError(null, null).kind)
        assertFalse("connection" in TurnFailures.fromStreamError(null, true).message("en"))
    }

    @Test
    fun `a message still being worked on asks to wait, and can be retried`() {
        assertEquals(TurnFailure(TurnFailureKind.BUSY, retryable = true), TurnFailures.fromHttp(409, "turn_in_progress"))
        assertEquals(TurnFailure(TurnFailureKind.BUSY, retryable = true), TurnFailures.fromStreamError("turn_in_progress", true))
    }

    @Test
    fun `a refused request is not offered again unchanged, and an ended session asks to sign in`() {
        assertEquals(TurnFailure(TurnFailureKind.REJECTED, retryable = false), TurnFailures.fromHttp(400, "invalid_request"))
        assertEquals(TurnFailure(TurnFailureKind.REJECTED, retryable = false), TurnFailures.fromHttp(409, "client_turn_id_reused"))
        assertEquals(TurnFailure(TurnFailureKind.REJECTED, retryable = false), TurnFailures.fromStreamError("client_turn_id_reused", false))
        assertEquals(TurnFailure(TurnFailureKind.SESSION, retryable = false), TurnFailures.fromHttp(401, "session_revoked"))
        assertTrue("Sign in" in TurnFailureKind.SESSION.text.en)
    }

    @Test
    fun `the server's own retryable answer is kept for an error inside the reply stream`() {
        assertFalse(TurnFailures.fromStreamError("something_new", false).retryable)
        assertTrue(TurnFailures.fromStreamError("something_new", null).retryable)
    }

    @Test
    fun `every failure has Hindi text`() {
        for (kind in TurnFailureKind.entries) {
            assertTrue(kind.text.hi.any { it in 'ऀ'..'ॿ' }, kind.name)
            assertEquals(kind.text.hi, TurnFailure(kind, true).message("hi-IN"))
        }
    }
}

class SpeechErrorsTest {
    @Test
    fun `hearing nothing is a hint, not an error`() {
        for (code in listOf(SpeechErrors.NO_MATCH, SpeechErrors.SPEECH_TIMEOUT)) {
            val outcome = SpeechErrors.describe(code)
            assertFalse(outcome.isError, "code $code")
            assertEquals(UiString.VOICE_NOT_HEARD, outcome.text)
        }
    }

    @Test
    fun `every other code says what went wrong in words, never the number`() {
        val expected = mapOf(
            SpeechErrors.NETWORK_TIMEOUT to UiString.VOICE_NETWORK,
            SpeechErrors.NETWORK to UiString.VOICE_NETWORK,
            SpeechErrors.SERVER to UiString.VOICE_NETWORK,
            SpeechErrors.SERVER_DISCONNECTED to UiString.VOICE_NETWORK,
            SpeechErrors.AUDIO to UiString.VOICE_AUDIO,
            SpeechErrors.RECOGNIZER_BUSY to UiString.VOICE_BUSY,
            SpeechErrors.TOO_MANY_REQUESTS to UiString.VOICE_BUSY,
            SpeechErrors.INSUFFICIENT_PERMISSIONS to UiString.VOICE_PERMISSION_OFF,
            SpeechErrors.LANGUAGE_NOT_SUPPORTED to UiString.VOICE_LANGUAGE,
            SpeechErrors.LANGUAGE_UNAVAILABLE to UiString.VOICE_LANGUAGE,
            SpeechErrors.CLIENT to UiString.VOICE_FAILED,
            99 to UiString.VOICE_FAILED,
        )
        for ((code, text) in expected) {
            val outcome = SpeechErrors.describe(code)
            assertEquals(text, outcome.text, "code $code")
            assertTrue(outcome.isError, "code $code")
            assertFalse(Regex("\\d").containsMatchIn(outcome.text.en), "code $code: ${outcome.text.en}")
        }
        assertEquals(SpeechErrors.Outcome(UiString.VOICE_UNAVAILABLE, isError = true), SpeechErrors.describe(null))
    }
}
