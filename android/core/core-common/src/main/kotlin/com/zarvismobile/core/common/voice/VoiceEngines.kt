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
 */
interface TextToSpeechEngine {
    suspend fun speak(text: String, locale: String, onPlaybackStarted: () -> Unit = {})
    fun stop()
}
