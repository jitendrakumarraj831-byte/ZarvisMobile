package com.zarvismobile.agents

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.zarvismobile.core.tooling.ComposeConfirmationPort
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.domain.access.AccessCoordinator
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.tooling.SkillRegistry
import com.zarvismobile.domain.tooling.ToolPipeline
import java.lang.reflect.Proxy
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit

/**
 * Which server conversation a turn belongs to, and what Chat shows for it: the real [AndroidOrchestrator] against a stand-in server that
 * answers as backend/src/api/routes/orchestrator.ts and conversations.ts do. The Chat tab and a chat opened from Home are two screens over this
 * ONE orchestrator and ONE stored id, so these are the rules that keep a new chat from showing, sending to, or being overwritten by an old one.
 */
class AndroidOrchestratorConversationTest {
    private lateinit var server: MockWebServer
    private lateinit var store: InMemoryConversationId
    private lateinit var orchestrator: AndroidOrchestrator

    private class InMemoryConversationId(var id: String? = null) : ConversationIdStore {
        override suspend fun get(): String? = id
        override suspend fun set(id: String?) {
            this.id = id
        }
    }

    /** A collaborator the conversation path never calls: it fails loudly if it ever is, rather than quietly doing nothing. */
    private inline fun <reified T : Any> unused(): T =
        Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, method, _ ->
            error("${T::class.java.simpleName}.${method.name} must not be called while talking to the Brain")
        } as T

    @Before
    fun start() {
        server = MockWebServer().also { it.start() }
        val api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(Json { ignoreUnknownKeys = true }.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ZarvisApi::class.java)
        store = InMemoryConversationId()
        orchestrator = AndroidOrchestrator(
            onDeviceRegistry = SkillRegistry(),
            onDevicePipeline = ToolPipeline(SkillRegistry(), unused(), unused(), unused(), ComposeConfirmationPort(), unused()),
            api = api,
            confirmationPort = ComposeConfirmationPort(),
            capabilities = CapabilityRegistry(emptyList()),
            access = AccessCoordinator(unused(), unused(), unused(), unused()),
            pendingActions = unused(),
            conversations = store,
            clock = unused(),
        )
    }

    @After
    fun stop() {
        server.shutdown()
    }

    private fun turnReply(message: String, conversationId: String?) =
        MockResponse().setBody("""{"message":"$message","toolCalls":[],"conversationId":${conversationId?.let { "\"$it\"" } ?: "null"}}""")

    private fun history(conversationId: String, vararg messages: Pair<String, String>) = MockResponse().setBody(
        """{"conversationId":"$conversationId","title":null,"messages":[""" +
            messages.mapIndexed { i, (role, content) -> """{"id":"$conversationId-$i","role":"$role","content":"$content","createdAt":"2026-10-10T10:00:0$i.000Z"}""" }.joinToString(",") +
            "]}",
    )

    /** The conversation id a request carried: `null` when it started a new conversation (absent or JSON null). */
    private fun sentConversationId(request: RecordedRequest): String? {
        val sent = Json.parseToJsonElement(request.body.readUtf8()).jsonObject["conversationId"]
        return if (sent == null || sent == JsonNull) null else sent.jsonPrimitive.content
    }

    @Test
    fun aFirstTurnStartsANewConversationAndTheNextOneContinuesIt() = runBlocking<Unit> {
        server.enqueue(turnReply("Hello!", "c1"))
        server.enqueue(turnReply("Sure.", "c1"))

        orchestrator.handleTurn("hello there", "acct")
        assertNull("the first turn has no conversation to continue", sentConversationId(server.takeRequest(5, TimeUnit.SECONDS)!!))
        assertEquals("the id the server gave is kept", "c1", store.id)

        orchestrator.handleTurn("and another thing", "acct")
        assertEquals("the second turn continues it", "c1", sentConversationId(server.takeRequest(5, TimeUnit.SECONDS)!!))
    }

    @Test
    fun newChatForgetsTheConversationSoTheNextTurnStartsAFreshOneAndNeverSendsTheOldId() = runBlocking<Unit> {
        server.enqueue(turnReply("Hello!", "chat-A"))
        server.enqueue(turnReply("Hello again!", "chat-B"))
        server.enqueue(turnReply("Still B.", "chat-B"))

        orchestrator.handleTurn("hello there", "acct")
        server.takeRequest(5, TimeUnit.SECONDS)
        orchestrator.startNewConversation()
        assertNull("New chat leaves no conversation selected", store.id)

        orchestrator.handleTurn("a different topic", "acct")
        assertNull("the turn after New chat must not carry chat A's id", sentConversationId(server.takeRequest(5, TimeUnit.SECONDS)!!))
        assertEquals("chat B is the conversation now", "chat-B", store.id)

        orchestrator.handleTurn("more on this", "acct")
        assertEquals("chat-B", sentConversationId(server.takeRequest(5, TimeUnit.SECONDS)!!))
    }

    @Test
    fun restoringShowsOnlyTheCurrentConversationFromItsOwnEndpoint() = runBlocking<Unit> {
        store.id = "chat-A"
        server.enqueue(history("chat-A", "user" to "first question", "assistant" to "first answer"))
        assertEquals(listOf(RestoredMessage("user", "first question"), RestoredMessage("assistant", "first answer")), orchestrator.restoreConversation())
        assertEquals("/api/v1/conversations/chat-A/messages", server.takeRequest(5, TimeUnit.SECONDS)!!.path)

        // Switch to chat B: what is restored is B's, and nothing of A's is mixed in.
        orchestrator.startNewConversation()
        store.id = "chat-B"
        server.enqueue(history("chat-B", "user" to "second chat", "assistant" to "second answer"))
        val restored = orchestrator.restoreConversation()
        assertEquals(listOf(RestoredMessage("user", "second chat"), RestoredMessage("assistant", "second answer")), restored)
        assertEquals("/api/v1/conversations/chat-B/messages", server.takeRequest(5, TimeUnit.SECONDS)!!.path)
        assertTrue(restored.none { it.content.contains("first") })
    }

    @Test
    fun afterNewChatThereIsNothingToRestoreAndNothingIsRequested() = runBlocking<Unit> {
        store.id = "chat-A"
        orchestrator.startNewConversation()
        assertEquals(emptyList<RestoredMessage>(), orchestrator.restoreConversation())
        assertEquals("no request goes out for a conversation that was left", 0, server.requestCount)
    }

    @Test
    fun aConversationTheServerNoLongerHasIsForgottenNotShown() = runBlocking<Unit> {
        store.id = "gone"
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"not_found"}"""))
        assertEquals(emptyList<RestoredMessage>(), orchestrator.restoreConversation())
        assertNull("a 404 clears the stored id, so the next turn starts a new conversation", store.id)
    }

    @Test
    fun aFailedRestoreKeepsTheConversationSelected() = runBlocking<Unit> {
        store.id = "chat-A"
        server.enqueue(MockResponse().setResponseCode(500))
        runCatching { orchestrator.restoreConversation() }
        assertEquals("a server error is not a reason to leave the conversation", "chat-A", store.id)
    }

    @Test
    fun aTurnThatNewChatCancelsDoesNotBringTheOldConversationBack() = runBlocking<Unit> {
        store.id = "old"
        // The reply for the old conversation arrives well after New chat was tapped.
        server.enqueue(turnReply("late reply", "old").setHeadersDelay(600, TimeUnit.MILLISECONDS))
        val turn = launch(Dispatchers.IO) { orchestrator.handleTurn("hello there", "acct") }
        assertNotNull("the request is on its way", server.takeRequest(5, TimeUnit.SECONDS))

        // What ConversationViewModel.startNewConversation does: cancel the turn, then forget the conversation.
        turn.cancel()
        orchestrator.startNewConversation()
        turn.join()
        delay(1_200) // longer than the reply's delay: had anything applied it, the old id would be back by now

        assertTrue(turn.isCancelled)
        assertNull("the late reply must not select the old conversation again", store.id)
    }
}
