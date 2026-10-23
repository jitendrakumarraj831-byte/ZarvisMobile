package com.zarvismobile.feature.conversation

import androidx.lifecycle.SavedStateHandle
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.zarvismobile.agents.AndroidOrchestrator
import com.zarvismobile.core.common.voice.SpeechRecognitionFailure
import com.zarvismobile.core.common.voice.SpeechToTextEngine
import com.zarvismobile.core.common.voice.TextToSpeechEngine
import com.zarvismobile.core.common.voice.TranscriptUpdate
import com.zarvismobile.core.security.SecretStore
import com.zarvismobile.core.tooling.ComposeConfirmationPort
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.data.remote.TokenStorageKeys
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.repository.SessionRepository
import com.zarvismobile.domain.access.AccessCoordinator
import com.zarvismobile.domain.access.AccessState
import com.zarvismobile.domain.access.PendingAction
import com.zarvismobile.domain.access.PendingActionStore
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.conversation.ActiveConversation
import com.zarvismobile.domain.conversation.ConversationIdStore
import com.zarvismobile.domain.entity.ToolResultStatus
import com.zarvismobile.domain.presentation.UiString
import com.zarvismobile.domain.tooling.SkillRegistry
import com.zarvismobile.domain.tooling.ToolPipeline
import java.lang.reflect.Proxy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit

/**
 * What the Chat screen says when a message gets no answer, and what Try again does: the real [ConversationViewModel] and orchestrator
 * against a stand-in backend that answers each turn from a script. A server error is not called a connection problem, Try again re-sends
 * the same message with the same id and replaces the failed exchange, and the microphone's errors are words, never Android's numbers.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ConversationViewModelFailureTest {
    /** Answers the n-th turn with the n-th scripted reply (the last one again once the script runs out), recording each turn's body. */
    private class Backend(private val replies: List<MockResponse>) : Dispatcher() {
        val turns = mutableListOf<Map<String, String?>>()

        @Synchronized
        override fun dispatch(request: RecordedRequest): MockResponse {
            if (request.method == "POST" && request.path == "/api/v1/orchestrator/turn-stream") {
                val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
                turns += body.mapValues { (_, value) -> runCatching { value.jsonPrimitive.content }.getOrNull() }
                return replies[minOf(turns.size, replies.size) - 1]
            }
            return MockResponse().setResponseCode(404)
        }
    }

    private class Secrets : SecretStore {
        private val values = mutableMapOf(
            TokenStorageKeys.ACCOUNT_ID to "acct", TokenStorageKeys.REFRESH_TOKEN to "refresh", TokenStorageKeys.IS_GUEST to "true",
        )
        override fun putString(key: String, value: String) { values[key] = value }
        override fun getString(key: String): String? = values[key]
        override fun remove(key: String) { values.remove(key) }
    }

    private inline fun <reified T : Any> unused(): T =
        Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, method, _ ->
            error("${T::class.java.simpleName}.${method.name} must not be called in these tests")
        } as T

    private lateinit var server: MockWebServer
    private lateinit var backend: Backend

    @Before
    fun start() {
        Dispatchers.setMain(Dispatchers.Unconfined)
    }

    @After
    fun stop() {
        if (::server.isInitialized) server.shutdown()
        Dispatchers.resetMain()
    }

    private fun done(message: String) = MockResponse().setBody(
        "event: done\ndata: " + """{"message":"$message","toolCalls":[],"conversationId":"chat-1"}""" + "\n\n",
    )

    private fun screen(
        vararg replies: MockResponse,
        language: String = "en",
        listening: Flow<TranscriptUpdate> = flowOf(),
    ): ConversationViewModel {
        backend = Backend(replies.toList())
        server = MockWebServer().also { it.dispatcher = backend; it.start() }
        val api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(Json { ignoreUnknownKeys = true }.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ZarvisApi::class.java)
        val noPendingAction = object : PendingActionStore {
            override suspend fun save(action: PendingAction) = Unit
            override suspend fun load(): PendingAction? = null
            override suspend fun clear() = Unit
        }
        val conversation = ActiveConversation(object : ConversationIdStore {
            var saved: String? = null
            override suspend fun get(): String? = saved
            override suspend fun set(id: String?) { saved = id }
        })
        val orchestrator = AndroidOrchestrator(
            onDeviceRegistry = SkillRegistry(),
            onDevicePipeline = ToolPipeline(SkillRegistry(), unused(), unused(), unused(), ComposeConfirmationPort(), unused()),
            api = api,
            confirmationPort = ComposeConfirmationPort(),
            capabilities = CapabilityRegistry(emptyList()),
            access = AccessCoordinator(unused(), unused(), unused(), unused()),
            pendingActions = noPendingAction,
            conversation = conversation,
            clock = { java.time.Instant.now() },
        )
        return ConversationViewModel(
            orchestrator = orchestrator,
            sessionRepository = SessionRepository(api, Secrets()),
            sttEngine = object : SpeechToTextEngine {
                override fun listen(locale: String): Flow<TranscriptUpdate> = listening
                override fun stop() = Unit
            },
            ttsEngine = object : TextToSpeechEngine {
                override suspend fun speak(text: String, locale: String, onPlaybackStarted: () -> Unit) = Unit
                override fun stop() = Unit
            },
            preferences = object : ChatPreferences {
                override val locale: Flow<String> = flowOf(language)
                override val autoSpeak: Flow<Boolean> = flowOf(false)
            },
            // The microphone is allowed: Android reports it granted (the real permission flow has its own tests).
            access = AccessCoordinator({ AccessState.GRANTED }, unused(), unused(), unused()),
            capabilities = CapabilityRegistry.loadDefault(),
            savedState = SavedStateHandle(),
        )
    }

    private fun waitFor(what: String, timeoutMs: Long = 10_000, condition: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (!condition()) {
            if (System.currentTimeMillis() > end) fail("timed out waiting for: $what")
            Thread.sleep(15)
        }
    }

    private fun ConversationViewModel.lastReply(): ConversationTurn? = uiState.value.turns.lastOrNull()?.takeIf { it.assistantText != null }

    private fun ConversationViewModel.answered(text: String): ConversationTurn {
        waitFor("a reply to '$text'") { uiState.value.turns.lastOrNull()?.let { it.userText == text && it.assistantText != null } == true }
        waitFor("the screen to settle") { uiState.value.progress == null && uiState.value.voiceState != VoiceState.UNDERSTANDING }
        return uiState.value.turns.last()
    }

    private val turnId = Regex("^[A-Za-z0-9_-]{8,100}$")

    @Test
    fun aServerErrorIsNotCalledAConnectionProblemAndTryAgainSendsTheSameMessageUnderTheSameId() {
        val vm = screen(
            MockResponse().setResponseCode(500).setBody("""{"error":"Internal error","code":"internal_error"}"""),
            done("Here is your week."),
        )
        vm.submitInitialText("plan my week")
        val failed = vm.answered("plan my week")

        assertEquals(ToolResultStatus.FAILED, failed.status)
        assertEquals(UiString.CHAT_FAIL_SERVER.en, failed.assistantText)
        assertFalse("a server error is not a connection problem", failed.assistantText!!.contains("connection"))
        assertTrue(failed.retryable)

        vm.retry()
        val retried = vm.answered("plan my week")
        assertEquals("Here is your week.", retried.assistantText)
        assertEquals("the failed exchange is replaced, not asked twice", 1, vm.uiState.value.turns.size)
        assertFalse(retried.retryable)
        assertNull(vm.uiState.value.error)

        val ids = backend.turns.map { it["clientTurnId"] }
        assertEquals(2, ids.size)
        assertTrue("the id fits the server's rule: ${ids[0]}", ids[0]!!.matches(turnId))
        assertEquals("Try again re-sends the same id", ids[0], ids[1])
        assertEquals(listOf("plan my week", "plan my week"), backend.turns.map { it["utterance"] })
    }

    @Test
    fun aNewMessageGetsAnIdOfItsOwn() {
        val vm = screen(done("one"), done("two"))
        vm.submitInitialText("first")
        vm.answered("first")
        vm.submitInitialText("second")
        vm.answered("second")
        assertNotEquals(backend.turns[0]["clientTurnId"], backend.turns[1]["clientTurnId"])
    }

    @Test
    fun aMessageStillBeingWorkedOnAsksToWait() {
        val vm = screen(MockResponse().setResponseCode(409).setBody("""{"error":"This message is still being processed.","code":"turn_in_progress","retryable":true}"""))
        vm.submitInitialText("plan my week")
        val busy = vm.answered("plan my week")
        assertEquals(UiString.CHAT_FAIL_BUSY.en, busy.assistantText)
        assertTrue(busy.retryable)
    }

    @Test
    fun aRefusedRequestIsNotOfferedAgainUnchanged() {
        val vm = screen(MockResponse().setResponseCode(400).setBody("""{"error":"utterance is required","code":"invalid_request"}"""))
        vm.submitInitialText("plan my week")
        val refused = vm.answered("plan my week")
        assertEquals(UiString.CHAT_FAIL_REJECTED.en, refused.assistantText)
        assertFalse(refused.retryable)

        vm.retry()
        Thread.sleep(200)
        assertEquals("nothing is sent again", 1, backend.turns.size)
    }

    @Test
    fun withTheAppInHindiTheFailureIsSaidInHindi() {
        val vm = screen(MockResponse().setResponseCode(503).setBody("""{"error":"AI service temporarily unavailable","code":"internal_error","retryable":true}"""), language = "hi")
        vm.submitInitialText("मेरा हफ़्ता प्लान करो")
        assertEquals(UiString.CHAT_FAIL_SERVER.hi, vm.answered("मेरा हफ़्ता प्लान करो").assistantText)
        assertEquals(UiString.CHAT_FAIL_SERVER.hi, vm.uiState.value.error)
    }

    @Test
    fun theMicrophoneHearingNothingIsAQuietHintAndTheChatStaysReady() {
        val vm = screen(done("unused"), listening = flow { throw SpeechRecognitionFailure(7) })
        vm.startListening()
        waitFor("listening to end") { vm.uiState.value.voiceState != VoiceState.LISTENING }

        assertEquals(VoiceState.IDLE, vm.uiState.value.voiceState)
        assertEquals(UiString.VOICE_NOT_HEARD.en, vm.uiState.value.hint)
        assertNull(vm.uiState.value.error)
        assertEquals("nothing was sent", 0, backend.turns.size)
    }

    @Test
    fun aRecognizerErrorIsSaidInWordsNeverAsAnAndroidCode() {
        val vm = screen(done("unused"), language = "hi", listening = flow { throw SpeechRecognitionFailure(2) })
        vm.startListening()
        waitFor("listening to end") { vm.uiState.value.voiceState != VoiceState.LISTENING }

        assertEquals(VoiceState.ERROR, vm.uiState.value.voiceState)
        assertEquals(UiString.VOICE_NETWORK.hi, vm.uiState.value.error)
        assertFalse(vm.uiState.value.error!!.contains("code"))
    }
}
