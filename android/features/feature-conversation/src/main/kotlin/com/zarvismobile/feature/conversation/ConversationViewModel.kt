package com.zarvismobile.feature.conversation

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.agents.AndroidOrchestrator
import com.zarvismobile.agents.ConversationDeletion
import com.zarvismobile.agents.PRIVATE_RESULT_SKILLS
import com.zarvismobile.agents.TurnFailedException
import com.zarvismobile.agents.TurnProgress
import com.zarvismobile.core.common.metrics.TurnMetricsStore
import com.zarvismobile.core.common.voice.SpeechRecognitionFailure
import com.zarvismobile.core.common.voice.SpeechToTextEngine
import com.zarvismobile.core.common.voice.TextToSpeechEngine
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.data.repository.SessionExpiredException
import com.zarvismobile.data.repository.SessionRepository
import com.zarvismobile.domain.access.AccessCoordinator
import com.zarvismobile.domain.access.AccessResult
import com.zarvismobile.domain.access.PendingAction
import com.zarvismobile.domain.access.RecoveryDecision
import com.zarvismobile.domain.capability.CapabilityId
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.conversation.ConversationStamp
import com.zarvismobile.domain.entity.ToolResultStatus
import com.zarvismobile.domain.presentation.ConversationSync
import com.zarvismobile.domain.presentation.OwnReply
import com.zarvismobile.domain.presentation.Reconciled
import com.zarvismobile.domain.presentation.ServerConversation
import com.zarvismobile.domain.presentation.SpeechErrors
import com.zarvismobile.domain.presentation.TurnFailures
import com.zarvismobile.domain.presentation.TurnText
import com.zarvismobile.domain.presentation.UiString
import dagger.hilt.android.lifecycle.HiltViewModel
import java.io.IOException
import java.util.UUID
import javax.inject.Inject
import kotlin.time.measureTimedValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import retrofit2.HttpException

private const val SUCCESS_FLASH_MS = 450L
private const val SLOW_SERVER_MS = 6_000L
private const val START_REQUEST_HANDLED = "conversation.startRequestHandled"

data class ConversationTurn(
    val userText: String,
    val assistantText: String?,
    /** Structured status of the tool action behind this reply, when there was one. */
    val status: ToolResultStatus? = null,
    /** The request was stopped (a newer message, the microphone) before its reply came: the bubble says so instead of staying empty. */
    val stopped: Boolean = false,
    /**
     * The id this message was sent with (OrchestratorTurnRequest.clientTurnId). Try again sends it again, so the server answers a turn
     * it already finished from its stored result instead of running it twice. Null for an exchange restored from the server.
     */
    val clientTurnId: String? = null,
    /** The reply is a failure that sending the same message again can fix: the bubble offers Try again. */
    val retryable: Boolean = false,
)

/** What the reply on its way is waiting for, shown live in its bubble. Each is a stage the turn really reached. */
sealed interface ChatProgress {
    /** Sent; nothing back from the server yet. */
    data object Sending : ChatProgress

    /** Still nothing back after [SLOW_SERVER_MS]: the server may be starting up (a sleeping free instance takes up to a minute). */
    data object SlowServer : ChatProgress

    data object Thinking : ChatProgress

    /** A tool is running on the server; [name] is its display name when the server gave one. */
    data class Working(val name: String?) : ChatProgress

    data object OnPhone : ChatProgress
}

data class ConversationUiState(
    val voiceState: VoiceState = VoiceState.IDLE,
    /** True while a Read Aloud request is synthesizing or playing. */
    val readingReply: Boolean = false,
    /** Live progress of the turn in flight, null when none is. */
    val progress: ChatProgress? = null,
    val composerText: String = "",
    val turns: List<ConversationTurn> = emptyList(),
    val error: String? = null,
    /** A note that is not an error, e.g. the microphone heard nothing: shown quietly, and the screen stays ready. */
    val hint: String? = null,
    /** An action that was waiting on the user when the app process was killed. */
    val interrupted: PendingAction? = null,
    val notice: String? = null,
    /** True while a delete request for this chat is out; the Delete button is off meanwhile. */
    val deleting: Boolean = false,
    /** How the last delete ended, shown until dismissed. */
    val deleteOutcome: ChatDeleteOutcome? = null,
)

enum class ChatDeleteOutcome { DELETED, FAILED }

/**
 * Conversation state machine with truthful states only:
 * IDLE → LISTENING (mic open) → UNDERSTANDING (request in flight) → SUCCESS / ERROR →
 * SPEAKING (only while audio is actually playing, and only when spoken replies are on).
 */
@HiltViewModel
class ConversationViewModel @Inject constructor(
    private val orchestrator: AndroidOrchestrator,
    private val sessionRepository: SessionRepository,
    private val sttEngine: SpeechToTextEngine,
    private val ttsEngine: TextToSpeechEngine,
    private val preferences: ChatPreferences,
    private val access: AccessCoordinator,
    private val capabilities: CapabilityRegistry,
    private val savedState: SavedStateHandle,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ConversationUiState())
    val uiState: StateFlow<ConversationUiState> = _uiState.asStateFlow()

    // The in-flight turn, so tapping the orb interrupts it cleanly (network call or playback).
    private var turnJob: Job? = null
    private var replySpeechJob: Job? = null
    private var replySpeechToken: Any? = null

    // Which turn's live progress is shown; set by each new turn.
    @Volatile private var currentTurn: Any? = null

    // The microphone session, so a cancel ends it without sending what was heard so far.
    private var listenJob: Job? = null

    // Set once the first restore has finished, so the first resume does not ask the server for the same history twice.
    // (Declared before `init`: the coroutine started there may run right away, and a later initializer would reset it.)
    private var restoredOnce = false

    // The conversation the transcript on this screen belongs to. The active conversation (orchestrator.conversation) is the single source of truth;
    // whenever it is no longer this one, what this screen shows is from a conversation the device has left and is dropped.
    private var shown: ConversationStamp? = null

    init {
        viewModelScope.launch {
            shown = orchestrator.conversation.current()
            // Process-death recovery: offer, never auto-run.
            when (val decision = orchestrator.checkInterruptedAction()) {
                is RecoveryDecision.OfferResume -> _uiState.update { it.copy(interrupted = decision.action) }
                is RecoveryDecision.Expired -> _uiState.update {
                    it.copy(notice = "An earlier request (\"${decision.action.utterance}\") was interrupted before it finished. Nothing was done.")
                }
                RecoveryDecision.Nothing -> Unit
            }
            // Show only real, server-persisted history for the conversation this device continues.
            reconcileWithServer()
            restoredOnce = true
        }
        // The Chat tab and a chat opened from Home share ONE active conversation. When the device leaves it (a New chat on either screen, a
        // different account, a conversation the server no longer has), every screen watching drops what it shows, even one that was not on screen.
        viewModelScope.launch {
            orchestrator.conversation.state.filterNotNull().collect { onActiveConversation(it) }
        }
    }

    private fun onActiveConversation(active: ConversationStamp) {
        if (!ConversationSync.leftConversation(shown, active)) return
        // A turn still on its way belongs to the conversation that was left: it must not land in this one.
        turnJob?.cancel()
        replySpeechToken = null
        replySpeechJob?.cancel()
        replySpeechJob = null
        ttsEngine.stop()
        shown = active
        // The recovery card and notice are about the app being closed, not about this conversation: they stay.
        _uiState.update { it.copy(turns = emptyList(), voiceState = VoiceState.IDLE, readingReply = false, error = null) }
        // Another screen may already be talking in the new chat: show what the server holds for it.
        if (active.id != null) viewModelScope.launch { reconcileWithServer() }
    }

    private fun leftConversation(): Boolean =
        orchestrator.conversation.state.value?.let { ConversationSync.leftConversation(shown, it) } == true

    /**
     * Called whenever the screen is shown again. If the other Chat screen continued this conversation meanwhile, the exchanges the server
     * has after the ones shown here are added below them (the ones already shown, with their status chips, are left as they are). If what is
     * shown is from another conversation than the active one, it is replaced. A turn in flight is never touched; and if this screen is not
     * simply the start of the server's conversation (it holds a phone-only exchange the server never stored), nothing is changed rather than
     * showing a wrong transcript.
     */
    fun syncWithServer() {
        if (!restoredOnce || turnJob?.isActive == true) return
        viewModelScope.launch { reconcileWithServer() }
    }

    private suspend fun reconcileWithServer() {
        val restored = runCatching { orchestrator.restoreConversation() }.getOrNull() ?: return
        val active = orchestrator.conversation.current()
        val before = _uiState.value.turns
        val decision = ConversationSync.reconcile(
            shown = shown,
            shownUsers = before.map { it.userText }.filter { it.isNotEmpty() },
            shownCount = before.size,
            server = ServerConversation(restored.conversation, restored.messages.map { it.role to it.content }),
            active = active,
        )
        when (decision) {
            Reconciled.Keep -> Unit
            // Only if nothing changed while the server was answering (a New chat or a new turn in between would make this stale).
            is Reconciled.Append -> if (turnJob?.isActive != true && _uiState.value.turns.size == before.size) {
                shown = decision.stamp
                _uiState.update { it.copy(turns = it.turns + turnsOf(decision.turns)) }
            }
            is Reconciled.Replace -> if (turnJob?.isActive != true) {
                shown = decision.stamp
                _uiState.update { it.copy(turns = turnsOf(decision.turns)) }
            }
        }
    }

    fun onComposerChange(text: String) {
        _uiState.update { it.copy(composerText = text) }
    }

    fun submitComposerText() {
        val text = _uiState.value.composerText.trim()
        if (text.isBlank()) return
        _uiState.update { it.copy(composerText = "") }
        runTurn(text)
    }

    fun prefillComposer(text: String) {
        _uiState.update { it.copy(composerText = text) }
    }

    fun submitInitialText(text: String) {
        if (text.isBlank()) return
        runTurn(text)
    }

    /**
     * The screen's start request (text from Home/Assist, or "listen now") is handled once per
     * navigation entry. The composable's LaunchedEffect runs again after a rotation or after
     * the process is recreated; without this, that re-sent the same request — a duplicate
     * turn and a duplicate AI call. Stored in SavedStateHandle so it survives process death.
     */
    fun onStartRequest(initialText: String?, submit: Boolean, listen: Boolean) {
        if (savedState.get<Boolean>(START_REQUEST_HANDLED) == true) return
        savedState[START_REQUEST_HANDLED] = true
        if (listen) startListening()
        if (!initialText.isNullOrBlank()) {
            if (submit) submitInitialText(initialText) else prefillComposer(initialText)
        }
    }

    /** Re-runs the interrupted request through the full permission + confirmation flow. */
    fun resumeInterrupted() {
        val action = _uiState.value.interrupted ?: return
        _uiState.update { it.copy(interrupted = null) }
        runTurn(action.utterance)
    }

    fun dismissInterrupted() {
        _uiState.update { it.copy(interrupted = null) }
        viewModelScope.launch { orchestrator.dismissInterruptedAction() }
    }

    fun dismissNotice() {
        _uiState.update { it.copy(notice = null) }
    }

    /**
     * Deletes this chat on the server. The transcript is dropped only after the server confirmed (and then on every Chat screen, through the
     * active conversation); a failure keeps everything as it was and says so. Not offered while a reply is on its way.
     */
    fun deleteConversation() {
        if (_uiState.value.deleting || turnJob?.isActive == true) return
        _uiState.update { it.copy(deleting = true, deleteOutcome = null) }
        viewModelScope.launch {
            val deletion = runCatching { orchestrator.deleteConversation() }.getOrDefault(ConversationDeletion.FAILED)
            if (deletion == ConversationDeletion.FAILED) {
                _uiState.update { it.copy(deleting = false, deleteOutcome = ChatDeleteOutcome.FAILED) }
                return@launch
            }
            val left = orchestrator.conversation.current()
            if ((shown?.epoch ?: -1L) < left.epoch) shown = left
            _uiState.update { ConversationUiState(deleteOutcome = if (deletion == ConversationDeletion.DELETED) ChatDeleteOutcome.DELETED else null) }
        }
    }

    fun dismissDeleteOutcome() {
        _uiState.update { it.copy(deleteOutcome = null) }
    }

    fun startNewConversation() {
        turnJob?.cancel()
        listenJob?.cancel()
        // Gone from this screen at once, before anything is written; every other screen drops it when it sees the new conversation.
        _uiState.update { ConversationUiState() }
        viewModelScope.launch {
            val fresh = orchestrator.startNewConversation()
            if ((shown?.epoch ?: -1L) < fresh.epoch) shown = fresh
        }
    }

    fun startListening() {
        if (_uiState.value.voiceState == VoiceState.LISTENING) return
        stopTurnInFlight()
        replySpeechToken = null
        replySpeechJob?.cancel()
        replySpeechJob = null
        ttsEngine.stop()
        _uiState.update { if (it.readingReply) it.copy(readingReply = false) else it }
        listenJob?.cancel()
        listenJob = viewModelScope.launch {
            // Microphone goes through the same permission intelligence as every capability.
            when (val result = access.ensure(capabilities.get(CapabilityId.MICROPHONE))) {
                AccessResult.Granted -> Unit
                else -> {
                    val reason = when (result) {
                        is AccessResult.Declined -> UiString.VOICE_DECLINED
                        is AccessResult.Denied -> UiString.VOICE_PERMISSION_OFF
                        else -> UiString.VOICE_UNAVAILABLE
                    }
                    _uiState.update { it.copy(voiceState = VoiceState.IDLE, error = reason.text(appLocale())) }
                    return@launch
                }
            }
            _uiState.update { it.copy(voiceState = VoiceState.LISTENING, error = null, hint = null) }
            try {
                val locale = if (appLocale() == "hi") "hi-IN" else "en-US"
                sttEngine.listen(locale = locale).collect { update ->
                    _uiState.update { it.copy(composerText = update.text) }
                    if (update.isFinal) {
                        sttEngine.stop()
                        _uiState.update { it.copy(composerText = "") }
                        runTurn(update.text)
                    }
                }
                if (_uiState.value.voiceState == VoiceState.LISTENING) _uiState.update { it.copy(voiceState = VoiceState.IDLE) }
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                // In words, never Android's error number. Hearing nothing (the most common ending) is a hint, and the screen stays ready.
                val heard = (t as? SpeechRecognitionFailure)?.let { SpeechErrors.describe(it.code) } ?: SpeechErrors.Outcome(UiString.VOICE_FAILED, isError = true)
                val text = heard.text.text(appLocale())
                _uiState.update {
                    if (heard.isError) it.copy(voiceState = VoiceState.ERROR, error = text) else it.copy(voiceState = VoiceState.IDLE, hint = text)
                }
            }
        }
    }

    fun cancelListening() {
        // Not sttEngine.stop(): Android's stopListening() recognizes what was heard so far, and that half sentence was then sent as a
        // request. Cancelling the collection closes and destroys the recognizer, so nothing is sent.
        listenJob?.cancel()
        if (_uiState.value.voiceState == VoiceState.LISTENING) {
            _uiState.update { it.copy(voiceState = VoiceState.IDLE) }
        }
    }

    /** Read an existing assistant reply aloud without sending another AI request. */
    fun speakReply(text: String) {
        if (text.isBlank()) return
        stopSpeaking()
        val token = Any()
        replySpeechToken = token
        _uiState.update { it.copy(readingReply = true, error = null) }
        replySpeechJob = viewModelScope.launch {
            val language = runCatching { appLocale() }.getOrDefault("en")
            val locale = if (language == "hi") "hi-IN" else "en-US"
            try {
                ttsEngine.speak(text, locale = locale) {
                    _uiState.update { it.copy(voiceState = VoiceState.SPEAKING) }
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Throwable) {
                _uiState.update { it.copy(error = UiString.VOICE_PLAYBACK_FAILED.text(language)) }
            } finally {
                if (replySpeechToken === token) {
                    replySpeechToken = null
                    replySpeechJob = null
                    _uiState.update {
                        it.copy(
                            readingReply = false,
                            voiceState = if (it.voiceState == VoiceState.SPEAKING) VoiceState.IDLE else it.voiceState,
                        )
                    }
                }
            }
        }
    }

    /** Stops manual or automatic speech, including synthesis that has not produced its first audio yet. */
    fun stopSpeaking() {
        val state = _uiState.value
        val manualJob = replySpeechToken != null
        if (!state.readingReply && state.voiceState != VoiceState.SPEAKING) return
        if (manualJob) {
            replySpeechToken = null
            replySpeechJob?.cancel()
            replySpeechJob = null
        } else {
            // Automatic speech runs inside the turn coroutine. Cancelling it also cancels a pending HTTP audio request.
            turnJob?.cancel()
        }
        ttsEngine.stop()
        _uiState.update {
            it.copy(
                readingReply = false,
                voiceState = if (it.voiceState == VoiceState.SPEAKING) VoiceState.IDLE else it.voiceState,
            )
        }
    }

    /**
     * Sends the last message again under the same id, after its reply was a failure that trying again can fix. The server answers a
     * turn it already finished from its stored result, and reuses the tool runs a failed attempt already completed.
     */
    fun retry() {
        // Not while a request is on its way. A failed reply still being read aloud is simply stopped: runTurn ends it.
        if (_uiState.value.progress != null) return
        val last = _uiState.value.turns.lastOrNull() ?: return
        val id = last.clientTurnId ?: return
        if (!last.retryable) return
        runTurn(last.userText, retryOf = id)
    }

    /** [retryOf] is the id of the failed message being sent again: its exchange is replaced instead of the question being asked twice. */
    private fun runTurn(utterance: String, retryOf: String? = null) {
        // One turn at a time: a new request (typed, voice, resume) supersedes the one in flight
        // instead of running beside it and writing its reply into the wrong bubble.
        stopTurnInFlight()
        ttsEngine.stop()
        val token = Any()
        currentTurn = token
        val clientTurnId = retryOf ?: newClientTurnId()
        turnJob = viewModelScope.launch {
            _uiState.update {
                val asked = ConversationTurn(utterance, null, clientTurnId = clientTurnId)
                val retried = retryOf != null && it.turns.lastOrNull()?.clientTurnId == retryOf
                it.copy(
                    voiceState = VoiceState.UNDERSTANDING,
                    progress = ChatProgress.Sending,
                    turns = if (retried) it.turns.dropLast(1) + asked else it.turns + asked,
                    error = null,
                    hint = null,
                )
            }
            // Only this turn's progress is shown: a superseded turn's late events are dropped.
            fun show(progress: ChatProgress) {
                if (currentTurn === token) _uiState.update { if (it.progress == null) it else it.copy(progress = progress) }
            }
            val slow = launch {
                delay(SLOW_SERVER_MS)
                if (_uiState.value.progress == ChatProgress.Sending) show(ChatProgress.SlowServer)
            }
            var language = "en"
            try {
                language = appLocale()
                val accountId = sessionRepository.ensureSession()
                val locale = if (language == "hi") "hi-IN" else "en-US"
                val timed = measureTimedValue {
                    orchestrator.handleTurn(utterance, accountId, locale = locale.take(2), clientTurnId = clientTurnId) { progress ->
                        slow.cancel()
                        show(
                            when (progress) {
                                TurnProgress.Thinking -> ChatProgress.Thinking
                                is TurnProgress.Working -> ChatProgress.Working(progress.name)
                                is TurnProgress.OnPhone -> ChatProgress.OnPhone
                            },
                        )
                    }
                }
                slow.cancel()
                val outcome = timed.value
                // Only a COMPLETED action flashes success. A hand-off (USER_ACTION_REQUIRED, e.g. the
                // alarm opened in the Clock app) has `success = true` but nothing is done yet.
                val succeeded = outcome.result?.let { it.status == ToolResultStatus.COMPLETED } ?: true
                TurnMetricsStore.record(
                    label = outcome.result?.skillId ?: "conversation",
                    durationMs = timed.duration.inWholeMilliseconds,
                    success = succeeded,
                )
                // The device may have left this conversation (a New chat on another screen) while the reply was on its way: it is not shown here.
                val reply = ConversationSync.finishOwnTurn(shown, outcome.conversation, outcome.replacedConversation, orchestrator.conversation.state.value)
                if (reply is OwnReply.Discard) {
                    _uiState.update { it.copy(progress = null) }
                    orchestrator.conversation.state.value?.let(::onActiveConversation)
                    return@launch
                }
                shown = when (reply) {
                    is OwnReply.Show -> reply.stamp
                    is OwnReply.Fresh -> reply.stamp
                    OwnReply.Discard -> shown
                } ?: shown
                _uiState.update { state ->
                    val answered = ConversationTurn(utterance, outcome.message, outcome.result?.status, clientTurnId = clientTurnId, retryable = outcome.retryable)
                    state.copy(
                        turns = if (reply is OwnReply.Fresh) listOf(answered) else replaceLastAssistantReply(state.turns, answered),
                        voiceState = if (succeeded) VoiceState.SUCCESS else VoiceState.IDLE,
                        progress = null,
                    )
                }
                if (succeeded) delay(SUCCESS_FLASH_MS)
                // A private on-device result (the screen, notifications, location…) is not sent to the server's voice: it stays on the phone.
                val keepOnPhone = outcome.result?.skillId in PRIVATE_RESULT_SKILLS
                if (preferences.autoSpeak.first() && !keepOnPhone) {
                    _uiState.update { it.copy(readingReply = true) }
                    try {
                        ttsEngine.speak(outcome.message, locale = locale) {
                            _uiState.update { it.copy(voiceState = VoiceState.SPEAKING) }
                        }
                        _uiState.update { it.copy(voiceState = VoiceState.IDLE, readingReply = false) }
                    } catch (cancelled: CancellationException) {
                        _uiState.update { it.copy(readingReply = false) }
                        throw cancelled
                    } catch (_: Throwable) {
                        _uiState.update { it.copy(voiceState = VoiceState.IDLE, readingReply = false, error = UiString.VOICE_PLAYBACK_FAILED.text(language)) }
                    }
                } else {
                    _uiState.update { it.copy(voiceState = VoiceState.IDLE, readingReply = false) }
                }
            } catch (t: CancellationException) {
                // Stopped (the microphone, New chat): its progress goes. A newer turn has already taken currentTurn and shows its own.
                if (currentTurn === token) _uiState.update { it.copy(progress = null) }
                throw t
            } catch (e: SessionExpiredException) {
                slow.cancel()
                failTurn(utterance, clientTurnId, UiString.CHAT_FAIL_SESSION.text(language), retryable = false)
            } catch (t: Throwable) {
                slow.cancel()
                TurnMetricsStore.record("conversation", durationMs = 0L, success = false)
                // Say what really happened: "check your connection" only when the phone never reached the server, and Try again only
                // where it can help (TurnFailures).
                when (t) {
                    is TurnFailedException -> failTurn(utterance, clientTurnId, t.failure.message(language), t.failure.retryable)
                    is HttpException -> failTurn(utterance, clientTurnId, TurnFailures.fromHttp(t.code(), null).message(language), retryable = false)
                    is IOException -> failTurn(utterance, clientTurnId, TurnFailures.network(replyStarted = false).message(language), retryable = false)
                    else -> failTurn(utterance, clientTurnId, UiString.CHAT_FAIL_UNEXPECTED.text(language), retryable = false)
                }
            }
        }
    }

    private suspend fun appLocale(): String = preferences.locale.first()

    private fun newClientTurnId(): String = "android-" + UUID.randomUUID()

    /** Cancels the turn in flight; its question, still without a reply, is marked as stopped rather than left empty for good. */
    private fun stopTurnInFlight() {
        val inFlight = turnJob?.isActive == true
        turnJob?.cancel()
        if (!inFlight) return
        _uiState.update { state ->
            val last = state.turns.lastOrNull()
            if (last == null || last.assistantText != null) {
                state.copy(progress = null)
            } else {
                state.copy(turns = state.turns.dropLast(1) + last.copy(stopped = true), progress = null)
            }
        }
    }

    private fun failTurn(utterance: String, clientTurnId: String, message: String, retryable: Boolean) {
        // The screen was already reset because the device left this conversation: the failure of a turn that belonged to it is not shown.
        if (leftConversation()) return
        _uiState.update { state ->
            state.copy(
                turns = replaceLastAssistantReply(
                    state.turns,
                    ConversationTurn(utterance, message, ToolResultStatus.FAILED, clientTurnId = clientTurnId, retryable = retryable),
                ),
                voiceState = VoiceState.ERROR,
                progress = null,
                error = message,
            )
        }
    }

    private fun replaceLastAssistantReply(turns: List<ConversationTurn>, answered: ConversationTurn): List<ConversationTurn> {
        if (turns.isEmpty()) return listOf(answered)
        return turns.dropLast(1) + answered
    }
}

private fun turnsOf(texts: List<TurnText>): List<ConversationTurn> = texts.map { ConversationTurn(it.user, it.assistant) }
