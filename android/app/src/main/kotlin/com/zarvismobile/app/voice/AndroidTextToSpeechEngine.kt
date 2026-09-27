package com.zarvismobile.app.voice

import android.content.Context
import android.media.MediaDataSource
import android.media.MediaPlayer
import com.zarvismobile.core.common.voice.TextToSpeechEngine
import com.zarvismobile.data.local.prefs.AppPreferences
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.TtsSynthesizeRequest
import kotlinx.coroutines.flow.first
import java.io.IOException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** Gemini is the only voice provider for Zarvis. There is no Android TTS fallback. */
class AndroidTextToSpeechEngine(
    context: Context,
    private val api: ZarvisApi,
    private val preferences: AppPreferences,
) : TextToSpeechEngine {
    private var activePlayer: MediaPlayer? = null

    override suspend fun speak(text: String, locale: String) {
        if (text.isBlank()) return
        playGemini(text, preferences.ttsVoice.first())
    }

    private suspend fun playGemini(text: String, voice: String) {
        val response = api.synthesizeSpeech(TtsSynthesizeRequest(text, voice))
        if (!response.isSuccessful) {
            response.errorBody()?.close()
            throw IOException("Gemini TTS HTTP " + response.code())
        }
        val bytes = response.body()?.use { it.bytes() }
            ?: throw IOException("Gemini TTS returned empty audio")
        playWav(bytes)
    }

    private suspend fun playWav(bytes: ByteArray) = suspendCancellableCoroutine<Unit> { continuation ->
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
