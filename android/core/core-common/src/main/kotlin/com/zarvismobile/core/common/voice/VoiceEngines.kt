package com.zarvismobile.core.common.voice

import kotlinx.coroutines.flow.Flow

/**
 * Platform seam for speech-to-text — see MASTER_SPEC.md §11 and §31 "Voice engines".
 * The MVP implementation wraps Android's `SpeechRecognizer`; this interface is what lets a
 * cloud STT provider be swapped in later with no change to feature-conversation.
 */
interface SpeechToTextEngine {
    /** Emits partial transcripts as they arrive, and a final transcript when recognition ends. */
    fun listen(locale: String): Flow<TranscriptUpdate>

    fun stop()
}

data class TranscriptUpdate(val text: String, val isFinal: Boolean)

/**
 * Listening ended without a transcript. [code] is Android's `SpeechRecognizer.ERROR_*` code; `null` when this phone has no speech
 * recognition service at all. The chat turns it into words (domain `SpeechErrors`); the code itself is never shown.
 */
class SpeechRecognitionFailure(val code: Int?) :
    Exception(if (code == null) "Speech recognition is not available on this device" else "Speech recognition stopped with Android error $code")

/**
 * Platform seam for text-to-speech. [speak] suspends until playback finishes (or throws), and
 * calls [onPlaybackStarted] only once audio is actually playing — so the UI can show
 * "Speaking" truthfully instead of while the audio is still being synthesized.
 *
 * [onPhoneOnly]: the text is the user's private data (the screen, notifications, a location…) and must not leave the phone, so only
 * the phone's own voice may read it, never the server's. [locale] is a BCP 47 tag the phone's own voice reads in.
 *
 * One voice at a time: a newer [speak] or a [stop] ends what is playing (that [speak] then returns), and a request still waiting for
 * its audio never starts playing afterwards.
 */
interface TextToSpeechEngine {
    suspend fun speak(text: String, locale: String, onPhoneOnly: Boolean = false, onPlaybackStarted: () -> Unit = {})
    fun stop()
}
