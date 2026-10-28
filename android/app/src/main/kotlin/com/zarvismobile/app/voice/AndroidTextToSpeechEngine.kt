package com.zarvismobile.app.voice

import android.content.Context
import android.media.MediaDataSource
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.zarvismobile.core.common.voice.TextToSpeechEngine
import com.zarvismobile.data.local.prefs.AppPreferences
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.TtsSynthesizeRequest
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * The ZARVIS voice via the backend (POST /api/v1/tts/synthesize, which returns a playable WAV).
 * If synthesis or playback fails the caller keeps the reply on screen as text — there is no
 * silent switch to a different voice engine.
 */
class AndroidTextToSpeechEngine(
    context: Context,
    private val api: ZarvisApi,
    private val preferences: AppPreferences,
) : TextToSpeechEngine {
    private val appContext = context.applicationContext
    @Volatile private var active: Playback? = null

    override suspend fun speak(text: String, locale: String, onPlaybackStarted: () -> Unit) {
        if (text.isBlank()) return
        try {
            playGemini(text, preferences.ttsVoice.first(), onPlaybackStarted)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (cloudFailure: Exception) {
            // The server voice remains primary. Use Android's installed TTS only if cloud audio fails.
            try {
                playOnDevice(text, locale, onPlaybackStarted)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (deviceFailure: Exception) {
                throw IOException("Cloud voice and on-device speech both failed", deviceFailure).also {
                    it.addSuppressed(cloudFailure)
                }
            }
        }
    }

    private suspend fun playGemini(text: String, voice: String, onPlaybackStarted: () -> Unit) {
        val response = api.synthesizeSpeech(TtsSynthesizeRequest(text, voice))
        if (!response.isSuccessful) {
            response.errorBody()?.close()
            throw IOException("Voice service HTTP " + response.code())
        }
        // synthesizeSpeech is @Streaming: bytes() reads from the socket. The caller runs on the
        // main thread (viewModelScope), where that throws NetworkOnMainThreadException.
        val bytes = withContext(Dispatchers.IO) { response.body()?.use { it.bytes() } }
            ?: throw IOException("Voice service returned empty audio")
        playWav(bytes, onPlaybackStarted)
    }

    private suspend fun playWav(bytes: ByteArray, onPlaybackStarted: () -> Unit) = suspendCancellableCoroutine<Unit> { continuation ->
        val player = MediaPlayer()
        val playback = Playback(player, continuation)
        // One voice at a time: a reply still playing (from another screen) ends here, and its speak() returns.
        active?.let { finish(it) }
        active = playback
        continuation.invokeOnCancellation { finish(playback) }
        try {
            player.setDataSource(ByteArrayMediaDataSource(bytes))
            player.setOnCompletionListener { finish(playback) }
            player.setOnErrorListener { _, what, extra ->
                finish(playback, IOException("Audio playback failed (what=$what, extra=$extra)"))
                true
            }
            player.setOnPreparedListener { prepared ->
                try {
                    prepared.start()
                    onPlaybackStarted()
                } catch (e: Exception) {
                    finish(playback, e)
                }
            }
            player.prepareAsync()
        } catch (e: Exception) {
            finish(playback, e)
        }
    }

    /** On-device fallback, using the app's selected language when the cloud voice is unavailable. */
    private suspend fun playOnDevice(text: String, locale: String, onPlaybackStarted: () -> Unit) =
        suspendCancellableCoroutine<Unit> { continuation ->
            var engine: TextToSpeech? = null
            val completed = AtomicBoolean(false)
            val released = AtomicBoolean(false)

            fun releaseEngine() {
                if (!released.compareAndSet(false, true)) return
                engine?.let { tts ->
                    runCatching { tts.stop() }
                    runCatching { tts.shutdown() }
                }
                engine = null
            }

            fun complete(error: Throwable? = null) {
                if (!completed.compareAndSet(false, true)) return
                if (continuation.isActive) {
                    continuation.resumeWith(if (error == null) Result.success(Unit) else Result.failure(error))
                }
                releaseEngine()
            }

            continuation.invokeOnCancellation { releaseEngine() }
            engine = TextToSpeech(appContext, TextToSpeech.OnInitListener { status ->
                if (!continuation.isActive || completed.get()) {
                    releaseEngine()
                    return@OnInitListener
                }
                if (status != TextToSpeech.SUCCESS) {
                    complete(IOException("On-device speech engine failed to initialize"))
                    return@OnInitListener
                }

                val tts = engine
                if (tts == null) {
                    complete(IOException("On-device speech engine is unavailable"))
                    return@OnInitListener
                }
                val requestedLocale = Locale.forLanguageTag(locale.ifBlank { "en-US" })
                val languageStatus = tts.setLanguage(requestedLocale)
                if (languageStatus < TextToSpeech.LANG_AVAILABLE) {
                    complete(IOException("On-device speech does not support " + requestedLocale.toLanguageTag()))
                    return@OnInitListener
                }

                tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) { onPlaybackStarted() }
                    override fun onDone(utteranceId: String?) { complete() }
                    override fun onError(utteranceId: String?) {
                        complete(IOException("On-device speech playback failed"))
                    }
                    override fun onError(utteranceId: String?, errorCode: Int) {
                        complete(IOException("On-device speech playback failed (code=$errorCode)"))
                    }
                })
                val result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "zarvis-" + UUID.randomUUID())
                if (result == TextToSpeech.ERROR) complete(IOException("On-device speech could not start"))
            })
        }

    private fun finish(playback: Playback, error: Throwable? = null) {
        if (active === playback) active = null
        playback.end(error)
    }

    /**
     * Stops what is playing. The speak() waiting on it returns too: the engine is shared by every screen, and a stop from one of them
     * (a new turn, the microphone, the Assist overlay) used to leave the other screen's turn waiting forever, stuck on "Speaking".
     */
    override fun stop() {
        active?.let { finish(it) }
    }
}

/** One reply being played: its player and the speak() call waiting for it to end. Ended once, whichever way it ends. */
private class Playback(private val player: MediaPlayer, private val done: CancellableContinuation<Unit>) {
    private var ended = false

    fun end(error: Throwable?) {
        synchronized(this) {
            if (ended) return
            ended = true
        }
        runCatching { player.stop() }
        runCatching { player.release() }
        if (done.isActive) done.resumeWith(if (error == null) Result.success(Unit) else Result.failure(error))
    }
}

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
