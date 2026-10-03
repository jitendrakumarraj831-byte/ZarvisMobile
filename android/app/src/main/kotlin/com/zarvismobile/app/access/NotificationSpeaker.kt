package com.zarvismobile.app.access

import android.app.KeyguardManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import com.zarvismobile.domain.notification.NotificationPrivacy
import com.zarvismobile.domain.notification.NotificationSnapshot
import com.zarvismobile.domain.notification.SpeakContext
import com.zarvismobile.domain.notification.SpeakDecision
import com.zarvismobile.domain.skill.NotificationSettingsPort
import java.time.LocalTime
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/** What happened to one notification (for the Settings preview and on-device verification). */
sealed interface SpeakOutcome {
    data class Spoken(val chars: Int) : SpeakOutcome
    data class Skipped(val reason: String) : SpeakOutcome
    data class Failed(val reason: String) : SpeakOutcome
}

/**
 * Spoken notifications (capability notification_speak). Every notification is checked against
 * the user's *current* §12 settings at the moment it arrives — off by default, quiet hours,
 * headphones-only, lock screen, exclusions, never security/banking alerts by default — and is
 * spoken with the phone's own TextToSpeech engine, so notification content never leaves the
 * device. Logs record decisions and lengths only, never content.
 */
class NotificationSpeaker(
    private val context: Context,
    private val settings: NotificationSettingsPort,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutex = Mutex()
    private val recentKeys = LinkedHashMap<String, Long>()
    private var tts: TextToSpeech? = null
    private var ttsReady: CompletableDeferred<Boolean>? = null
    private val _lastOutcome = MutableStateFlow<SpeakOutcome?>(null)

    /** What happened to the most recent notification (decision only, never its content). */
    val lastOutcome: StateFlow<SpeakOutcome?> = _lastOutcome.asStateFlow()

    private val _recent = MutableStateFlow<List<Pair<String, SpeakOutcome>>>(emptyList())

    /** Decisions for the last few notifications by Android notification key (never content). */
    val recentOutcomes: StateFlow<List<Pair<String, SpeakOutcome>>> = _recent.asStateFlow()

    fun onNotificationPosted(snapshot: NotificationSnapshot) {
        scope.launch { handle(snapshot) }
    }

    suspend fun handle(snapshot: NotificationSnapshot): SpeakOutcome = mutex.withLock {
        val now = System.currentTimeMillis()
        recentKeys.entries.removeAll { now - it.value > DEDUPE_WINDOW_MS }
        if (recentKeys.containsKey(snapshot.key)) return@withLock SpeakOutcome.Skipped("update of a notification already handled").also { record(snapshot.key, it) }
        val decision = NotificationPrivacy.speakDecision(snapshot, settings.current(), currentContext())
        val outcome = when (decision) {
            is SpeakDecision.Skip -> SpeakOutcome.Skipped(decision.reason)
            is SpeakDecision.Speak -> {
                recentKeys[snapshot.key] = now
                speak(decision.text)
            }
        }
        record(snapshot.key, outcome)
        outcome
    }

    private fun record(key: String, outcome: SpeakOutcome) {
        _recent.value = (_recent.value + (key to outcome)).takeLast(RECENT_LIMIT)
        log(outcome)
    }

    /** Speaks a fixed sample so the user can hear how spoken notifications sound (Settings). */
    suspend fun speakSample(): SpeakOutcome = mutex.withLock { speak("Message from ZARVIS. This is how spoken notifications will sound.").also(::log) }

    fun currentContext(): SpeakContext {
        val time = LocalTime.now()
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        return SpeakContext(
            minuteOfDay = time.hour * 60 + time.minute,
            deviceLocked = keyguard.isKeyguardLocked,
            headphonesConnected = headphonesConnected(),
        )
    }

    private fun headphonesConnected(): Boolean {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val types = buildSet {
            add(AudioDeviceInfo.TYPE_WIRED_HEADSET)
            add(AudioDeviceInfo.TYPE_WIRED_HEADPHONES)
            add(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP)
            add(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
            add(AudioDeviceInfo.TYPE_USB_HEADSET)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) add(AudioDeviceInfo.TYPE_BLE_HEADSET)
        }
        return audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.type in types }
    }

    /** The phone's TTS engine, or why it can't be used (no engine installed vs. it didn't start). */
    private suspend fun engine(): Result<TextToSpeech> {
        tts?.let { existing -> if (ttsReady?.await() == true) return Result.success(existing) }
        tts?.shutdown()
        val ready = CompletableDeferred<Boolean>()
        ttsReady = ready
        val created = TextToSpeech(context) { status -> ready.complete(status == TextToSpeech.SUCCESS) }
        tts = created
        // A cold engine (first use after boot or install) can take several seconds to bind.
        if (withTimeoutOrNull(ENGINE_START_TIMEOUT_MS) { ready.await() } == true) return Result.success(created)
        val installed = created.engines.isNotEmpty()
        created.shutdown()
        tts = null
        ttsReady = null
        return Result.failure(IllegalStateException(if (installed) ENGINE_DID_NOT_START else NO_ENGINE))
    }

    /** Returns only once Android reports the utterance actually started (or failed). */
    private suspend fun speak(text: String): SpeakOutcome {
        val engine = engine().getOrElse { return SpeakOutcome.Failed(it.message ?: NO_ENGINE) }
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attributes).build()
        audio.requestAudioFocus(focus)
        val started = CompletableDeferred<Boolean>()
        val id = UUID.randomUUID().toString()
        engine.setAudioAttributes(attributes)
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                if (utteranceId == id) started.complete(true)
            }

            override fun onDone(utteranceId: String?) {
                if (utteranceId == id) audio.abandonAudioFocusRequest(focus)
            }

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                if (utteranceId == id) {
                    started.complete(false)
                    audio.abandonAudioFocusRequest(focus)
                }
            }
        })
        if (engine.speak(text, TextToSpeech.QUEUE_ADD, null, id) != TextToSpeech.SUCCESS) {
            audio.abandonAudioFocusRequest(focus)
            return SpeakOutcome.Failed("text-to-speech rejected the request")
        }
        return when (withTimeoutOrNull(10_000) { started.await() }) {
            true -> SpeakOutcome.Spoken(text.length)
            false -> SpeakOutcome.Failed("text-to-speech reported an error")
            null -> SpeakOutcome.Failed("text-to-speech did not start")
        }
    }

    private fun log(outcome: SpeakOutcome) {
        _lastOutcome.value = outcome
        Log.i(TAG, "ZARVIS_EVIDENCE notification_speak $outcome")
    }

    private companion object {
        const val TAG = "ZarvisNotifications"
        const val DEDUPE_WINDOW_MS = 60_000L
        const val RECENT_LIMIT = 20
        const val ENGINE_START_TIMEOUT_MS = 20_000L
        const val NO_ENGINE = "no text-to-speech engine available"
        const val ENGINE_DID_NOT_START = "the text-to-speech engine did not start"
    }
}
