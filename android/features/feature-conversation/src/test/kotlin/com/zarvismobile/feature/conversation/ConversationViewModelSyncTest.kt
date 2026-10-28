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
import com.zarvismobile.domain.access.PendingAction
import com.zarvismobile.domain.access.PendingActionStore
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.conversation.ActiveConversation
import com.zarvismobile.domain.conversation.ConversationIdStore
import com.zarvismobile.domain.tooling.SkillRegistry
import com.zarvismobile.domain.tooling.ToolPipeline
import java.lang.reflect.Proxy
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
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
 * What the Chat screen shows when the conversation changes underneath it: the real [ConversationViewModel] (and the real orchestrator,
 * session and active-conversation code) against a stand-in backend that keeps conversations by id, as the real one does.
 *
 * Two view models stand for the Chat tab and a chat opened from Home. They share one orchestrator and one [ActiveConversation], exactly as
 * the two screens do in the app.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ConversationViewModelSyncTest {
    /** A backend that, like the real one, continues a conversation it knows and starts a new one for an id it does not know. */
    private class Backend : Dispatcher() {
        val chats = linkedMapOf<String, MutableList<Pair<String, String>>>()
        val turnRequests = mutableListOf<Pair<String, String?>>()
        var slow = mutableMapOf<String, Long>()
        val deleteRequests = mutableListOf<String>()
        /** When set, every delete answers with this status instead of deleting (a server error, or an old server's bare 404). */
        var failDeletesWith: Int? = null
        private var next = 0

        @Synchronized
        override fun dispatch(request: RecordedRequest): MockResponse {
            val path = request.path.orEmpty()
            if (request.method == "POST" && path == "/api/v1/orchestrator/turn-stream") {
                val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
                val utterance = body.getValue("utterance").jsonPrimitive.content
                val sent = body["conversationId"]?.takeIf { it != JsonNull }?.jsonPrimitive?.content
                turnRequests += utterance to sent
                val id = if (sent != null && chats.containsKey(sent)) sent else "chat-${++next}"
                chats.getOrPut(id) { mutableListOf() } += listOf("user" to utterance, "assistant" to "answer to $utterance")
                val reply = MockResponse().setBody("event: done\ndata: " + """{"message":"answer to $utterance","toolCalls":[],"conversationId":"$id"}""" + "\n\n")
                slow[utterance]?.let { reply.setHeadersDelay(it, TimeUnit.MILLISECONDS) }
                return reply
            }
            val delete = Regex("^/api/v1/conversations/([^/]+)$").matchEntire(path)
            if (request.method == "DELETE" && delete != null) {
                val id = delete.groupValues[1]
                deleteRequests += id
                failDeletesWith?.let { return MockResponse().setResponseCode(it).setBody("{}") }
                return if (chats.remove(id) != null) MockResponse().setResponseCode(204)
                else MockResponse().setResponseCode(404).setBody("""{"error":"Conversation not found","code":"conversation_not_found"}""")
            }
            val messages = Regex("^/api/v1/conversations/([^/]+)/messages$").matchEntire(path)
            if (request.method == "GET" && messages != null) {
                val id = messages.groupValues[1]
                val chat = chats[id] ?: return MockResponse().setResponseCode(404).setBody("""{"error":"Conversation not found","code":"conversation_not_found"}""")
                val list = chat.mapIndexed { i, (role, content) -> """{"id":"$id-$i","role":"$role","content":"$content","createdAt":"2026-10-11T10:00:00.000Z"}""" }
                return MockResponse().setBody("""{"conversationId":"$id","title":null,"messages":[${list.joinToString(",")}]}""")
            }
            return MockResponse().setResponseCode(404)
        }
    }

    private class MemoryStore(var saved: String? = null) : ConversationIdStore {
        override suspend fun get(): String? = saved
        override suspend fun set(id: String?) {
            saved = id
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
    private lateinit var store: MemoryStore
    private lateinit var active: ActiveConversation
    private lateinit var orchestrator: AndroidOrchestrator
    private lateinit var session: SessionRepository
    private val spokenReplies = mutableListOf<Pair<String, String>>()

    @Before
    fun start() {
        Dispatchers.setMain(Dispatchers.Unconfined)
        backend = Backend()
        server = MockWebServer().also { it.dispatcher = backend; it.start() }
        val api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(Json { ignoreUnknownKeys = true }.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ZarvisApi::class.java)
        store = MemoryStore()
        active = ActiveConversation(store)
        val noPendingAction = object : PendingActionStore {
            override suspend fun save(action: PendingAction) = Unit
            override suspend fun load(): PendingAction? = null
            override suspend fun clear() = Unit
        }
        orchestrator = AndroidOrchestrator(
            onDeviceRegistry = SkillRegistry(),
            onDevicePipeline = ToolPipeline(SkillRegistry(), unused(), unused(), unused(), ComposeConfirmationPort(), unused()),
            api = api,
            confirmationPort = ComposeConfirmationPort(),
            capabilities = CapabilityRegistry(emptyList()),
            access = AccessCoordinator(unused(), unused(), unused(), unused()),
            pendingActions = noPendingAction,
            conversation = active,
            clock = { java.time.Instant.now() },
        )
        session = SessionRepository(api, Secrets())
    }

    @After
    fun stop() {
        server.shutdown()
        Dispatchers.resetMain()
    }

    private fun screen(): ConversationViewModel = ConversationViewModel(
        orchestrator = orchestrator,
        sessionRepository = session,
        sttEngine = object : SpeechToTextEngine {
            override fun listen(locale: String): Flow<TranscriptUpdate> = emptyFlow()
            override fun stop() = Unit
        },
        ttsEngine = object : TextToSpeechEngine {
            override suspend fun speak(text: String, locale: String, onPlaybackStarted: () -> Unit) {
                spokenReplies += text to locale
                onPlaybackStarted()
            }
            override fun stop() = Unit
        },
        preferences = object : ChatPreferences {
            override val locale: Flow<String> = flowOf("en")
            override val autoSpeak: Flow<Boolean> = flowOf(false)
        },
        access = AccessCoordinator(unused(), unused(), unused(), unused()),
        capabilities = CapabilityRegistry(emptyList()),
        savedState = SavedStateHandle(),
    )

    private fun waitFor(what: String, timeoutMs: Long = 10_000, condition: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (!condition()) {
            if (System.currentTimeMillis() > end) fail("timed out waiting for: $what")
            Thread.sleep(15)
        }
    }

    private fun ConversationViewModel.users() = uiState.value.turns.map { it.userText }

    /** The user says [text] on this screen, the reply has been shown, and the screen is at rest again (the "done" flash is over). */
    private fun ConversationViewModel.say(text: String) {
        submitInitialText(text)
        waitFor("the reply to '$text'") { uiState.value.turns.lastOrNull()?.let { it.userText == text && it.assistantText != null } == true }
        waitFor("the screen to be at rest") { uiState.value.voiceState == VoiceState.IDLE }
    }

    @Test
    fun readAloudSpeaksAnExistingReplyWithoutSubmittingAnotherAiTurn() {
        val chatTab = screen()
        chatTab.say("read me")
        val turnCountBeforeReadAloud = backend.turnRequests.size

        chatTab.speakReply("answer to read me")
        waitFor("Read Aloud to finish") { !chatTab.uiState.value.readingReply }

        assertEquals(turnCountBeforeReadAloud, backend.turnRequests.size)
        assertEquals(listOf("answer to read me" to "en-US"), spokenReplies)
        assertEquals(VoiceState.IDLE, chatTab.uiState.value.voiceState)
    }
    @Test
    fun itsOwnFirstAnswerGivesTheChatAnIdAndDoesNotResetTheScreen() {
        val chatTab = screen()
        chatTab.say("plan my trip")
        assertEquals("chat-1", active.state.value?.id)
        Thread.sleep(200) // time for a wrongly triggered reset to show
        assertEquals(listOf("plan my trip"), chatTab.users())
        assertEquals("answer to plan my trip", chatTab.uiState.value.turns.single().assistantText)
    }

    @Test
    fun newChatClearsTheScreenAtOnceAndTheNextMessageStartsAFreshConversation() {
        val chatTab = screen()
        chatTab.say("first topic")
        chatTab.startNewConversation()
        assertEquals("gone from the screen before anything else happens", emptyList<String>(), chatTab.users())
        waitFor("the conversation to be left") { active.state.value?.id == null }
        assertNull(store.saved)

        chatTab.say("second topic")
        assertNull("the new message must not carry the old conversation's id", backend.turnRequests.last().second)
        assertEquals("chat-2", active.state.value?.id)
        assertEquals(listOf("second topic"), chatTab.users())
    }

    @Test
    fun aNewChatOnTheOtherScreenEmptiesThisOneWithoutItBeingTouched() {
        val chatTab = screen()
        val fromHome = screen()
        chatTab.say("first topic")
        fromHome.startNewConversation()
        waitFor("the Chat tab to drop the old chat") { chatTab.users().isEmpty() }
        assertEquals(emptyList<String>(), fromHome.users())
    }

    @Test
    fun aChatBegunOnTheOtherScreenIsShownWhenThisOneComesBack() {
        val chatTab = screen()
        val fromHome = screen()
        fromHome.say("plan my trip")
        chatTab.syncWithServer()
        waitFor("the Chat tab to show the chat") { chatTab.users() == listOf("plan my trip") }
        assertEquals("answer to plan my trip", chatTab.uiState.value.turns.single().assistantText)
    }

    @Test
    fun rapidNavigationWithNewChatsAndNewConversationsNeverLeavesAnOldChatOnAScreen() {
        val chatTab = screen()
        val fromHome = screen()
        chatTab.say("topic one")
        fromHome.syncWithServer()
        waitFor("the other screen to show topic one") { fromHome.users() == listOf("topic one") }

        fromHome.startNewConversation(); fromHome.say("topic two")
        fromHome.startNewConversation(); fromHome.say("topic three")

        chatTab.syncWithServer()
        waitFor("the Chat tab to show the chat that is active now") { chatTab.users() == listOf("topic three") }
        fromHome.syncWithServer()
        Thread.sleep(150)
        assertEquals(listOf("topic three"), fromHome.users())
        assertEquals(listOf("topic three"), chatTab.users())
    }

    @Test
    fun reopeningChatShowsTheActiveConversationAndNothingFromTheOneBefore() {
        val first = screen()
        first.say("topic one")
        first.startNewConversation()
        waitFor("New chat") { active.state.value?.id == null }
        assertEquals("a chat opened right after New chat is empty", emptyList<String>(), screen().users())

        val other = screen()
        other.say("topic two")
        val reopened = screen()
        waitFor("the reopened Chat to show the active conversation") { reopened.users() == listOf("topic two") }
    }

    @Test
    fun theReplyToATurnThatNewChatOvertookIsNotShownInTheNewChat() {
        backend.slow["a slow one"] = 700
        val chatTab = screen()
        val fromHome = screen()
        chatTab.submitInitialText("a slow one")
        waitFor("the slow request to reach the server") { backend.turnRequests.any { it.first == "a slow one" } }
        fromHome.startNewConversation()
        Thread.sleep(1_300) // longer than the reply's delay: had it been applied, it would be on screen by now
        assertEquals(emptyList<String>(), chatTab.users())
        assertNull(chatTab.uiState.value.error)
        assertNull("the late reply did not select the old conversation again", active.state.value?.id)
    }

    @Test
    fun signingOutOrChangingAccountEmptiesEveryScreen() {
        val chatTab = screen()
        val fromHome = screen()
        chatTab.say("private topic")
        fromHome.syncWithServer()
        waitFor("the other screen to show the chat") { fromHome.users() == listOf("private topic") }
        kotlinx.coroutines.runBlocking { active.startNew() } // what sign-out, sign-in, delete account and a new guest do
        waitFor("both screens to drop the chat") { chatTab.users().isEmpty() && fromHome.users().isEmpty() }
    }

    @Test
    fun aConversationTheServerNoLongerHasIsLeftWhenAScreenComesBack() {
        val chatTab = screen()
        chatTab.say("old topic")
        backend.chats.clear() // deleted on the web
        chatTab.syncWithServer()
        waitFor("the vanished conversation to be dropped") { chatTab.users().isEmpty() && active.state.value?.id == null }
    }

    @Test
    fun aMessageSentToAConversationThatVanishedShowsOnlyItself() {
        val chatTab = screen()
        chatTab.say("old topic")
        backend.chats.clear() // deleted on the web
        chatTab.say("new topic") // the server starts a new conversation for the id it does not know
        waitFor("the new conversation") { chatTab.users() == listOf("new topic") }
        assertEquals("chat-2", active.state.value?.id)
        assertTrue(chatTab.uiState.value.turns.none { it.userText == "old topic" })
    }

    // ---- Delete chat ---------------------------------------------------------------------------------------------------------------

    @Test
    fun deletingAChatRemovesItOnTheServerAndEmptiesEveryChatScreen() {
        val chatTab = screen()
        val chatFromHome = screen()
        chatTab.say("plan my trip")
        chatFromHome.syncWithServer() // what coming back to that screen does
        waitFor("the other screen to show the same chat") { chatFromHome.users() == listOf("plan my trip") }

        chatTab.deleteConversation()
        waitFor("the delete to finish") { chatTab.uiState.value.deleteOutcome == ChatDeleteOutcome.DELETED }

        assertEquals(listOf("chat-1"), backend.deleteRequests)
        assertTrue("the server no longer has the chat", backend.chats.isEmpty())
        assertEquals(emptyList<String>(), chatTab.users())
        waitFor("the other Chat screen to drop it too") { chatFromHome.users().isEmpty() }
        assertNull("nothing is active", active.state.value?.id)
        assertNull("and nothing is saved", store.saved)
        assertFalse("the screen is not left busy", chatTab.uiState.value.deleting)
    }

    @Test
    fun aFailedDeleteChangesNothingAndSaysSo() {
        val chatTab = screen()
        val chatFromHome = screen()
        chatTab.say("plan my trip")
        chatFromHome.syncWithServer() // what coming back to that screen does
        waitFor("the other screen to show the same chat") { chatFromHome.users() == listOf("plan my trip") }
        backend.failDeletesWith = 500

        chatTab.deleteConversation()
        waitFor("the delete to fail") { chatTab.uiState.value.deleteOutcome == ChatDeleteOutcome.FAILED }

        assertEquals("the chat is still on this screen", listOf("plan my trip"), chatTab.users())
        Thread.sleep(200) // time for a wrongly triggered reset of the other screen to show
        assertEquals("and on the other one", listOf("plan my trip"), chatFromHome.users())
        assertEquals("chat-1", active.state.value?.id)
        assertEquals("chat-1", store.saved)
        assertFalse(chatTab.uiState.value.deleting)

        // The failure card is dismissed, and a retry once the server works deletes it for real.
        chatTab.dismissDeleteOutcome()
        assertNull(chatTab.uiState.value.deleteOutcome)
        backend.failDeletesWith = null
        chatTab.deleteConversation()
        waitFor("the retry to succeed") { chatTab.uiState.value.deleteOutcome == ChatDeleteOutcome.DELETED }
        assertTrue(backend.chats.isEmpty())
    }

    @Test
    fun aServerWithoutTheDeleteRouteIsNotShownAsDeleted() {
        val chatTab = screen()
        chatTab.say("plan my trip")
        backend.failDeletesWith = 404 // an older backend: 404 for the unknown route, no conversation_not_found code
        chatTab.deleteConversation()
        waitFor("the delete to fail") { chatTab.uiState.value.deleteOutcome == ChatDeleteOutcome.FAILED }
        assertEquals(listOf("plan my trip"), chatTab.users())
        assertEquals("chat-1", active.state.value?.id)
    }

    @Test
    fun aChatThatNeverGotAServerIdJustStartsOverWithoutAnyRequest() {
        val chatTab = screen()
        chatTab.deleteConversation()
        waitFor("the screen to settle") { !chatTab.uiState.value.deleting }
        assertEquals(emptyList<String>(), backend.deleteRequests)
        assertNull(chatTab.uiState.value.deleteOutcome)
    }

    @Test
    fun deleteIsIgnoredWhileAReplyIsOnItsWay() {
        val chatTab = screen()
        chatTab.say("first")
        backend.slow["second"] = 700
        chatTab.submitInitialText("second")
        waitFor("the second request to be in flight") { backend.turnRequests.size == 2 }
        chatTab.deleteConversation()
        assertFalse("nothing was started", chatTab.uiState.value.deleting)
        assertEquals("and no delete request went out", emptyList<String>(), backend.deleteRequests)
        waitFor("the reply to arrive") { chatTab.uiState.value.turns.lastOrNull()?.assistantText != null }
        assertEquals(listOf("first", "second"), chatTab.users())
    }
}
