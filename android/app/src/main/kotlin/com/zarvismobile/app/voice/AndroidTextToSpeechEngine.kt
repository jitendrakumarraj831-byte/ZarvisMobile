package com.zarvismobile.app.voice

import android.content.Context
import android.media.MediaDataSource
import android.media.MediaPlayer
import com.zarvismobile.core.common.voice.TextToSpeechEngine
import com.zarvismobile.data.local.prefs.AppPreferences
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.TtsSynthesizeRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.io.IOException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Gemini voice via the backend (POST /api/v1/tts/synthesize, which returns a playable WAV).
 * If synthesis or playback fails the caller keeps the reply on screen as text — there is no
 * silent switch to a different voice engine.
 */
class AndroidTextToSpeechEngine(
    context: Context,
    private val api: ZarvisApi,
    private val preferences: AppPreferences,
) : TextToSpeechEngine {
    private var activePlayer: MediaPlayer? = null

    override suspend fun speak(text: String, locale: String, onPlaybackStarted: () -> Unit) {
        if (text.isBlank()) return
        playGemini(text, preferences.ttsVoice.first(), onPlaybackStarted)
    }

    private suspend fun playGemini(text: String, voice: String, onPlaybackStarted: () -> Unit) {
        val response = api.synthesizeSpeech(TtsSynthesizeRequest(text, voice))
        if (!response.isSuccessful) {
            response.errorBody()?.close()
            throw IOException("Gemini TTS HTTP " + response.code())
        }
        // synthesizeSpeech is @Streaming: bytes() reads from the socket. The caller runs on the
        // main thread (viewModelScope), where that throws NetworkOnMainThreadException.
        val bytes = withContext(Dispatchers.IO) { response.body()?.use { it.bytes() } }
            ?: throw IOException("Gemini TTS returned empty audio")
        playWav(bytes, onPlaybackStarted)
    }

    private suspend fun playWav(bytes: ByteArray, onPlaybackStarted: () -> Unit) = suspendCancellableCoroutine<Unit> { continuation ->
        try {
            val player = MediaPlayer()
            activePlayer = player
            player.setDataSource(ByteArrayMediaDataSource(bytes))
            player.setOnCompletionListener {
                activePlayer = null
                it.release()
                if (continuation.isActive) continuation.resume(Unit)
            }
            player.setOnErrorListener { mp, _, _ ->
                activePlayer = null
                mp.release()
                if (continuation.isActive) continuation.resumeWith(Result.failure(IOException("Gemini audio playback failed")))
                true
            }
            player.prepare()
            player.start()
            onPlaybackStarted()
            continuation.invokeOnCancellation {
                activePlayer = null
                runCatching { player.stop() }
                player.release()
            }
        } catch (e: IOException) {
            activePlayer = null
            if (continuation.isActive) continuation.resumeWith(Result.failure(e))
        }
    }

    override fun stop() {
        activePlayer?.let { player ->
            activePlayer = null
            runCatching { player.stop() }
            player.release()
        }
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
