package com.zarvismobile.feature.conversation

import androidx.lifecycle.SavedStateHandle
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.zarvismobile.agents.AndroidOrchestrator
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
import com.zarvismobile.domain.presentation.UiString
import com.zarvismobile.domain.tooling.SkillRegistry
import com.zarvismobile.domain.tooling.ToolPipeline
import java.io.IOException
import java.lang.reflect.Proxy
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit

/**
 * Read aloud and the replies read automatically, on the real [ConversationViewModel] and orchestrator against a stand-in backend, with a
 * voice whose audio arrives only when the test delivers it (as the server's voice does, after a while). One voice at a time; Stop, a new
 * message, the microphone, a New chat or a deleted chat end a reply even while its audio is still being made, and it never starts
 * speaking afterwards; the screen always comes back to rest; nothing is ever sent to the AI to read a reply that is already there.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ConversationReadAloudTest {
    /** Answers the n-th turn with the n-th scripted reply (the last one again once the script runs out). Deleting a chat succeeds. */
    private class Backend(private val replies: List<MockResponse>) : Dispatcher() {
        val turns = mutableListOf<String?>()
        /** Each turn's `inputMode`, null when the app sent none. */
        val inputModes = mutableListOf<String?>()
        var deletes = 0

        @Synchronized
        override fun dispatch(request: RecordedRequest): MockResponse {
            if (request.method == "POST" && request.path == "/api/v1/orchestrator/turn-stream") {
                val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
                turns += body["utterance"]?.jsonPrimitive?.content
                inputModes += (body["inputMode"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                return replies[minOf(turns.size, replies.size) - 1]
            }
            if (request.method == "DELETE" && request.path?.startsWith("/api/v1/conversations/") == true) {
                deletes++
                return MockResponse().setResponseCode(204)
            }
            return MockResponse().setResponseCode(404)
        }
    }

    /**
     * A voice like the real engine: the server's audio arrives when the test [Call.deliver]s it (or fails it), then plays until the test
     * [Call.finish]es it or stop() ends it; speak() returns when playback ends.
     */
    private class ControlledVoice : TextToSpeechEngine {
        class Call(val text: String, val locale: String, val onPhoneOnly: Boolean) {
            val audio = CompletableDeferred<Unit>()
            val playback = CompletableDeferred<Unit>()
            @Volatile var played = false
            @Volatile var cancelled = false

            fun deliver() = audio.complete(Unit)
            fun finish() = playback.complete(Unit)
        }

        val calls = CopyOnWriteArrayList<Call>()
        @Volatile var stops = 0

        override suspend fun speak(text: String, locale: String, onPhoneOnly: Boolean, onPlaybackStarted: () -> Unit) {
            val call = Call(text, locale, onPhoneOnly).also { calls += it }
            try {
                call.audio.await()
                call.played = true
                onPlaybackStarted()
                call.playback.await()
            } catch (e: CancellationException) {
                call.cancelled = true
                throw e
            }
        }

        override fun stop() {
            stops++
            calls.filter { it.played }.forEach { it.finish() }
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
    private val voice = ControlledVoice()

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

    /** A reply whose result is the user's private data: an on-device skill that promises nothing is uploaded. */
    private fun privateResult(message: String) = MockResponse().setBody(
        "event: done\ndata: " +
            """{"message":"$message","conversationId":"chat-1","toolCalls":[{"skillId":"location.current","outcome":{"kind":"success"},""" +
            """"result":{"success":true,"status":"COMPLETED","skillId":"location.current","userSafeMessage":"$message"}}]}""" + "\n\n",
    )

    private fun screen(
        vararg replies: MockResponse,
        language: String = "en",
        autoSpeak: Boolean = false,
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
            ttsEngine = voice,
            preferences = object : ChatPreferences {
                override val locale: Flow<String> = flowOf(language)
                override val autoSpeak: Flow<Boolean> = flowOf(autoSpeak)
            },
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

    private val ConversationViewModel.state get() = uiState.value

    /** Sends [text] and waits for its reply and for the screen to be at rest. */
    private fun ConversationViewModel.ask(text: String) {
        submitInitialText(text)
        waitFor("a reply to '$text'") { state.turns.lastOrNull()?.let { it.userText == text && it.assistantText != null } == true }
        waitFor("the screen to settle after '$text'") { state.progress == null && state.voiceState == VoiceState.IDLE }
    }

    private fun waitForCall(count: Int): ControlledVoice.Call {
        waitFor("voice request #$count") { voice.calls.size >= count }
        return voice.calls[count - 1]
    }

    @Test
    fun aSpokenMessageIsSentAsSpokenSoItsReplyIsWrittenToBeHeardAndATypedOneIsNot() {
        val heard = flowOf(TranscriptUpdate("kal ka mausam", isFinal = false), TranscriptUpdate("kal ka mausam kaisa hai", isFinal = true))
        val vm = screen(done("Kal halki baarish ho sakti hai."), done("Theek hai."), listening = heard)

        vm.startListening()
        waitFor("the spoken message's reply") { vm.state.turns.lastOrNull()?.assistantText == "Kal halki baarish ho sakti hai." }
        waitFor("the screen to settle") { vm.state.progress == null && vm.state.voiceState == VoiceState.IDLE }
        vm.ask("ok thanks")

        assertEquals(listOf("kal ka mausam kaisa hai", "ok thanks"), backend.turns)
        assertEquals(listOf("voice", null), backend.inputModes)
        assertEquals("what was heard is not left in the composer", "", vm.state.composerText)
    }

    @Test
    fun readAloudReadsAReplyAlreadyThereWithoutAskingTheAiAgain() {
        val vm = screen(done("Here is your plan."))
        vm.ask("plan my day")
        val transcript = vm.state.turns

        vm.speakReply("Here is your plan.")
        val call = waitForCall(1)
        assertEquals("the reply's button says Stop while its audio is made", "Here is your plan.", vm.state.readingReply)
        assertEquals("Speaking only once audio really plays", VoiceState.IDLE, vm.state.voiceState)

        call.deliver()
        waitFor("Speaking") { vm.state.voiceState == VoiceState.SPEAKING }
        call.finish()
        waitFor("the reading to end") { vm.state.readingReply == null && vm.state.voiceState == VoiceState.IDLE }

        assertEquals(listOf("plan my day"), backend.turns)
        assertEquals("the chat is untouched", transcript, vm.state.turns)
        assertEquals("Here is your plan.", call.text)
        assertFalse(call.onPhoneOnly)
        assertNull(vm.state.error)
    }

    @Test
    fun stopWhileTheAudioIsStillBeingMadeCancelsItAndItNeverStartsLater() {
        val vm = screen(done("A long answer."))
        vm.ask("explain")
        vm.speakReply("A long answer.")
        val call = waitForCall(1)

        vm.stopSpeaking()

        waitFor("the request to be cancelled") { call.cancelled }
        assertNull(vm.state.readingReply)
        assertEquals(VoiceState.IDLE, vm.state.voiceState)
        // The server's audio arrives after all: it is not played.
        call.deliver()
        Thread.sleep(100)
        assertFalse(call.played)
        assertEquals(VoiceState.IDLE, vm.state.voiceState)
        assertNull("stopping is not an error", vm.state.error)
    }

    @Test
    fun stopWhilePlayingEndsItAndKeepsTheReplyAsText() {
        val vm = screen(done("Opening WhatsApp."))
        vm.ask("open whatsapp")
        vm.speakReply("Opening WhatsApp.")
        waitForCall(1).deliver()
        waitFor("Speaking") { vm.state.voiceState == VoiceState.SPEAKING }

        vm.stopSpeaking()

        waitFor("the screen to rest") { vm.state.voiceState == VoiceState.IDLE && vm.state.readingReply == null }
        assertTrue(voice.stops >= 1)
        assertEquals("Opening WhatsApp.", vm.state.turns.last().assistantText)
        assertNull(vm.state.error)
    }

    @Test
    fun aNewMessageEndsAReplyStillWaitingForItsAudioAndIsAnsweredNormally() {
        val vm = screen(done("First answer."), done("Second answer."))
        vm.ask("first")
        vm.speakReply("First answer.")
        val old = waitForCall(1)

        vm.ask("second")

        assertTrue("the old reading was cancelled", old.cancelled)
        old.deliver()
        Thread.sleep(100)
        assertFalse("it never speaks over the new turn", old.played)
        assertNull(vm.state.readingReply)
        assertEquals(listOf("first", "second"), backend.turns)
        assertEquals(listOf("First answer.", "Second answer."), vm.state.turns.map { it.assistantText })
    }

    @Test
    fun newChatEndsAReplyBeingReadAloud() {
        val vm = screen(done("Old chat's answer."))
        vm.ask("hello")
        vm.speakReply("Old chat's answer.")
        val call = waitForCall(1)

        vm.startNewConversation()

        waitFor("the request to be cancelled") { call.cancelled }
        call.deliver()
        Thread.sleep(100)
        assertFalse("nothing from the old chat is spoken into the new one", call.played)
        assertNull(vm.state.readingReply)
        assertEquals(VoiceState.IDLE, vm.state.voiceState)
        assertTrue(vm.state.turns.isEmpty())
    }

    @Test
    fun theMicrophoneEndsAReplyBeingReadAloud() {
        val vm = screen(done("Hello."))
        vm.ask("hi")
        vm.speakReply("Hello.")
        val call = waitForCall(1)
        call.deliver()
        waitFor("Speaking") { vm.state.voiceState == VoiceState.SPEAKING }

        vm.startListening()

        waitFor("the reading to be cancelled") { call.cancelled }
        assertNull(vm.state.readingReply)
        assertTrue(voice.stops >= 1)
        assertEquals("nothing was sent", listOf("hi"), backend.turns)
    }

    @Test
    fun deletingTheChatEndsItsReplyBeingReadAloud() {
        val vm = screen(done("Your note is saved."))
        vm.ask("save a note")
        vm.speakReply("Your note is saved.")
        val call = waitForCall(1)
        // Delete is not offered while a turn is still running: let the turn's coroutine finish after its last update.
        Thread.sleep(100)

        vm.deleteConversation()

        waitFor("the chat to be deleted") { vm.state.deleteOutcome == ChatDeleteOutcome.DELETED }
        waitFor("the request to be cancelled") { call.cancelled }
        assertEquals(1, backend.deletes)
        assertNull(vm.state.readingReply)
    }

    @Test
    fun readingAnotherReplyReplacesTheOneBeingReadOneVoiceAtATime() {
        val vm = screen(done("Answer one."), done("Answer two."))
        vm.ask("one")
        vm.ask("two")

        vm.speakReply("Answer one.")
        val first = waitForCall(1)
        vm.speakReply("Answer two.")
        val second = waitForCall(2)

        waitFor("the first request to be cancelled") { first.cancelled }
        assertEquals("only the newer reply's button says Stop", "Answer two.", vm.state.readingReply)
        first.deliver()
        second.deliver()
        waitFor("Speaking") { vm.state.voiceState == VoiceState.SPEAKING }
        assertFalse(first.played)
        assertTrue(second.played)

        second.finish()
        waitFor("the screen to rest") { vm.state.voiceState == VoiceState.IDLE && vm.state.readingReply == null }
    }

    @Test
    fun readAloudDuringTheDoneFlashAndTheAutomaticReplyNeverPlayTogether() {
        val vm = screen(done("First."), done("Second."), autoSpeak = true)
        vm.submitInitialText("one")
        waitForCall(1).let { it.deliver(); it.finish() }
        waitFor("the first turn to rest") { vm.state.voiceState == VoiceState.IDLE && vm.state.readingReply == null }
        val before = voice.calls.size

        vm.submitInitialText("two")
        waitFor("the second reply") { vm.state.turns.lastOrNull()?.assistantText == "Second." }
        // The user taps Read aloud on the earlier reply while the new one is still flashing Done.
        vm.speakReply("First.")
        Thread.sleep(800) // longer than the Done flash: an automatic reading would have been asked for by now

        val requests = voice.calls.drop(before)
        requests.forEach { it.deliver() }
        Thread.sleep(100)
        assertEquals("one voice at a time", 1, requests.count { it.played })
        assertEquals("the reply the user chose is the one read", "First.", requests.single { it.played }.text)
        assertEquals("First.", vm.state.readingReply)
    }

    @Test
    fun stoppingAnAutomaticReplyBeforeItsAudioArrivesLeavesTheChatReady() {
        val vm = screen(done("Hello."), autoSpeak = true)
        vm.submitInitialText("hi")
        val call = waitForCall(1)
        assertEquals("Hello.", vm.state.readingReply)

        vm.stopSpeaking()

        waitFor("the request to be cancelled") { call.cancelled }
        // Not left on Done: the chat is idle again.
        waitFor("the chat to be ready") { vm.state.voiceState == VoiceState.IDLE }
        assertNull(vm.state.readingReply)
        assertNull(vm.state.progress)
    }

    @Test
    fun whenNoVoiceCanReadItTheReplyStaysAndTheScreenSaysSoAndTryingAgainClearsIt() {
        val vm = screen(done("Here you go."))
        vm.ask("hi")
        val transcript = vm.state.turns
        vm.speakReply("Here you go.")
        waitForCall(1).audio.completeExceptionally(IOException("Cloud voice and on-device speech both failed"))

        waitFor("the failure to show") { vm.state.error == UiString.VOICE_PLAYBACK_FAILED.en }
        assertNull(vm.state.readingReply)
        assertEquals(VoiceState.IDLE, vm.state.voiceState)
        assertEquals("the reply stays on screen", transcript, vm.state.turns)

        vm.speakReply("Here you go.")
        assertNull("asking the voice again clears its old failure", vm.state.error)
        waitForCall(2).let { it.deliver(); it.finish() }
        waitFor("the reading to end") { vm.state.readingReply == null }
        assertNull(vm.state.error)
        assertEquals("nothing was sent to the AI", listOf("hi"), backend.turns)
    }

    @Test
    fun aReplyIsReadInItsOwnLanguage() {
        val hindiApp = screen(done("Your plan is ready."), language = "hi")
        hindiApp.ask("plan")
        hindiApp.speakReply("Your plan is ready.")
        assertEquals("hi-IN", waitForCall(1).locale)
        hindiApp.stopSpeaking()
        server.shutdown()

        val englishApp = screen(done("Your plan is ready."), done("आपका प्लान तैयार है।"))
        englishApp.ask("plan")
        englishApp.ask("प्लान बताओ")
        englishApp.speakReply("Your plan is ready.")
        assertEquals("en-US", waitForCall(2).locale)
        englishApp.speakReply("आपका प्लान तैयार है।")
        assertEquals("a Hindi reply is read in Hindi with the app in English", "hi-IN", waitForCall(3).locale)
    }

    @Test
    fun aPrivateOnDeviceResultIsReadByThePhonesOwnVoiceOnlyAndNeverAutomatically() {
        val vm = screen(privateResult("You are near the station."), done("Anything else?"), autoSpeak = true)
        vm.ask("where am I")
        assertTrue("a private result is never spoken automatically", voice.calls.isEmpty())
        assertTrue(vm.state.turns.last().onPhoneOnly)

        vm.speakReply("You are near the station.")
        val private = waitForCall(1)
        assertTrue("it must not reach the server's voice", private.onPhoneOnly)
        private.deliver()
        private.finish()
        waitFor("the reading to end") { vm.state.readingReply == null }

        // An ordinary reply is read automatically (the chat waits on Done until its audio comes, so this does not use ask()).
        vm.submitInitialText("thanks")
        waitForCall(2).let { auto ->
            assertFalse("an ordinary reply may use the server's voice", auto.onPhoneOnly)
            auto.deliver()
            auto.finish()
        }
        waitFor("the screen to rest") { vm.state.readingReply == null && vm.state.voiceState == VoiceState.IDLE }
    }
}
