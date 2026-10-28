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
import com.zarvismobile.domain.presentation.SpeakableText
import java.io.IOException
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.updateAndGet
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withTimeoutOrNull

/**
 * How long the server may take to make a reply's audio before the phone's own voice reads it instead. The shared HTTP client allows
 * minutes (a whole AI turn); a voice that has not answered by now is not going to be worth waiting for.
 */
private const val CLOUD_AUDIO_TIMEOUT_MS = 25_000L

/** A WAV header and nothing after it: no audio to play. */
private const val WAV_HEADER_BYTES = 44

/**
 * The ZARVIS voice via the backend (POST /api/v1/tts/synthesize, which returns a playable WAV).
 * Cloud audio is primary. If it fails before producing sound (an HTTP error, no audio, audio the phone cannot play, or no answer
 * within [CLOUD_AUDIO_TIMEOUT_MS]), the phone's installed Android TTS reads the reply instead, in the reply's language; if both fail,
 * the caller keeps the reply on screen as text. Text that must stay on the phone is read by the phone's voice only.
 *
 * One voice at a time, across every screen: a newer speak() or a stop() ends what is playing, and a request still waiting for its
 * audio then never starts playing (its download is cancelled, which also stops the synthesis on the server).
 */
class AndroidTextToSpeechEngine(
    context: Context,
    private val api: ZarvisApi,
    private val preferences: AppPreferences,
) : TextToSpeechEngine {
    private val appContext = context.applicationContext
    @Volatile private var active: Playback? = null
    @Volatile private var activeDevice: DeviceSpeech? = null

    /** Moves on with every speak() and stop(): a request whose number is no longer the latest was stopped or replaced. */
    private val generation = MutableStateFlow(0L)

    private fun isCurrent(ticket: Long) = generation.value == ticket

    override suspend fun speak(text: String, locale: String, onPhoneOnly: Boolean, onPlaybackStarted: () -> Unit) {
        if (text.isBlank()) return
        val ticket = generation.updateAndGet { it + 1 }
        // One voice at a time: what is playing now (another screen's reply, or an earlier one) ends here, and its speak() returns.
        endPlayback()
        if (onPhoneOnly) {
            playOnDevice(text, locale, ticket, onPlaybackStarted)
            return
        }
        val cloudPlaybackStarted = AtomicBoolean(false)
        try {
            // Null: stopped or replaced while the server was still making the audio. Nothing is said.
            val audio = fetchCloudAudio(text, preferences.ttsVoice.first(), ticket) ?: return
            playWav(audio, ticket) {
                cloudPlaybackStarted.set(true)
                onPlaybackStarted()
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (cloudFailure: Exception) {
            // Part of the reply was already heard in the server's voice: reading it again from the start would repeat it.
            if (cloudPlaybackStarted.get()) throw cloudFailure
            // Stopped or replaced meanwhile: the phone's voice must not start instead.
            if (!isCurrent(ticket)) return
            try {
                playOnDevice(text, locale, ticket, onPlaybackStarted)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (deviceFailure: Exception) {
                throw IOException("Cloud voice and on-device speech both failed", deviceFailure).also {
                    it.addSuppressed(cloudFailure)
                }
            }
        }
    }

    /**
     * The server voice's audio, or null when a stop() or a newer speak() came first: the request is then cancelled. Throws when the
     * voice service fails, answers with no audio, or takes longer than [CLOUD_AUDIO_TIMEOUT_MS].
     */
    private suspend fun fetchCloudAudio(text: String, voice: String, ticket: Long): ByteArray? = supervisorScope {
        val download = async {
            withTimeoutOrNull(CLOUD_AUDIO_TIMEOUT_MS) { downloadAudio(text, voice) }
                ?: throw IOException("Voice service did not answer within ${CLOUD_AUDIO_TIMEOUT_MS / 1000} s")
        }
        val replaced = launch {
            generation.first { it != ticket }
            download.cancel()
        }
        try {
            download.await()
        } catch (stopped: CancellationException) {
            ensureActive() // the caller itself was cancelled: that cancellation goes on
            if (isCurrent(ticket)) throw stopped
            null
        } finally {
            replaced.cancel()
        }
    }

    private suspend fun downloadAudio(text: String, voice: String): ByteArray {
        val response = api.synthesizeSpeech(TtsSynthesizeRequest(text, voice))
        if (!response.isSuccessful) {
            response.errorBody()?.close()
            throw IOException("Voice service HTTP " + response.code())
        }
        // Already read in full on OkHttp's thread (synthesizeSpeech is not @Streaming): this touches no socket.
        val bytes = response.body()?.use { it.bytes() } ?: throw IOException("Voice service returned no audio")
        if (bytes.size <= WAV_HEADER_BYTES) throw IOException("Voice service returned no audio (" + bytes.size + " bytes)")
        return bytes
    }

    private suspend fun playWav(bytes: ByteArray, ticket: Long, onPlaybackStarted: () -> Unit) = suspendCancellableCoroutine<Unit> { continuation ->
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
                // Stopped or replaced while the audio was being prepared: it is not started.
                if (!continuation.isActive || active !== playback || !isCurrent(ticket)) {
                    finish(playback)
                    return@setOnPreparedListener
                }
                try {
                    prepared.start()
                    if (continuation.isActive) onPlaybackStarted()
                } catch (e: Exception) {
                    finish(playback, e)
                }
            }
            player.prepareAsync()
        } catch (e: Exception) {
            finish(playback, e)
        }
    }

    /**
     * The phone's own voice, in [locale]: the fallback when the server's voice cannot speak, and the only voice for text that must stay
     * on the phone. It reads the reply's words without the Markdown (as the server's voice does), in pieces its engine accepts. The
     * engine is made for this reply and shut down after it, however it ends.
     */
    private suspend fun playOnDevice(text: String, locale: String, ticket: Long, onPlaybackStarted: () -> Unit) {
        val pieces = SpeakableText.pieces(SpeakableText.of(text), TextToSpeech.getMaxSpeechInputLength())
        if (pieces.isEmpty()) throw IOException("Nothing in the reply can be read aloud")
        suspendCancellableCoroutine<Unit> { continuation ->
            val speech = DeviceSpeech(continuation)
            activeDevice?.let { endDevice(it) }
            activeDevice = speech
            continuation.invokeOnCancellation { endDevice(speech) }
            // The engine starts asynchronously (on the main thread), or reports at once, inside this constructor, that it cannot.
            val engine = TextToSpeech(appContext, TextToSpeech.OnInitListener { status ->
                val tts = speech.engine
                when {
                    speech.isEnded -> Unit
                    // Stopped or replaced while the phone's engine was starting: nothing is said.
                    !isCurrent(ticket) -> endDevice(speech)
                    status != TextToSpeech.SUCCESS || tts == null -> endDevice(speech, IOException("The phone's voice did not start"))
                    else -> startDeviceSpeech(tts, speech, pieces, locale, onPlaybackStarted)
                }
            })
            speech.attach(engine)
        }
    }

    private fun startDeviceSpeech(
        tts: TextToSpeech,
        speech: DeviceSpeech,
        pieces: List<String>,
        locale: String,
        onPlaybackStarted: () -> Unit,
    ) {
        try {
            val requested = Locale.forLanguageTag(locale.ifBlank { "en-US" })
            // Missing voice data or no such language: an English voice would garble a Hindi reply, so it is not read at all.
            if (tts.setLanguage(requested) < TextToSpeech.LANG_AVAILABLE) {
                endDevice(speech, IOException("The phone's voice cannot speak " + requested.toLanguageTag()))
                return
            }
            val ids = pieces.indices.map { "zarvis-" + UUID.randomUUID() + "-" + it }
            val started = AtomicBoolean(false)
            // Called on a binder thread.
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    if (!speech.isEnded && started.compareAndSet(false, true)) onPlaybackStarted()
                }
                override fun onDone(utteranceId: String?) {
                    if (utteranceId == ids.last()) endDevice(speech)
                }
                override fun onStop(utteranceId: String?, interrupted: Boolean) { endDevice(speech) }
                override fun onError(utteranceId: String?) {
                    endDevice(speech, IOException("The phone's voice could not read the reply"))
                }
                override fun onError(utteranceId: String?, errorCode: Int) {
                    endDevice(speech, IOException("The phone's voice could not read the reply (error $errorCode)"))
                }
            })
            pieces.forEachIndexed { index, piece ->
                val queue = if (index == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
                if (tts.speak(piece, queue, null, ids[index]) != TextToSpeech.SUCCESS) {
                    endDevice(speech, IOException("The phone's voice refused the reply"))
                    return
                }
            }
        } catch (e: Exception) {
            endDevice(speech, e)
        }
    }

    private fun finish(playback: Playback, error: Throwable? = null) {
        if (active === playback) active = null
        playback.end(error)
    }

    private fun endDevice(speech: DeviceSpeech, error: Throwable? = null) {
        if (activeDevice === speech) activeDevice = null
        speech.end(error)
    }

    /** Ends what is playing, in either voice; the speak() waiting on it returns. */
    private fun endPlayback() {
        active?.let { finish(it) }
        activeDevice?.let { endDevice(it) }
    }

    /**
     * Stops what is playing, and a request still waiting for its audio. The speak() waiting on it returns too: the engine is shared by
     * every screen, and a stop from one of them (a new turn, the microphone, the Assist overlay) used to leave the other screen's turn
     * waiting forever, stuck on "Speaking", or let its audio start once it arrived.
     */
    override fun stop() {
        generation.update { it + 1 }
        endPlayback()
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

/**
 * One reply read by the phone's own voice: its engine (made for it, shut down after it) and the speak() call waiting for it. Ended
 * once, whichever way it ends: done, stopped, failed, or cancelled.
 */
private class DeviceSpeech(private val done: CancellableContinuation<Unit>) {
    private val ended = AtomicBoolean(false)

    @Volatile var engine: TextToSpeech? = null
        private set

    val isEnded: Boolean get() = ended.get()

    /** An engine that arrives after this speech already ended (it could not start, or it was stopped meanwhile) is shut down at once. */
    fun attach(tts: TextToSpeech) {
        engine = tts
        if (ended.get()) shutDown(tts)
    }

    fun end(error: Throwable?) {
        if (!ended.compareAndSet(false, true)) return
        engine?.let(::shutDown)
        if (done.isActive) done.resumeWith(if (error == null) Result.success(Unit) else Result.failure(error))
    }

    private fun shutDown(tts: TextToSpeech) {
        runCatching { tts.stop() }
        runCatching { tts.shutdown() }
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
