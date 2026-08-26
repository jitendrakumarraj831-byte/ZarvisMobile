package com.jarvismobile.app.voice

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.jarvismobile.core.common.voice.TextToSpeechEngine
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/** MVP `TextToSpeechEngine` — wraps Android's on-device `TextToSpeech`. See MASTER_SPEC.md §11. */
class AndroidTextToSpeechEngine(context: Context) : TextToSpeechEngine {
    @Volatile private var isReady = false

    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        isReady = status == TextToSpeech.SUCCESS
    }

    override suspend fun speak(text: String, locale: String) {
        if (!isReady || text.isBlank()) return
        tts.language = Locale.forLanguageTag(locale)

        val utteranceId = UUID.randomUUID().toString()
        suspendCancellableCoroutine { continuation ->
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) = Unit

                override fun onDone(utteranceId: String?) {
                    if (continuation.isActive) continuation.resume(Unit)
                }

                @Deprecated("Deprecated in the platform API; still the only signature available pre-API 21")
                override fun onError(utteranceId: String?) {
                    if (continuation.isActive) continuation.resume(Unit)
                }
            })
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
            continuation.invokeOnCancellation { tts.stop() }
        }
    }

    override fun stop() {
        tts.stop()
    }
}
