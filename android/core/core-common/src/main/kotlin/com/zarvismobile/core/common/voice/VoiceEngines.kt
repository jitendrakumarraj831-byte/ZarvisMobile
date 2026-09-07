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
 * Platform seam for text-to-speech — wraps Android's `TextToSpeech` in the MVP. See
 * MASTER_SPEC.md §11 and §31.
 */
interface TextToSpeechEngine {
    suspend fun speak(text: String, locale: String)
    fun stop()
}
