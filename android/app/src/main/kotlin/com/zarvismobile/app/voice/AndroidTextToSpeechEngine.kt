package com.zarvismobile.app.voice

import android.content.Context
import android.media.MediaDataSource
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.zarvismobile.core.common.voice.TextToSpeechEngine
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.TtsSynthesizeRequest
import java.io.IOException
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Tries Gemini's native audio voice first (`POST /api/v1/tts/synthesize` — the same voice
 * technology behind the Gemini app's voice mode, AI_ARCHITECTURE.md "Native audio voice"),
 * falling back to Android's on-device `TextToSpeech` if that call fails for any reason (no
 * `GEMINI_API_KEY` configured server-side, offline, timeout, ...) — never a silent dead end,
 * per Product Principle #4. This is the Android side of the same fallback web/app.js's
 * `speak()` already implements (MASTER_SPEC.md §11: "wiring the Android TextToSpeechEngine
 * to the same backend endpoint... is a natural follow-up, not implemented here yet" — now
 * done, mirroring the already-proven web logic rather than inventing a new approach).
 */
class AndroidTextToSpeechEngine(
    context: Context,
    private val api: ZarvisApi,
) : TextToSpeechEngine {
    @Volatile private var isReady = false
    private var activePlayer: MediaPlayer? = null

    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        isReady = status == TextToSpeech.SUCCESS
    }

    override suspend fun speak(text: String, locale: String) {
        if (text.isBlank()) return
        val playedLive = runCatching { speakWithBackendVoice(text) }.getOrDefault(false)
        if (!playedLive) speakOnDevice(text, locale)
    }

    /** @return true if the backend's audio actually played to completion; false to fall back. */
    private suspend fun speakWithBackendVoice(text: String): Boolean {
        val response = api.synthesizeSpeech(TtsSynthesizeRequest(text))
        val body = response.body() ?: return false
        if (!response.isSuccessful) {
            body.close()
            return false
        }
        val bytes = body.use { it.bytes() }
        return playWav(bytes)
    }

    private suspend fun playWav(bytes: ByteArray): Boolean = suspendCancellableCoroutine { continuation ->
        try {
            val player = MediaPlayer()
            activePlayer = player
            player.setDataSource(ByteArrayMediaDataSource(bytes))
            player.setOnCompletionListener {
                activePlayer = null
                it.release()
                if (continuation.isActive) continuation.resume(true)
            }
            player.setOnErrorListener { mp, _, _ ->
                activePlayer = null
                mp.release()
                if (continuation.isActive) continuation.resume(false)
                true
            }
            player.prepare()
            player.start()
            continuation.invokeOnCancellation {
                activePlayer = null
                runCatching { player.stop() }
                player.release()
            }
        } catch (e: IOException) {
            activePlayer = null
            if (continuation.isActive) continuation.resume(false)
        }
    }

    private suspend fun speakOnDevice(text: String, locale: String) {
        if (!isReady) return
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
        activePlayer?.let { player ->
            activePlayer = null
            runCatching { player.stop() }
            player.release()
        }
    }
}

/** Plays an in-memory WAV without writing a temp file — the response is already fully buffered. */
private class ByteArrayMediaDataSource(private val bytes: ByteArray) : MediaDataSource() {
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (position >= bytes.size) return -1
        val length = minOf(size, (bytes.size - position).toInt())
        System.arraycopy(bytes, position.toInt(), buffer, offset, length)
        return length
    }

    override fun getSize(): Long = bytes.size.toLong()

    override fun close() = Unit
}
