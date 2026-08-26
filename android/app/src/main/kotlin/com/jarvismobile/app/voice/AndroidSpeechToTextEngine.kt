package com.jarvismobile.app.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.jarvismobile.core.common.voice.SpeechToTextEngine
import com.jarvismobile.core.common.voice.TranscriptUpdate
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/** MVP `SpeechToTextEngine` — wraps Android's on-device `SpeechRecognizer`. See MASTER_SPEC.md §11. */
class AndroidSpeechToTextEngine(private val context: Context) : SpeechToTextEngine {
    private var activeRecognizer: SpeechRecognizer? = null

    override fun listen(locale: String): Flow<TranscriptUpdate> = callbackFlow {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            close(IllegalStateException("Speech recognition is not available on this device"))
            return@callbackFlow
        }

        val recognizer = SpeechRecognizer.createSpeechRecognizer(context)
        activeRecognizer = recognizer

        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit

            override fun onError(error: Int) {
                close(IllegalStateException("Speech recognition error (code $error)"))
            }

            override fun onResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!text.isNullOrBlank()) trySend(TranscriptUpdate(text = text, isFinal = true))
                close()
            }

            override fun onPartialResults(partialResults: Bundle?) {
                val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!text.isNullOrBlank()) trySend(TranscriptUpdate(text = text, isFinal = false))
            }
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        }
        recognizer.startListening(intent)

        awaitClose {
            recognizer.stopListening()
            recognizer.destroy()
            activeRecognizer = null
        }
    }

    override fun stop() {
        activeRecognizer?.stopListening()
    }
}
