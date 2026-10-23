package com.zarvismobile.agents

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.domain.conversation.ActiveConversation
import com.zarvismobile.domain.presentation.TurnFailure
import com.zarvismobile.domain.presentation.TurnFailureKind
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
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
import org.junit.Assert.assertFalse
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
    private lateinit var active: ActiveConversation
    private lateinit var orchestrator: AndroidOrchestrator

    @Before
    fun start() {
        server = MockWebServer().also { it.start() }
        val api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(Json { ignoreUnknownKeys = true }.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ZarvisApi::class.java)
        store = InMemoryConversationId()
        active = ActiveConversation(store)
        orchestrator = OrchestratorFixture.create(api, active)
    }

    @After
    fun stop() {
        server.shutdown()
    }

    /** The device continues conversation [id] (a New chat, then the first answer of that chat). */
    private suspend fun select(id: String) {
        val fresh = active.startNew()
        active.adopt(id, fresh.epoch)
    }

    /** The turn stream's answer: the finished turn as its `done` event. */
    private fun turnReply(message: String, conversationId: String?) = MockResponse().setBody(
        "event: done\ndata: " + """{"message":"$message","toolCalls":[],"conversationId":${conversationId?.let { "\"$it\"" } ?: "null"}}""" + "\n\n",
    )

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
    fun theStagesTheServerReallyReachesAreReportedWhileTheAnswerIsOnItsWay() = runBlocking<Unit> {
        server.enqueue(
            MockResponse().setBody(
                "event: meta\ndata: {\"conversationId\":\"c1\",\"turnId\":\"t1\"}\n\n" +
                    "event: progress\ndata: {\"type\":\"thinking\",\"step\":1}\n\n" +
                    "event: progress\ndata: {\"type\":\"tool_started\",\"skillId\":\"web.search\",\"toolCallId\":\"x\",\"skillName\":\"Web search\"}\n\n" +
                    "event: done\ndata: {\"message\":\"Found it.\",\"toolCalls\":[],\"conversationId\":\"c1\"}\n\n",
            ),
        )
        val seen = mutableListOf<TurnProgress>()

        val outcome = orchestrator.handleTurn("search the web", "acct") { seen += it }

        assertEquals("/api/v1/orchestrator/turn-stream", server.takeRequest(5, TimeUnit.SECONDS)!!.path)
        assertEquals(listOf(TurnProgress.Thinking, TurnProgress.Working("web.search", "Web search")), seen)
        assertEquals("Found it.", outcome.message)
        assertEquals("c1", store.id)
    }

    @Test
    fun anAiLimitReportedInsideTheStreamIsTheHonestAnswerNotAConnectionError() = runBlocking<Unit> {
        server.enqueue(
            MockResponse().setBody(
                "event: progress\ndata: {\"type\":\"thinking\",\"step\":1}\n\n" +
                    "event: error\ndata: {\"type\":\"AI_QUOTA_EXCEEDED\",\"code\":\"AI_QUOTA_EXCEEDED\",\"error\":\"x\",\"retryable\":false}\n\n",
            ),
        )

        val outcome = orchestrator.handleTurn("hello there", "acct")

        assertTrue(outcome.message, outcome.message.contains("today's AI usage limit"))
        assertEquals(com.zarvismobile.domain.entity.ToolResultStatus.FAILED, outcome.result?.status)
    }

    @Test
    fun aStreamThatStopsBeforeTheAnswerIsAFailureNotAnEmptyReply() = runBlocking<Unit> {
        server.enqueue(MockResponse().setBody("event: progress\ndata: {\"type\":\"thinking\",\"step\":1}\n\n"))
        val failed = runCatching { orchestrator.handleTurn("hello there", "acct") }.exceptionOrNull()
        // The server had started on it: "interrupted" (part of it may have run), not "couldn't reach ZARVIS".
        assertEquals(TurnFailureKind.INTERRUPTED, (failed as TurnFailedException).failure.kind)
        assertTrue(failed.cause is java.io.IOException)
    }

    @Test
    fun theMessageCarriesItsIdAndARetryCarriesTheSameOne() = runBlocking<Unit> {
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"AI service temporarily unavailable","code":"internal_error","retryable":true}"""))
        server.enqueue(turnReply("Done.", "c1"))

        val failed = runCatching { orchestrator.handleTurn("plan my week", "acct", clientTurnId = "android-turn-0001") }.exceptionOrNull()
        assertEquals(TurnFailure(TurnFailureKind.SERVER, retryable = true), (failed as TurnFailedException).failure)
        val retried = orchestrator.handleTurn("plan my week", "acct", clientTurnId = "android-turn-0001")

        val ids = (1..2).map { Json.parseToJsonElement(server.takeRequest(5, TimeUnit.SECONDS)!!.body.readUtf8()).jsonObject["clientTurnId"]?.jsonPrimitive?.content }
        assertEquals(listOf("android-turn-0001", "android-turn-0001"), ids)
        assertEquals("Done.", retried.message)
    }

    @Test
    fun aTurnWithoutAnIdSendsNoneAsBefore() = runBlocking<Unit> {
        server.enqueue(turnReply("Hi.", "c1"))
        orchestrator.handleTurn("hello there", "acct")
        assertNull(Json.parseToJsonElement(server.takeRequest(5, TimeUnit.SECONDS)!!.body.readUtf8()).jsonObject["clientTurnId"])
    }

    @Test
    fun eachFailureIsNamedForWhatHappened() = runBlocking<Unit> {
        suspend fun failureOf(reply: MockResponse): TurnFailure {
            server.enqueue(reply)
            return (runCatching { orchestrator.handleTurn("hello there", "acct") }.exceptionOrNull() as TurnFailedException).failure
        }
        assertEquals(TurnFailure(TurnFailureKind.BUSY, true), failureOf(MockResponse().setResponseCode(409).setBody("""{"error":"still","code":"turn_in_progress","retryable":true}""")))
        assertEquals(TurnFailure(TurnFailureKind.REJECTED, false), failureOf(MockResponse().setResponseCode(400).setBody("""{"error":"utterance is required","code":"invalid_request"}""")))
        assertEquals(TurnFailure(TurnFailureKind.SERVER, true), failureOf(MockResponse().setResponseCode(500).setBody("""{"error":"Internal error","code":"internal_error"}""")))
        // An error inside the stream that is not an AI limit: the server's own words decide, never "check your connection".
        assertEquals(
            TurnFailure(TurnFailureKind.SERVER, true),
            failureOf(MockResponse().setBody("event: error\ndata: {\"error\":\"The request could not be completed.\",\"retryable\":true,\"turnId\":\"t\"}\n\n")),
        )
        assertEquals(
            TurnFailure(TurnFailureKind.BUSY, true),
            failureOf(MockResponse().setBody("event: error\ndata: {\"error\":\"still\",\"code\":\"turn_in_progress\",\"retryable\":true,\"turnId\":\"t\"}\n\n")),
        )
        // The phone never got an answer at all: nothing listens where the server should be.
        val closedPort = java.net.ServerSocket(0).use { it.localPort }
        val unreachable = Retrofit.Builder()
            .baseUrl("http://127.0.0.1:$closedPort/")
            .addConverterFactory(Json { ignoreUnknownKeys = true }.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ZarvisApi::class.java)
        val offline = runCatching { OrchestratorFixture.create(unreachable, ActiveConversation(InMemoryConversationId())).handleTurn("hello there", "acct") }
        assertEquals(TurnFailure(TurnFailureKind.OFFLINE, true), (offline.exceptionOrNull() as TurnFailedException).failure)
    }

    @Test
    fun aTurnThatFailsAfterTheServerNamedItsConversationContinuesThatConversation() = runBlocking<Unit> {
        // The server stores the message in c7 and says so in `meta`, then the stream breaks off before the answer.
        server.enqueue(MockResponse().setBody("event: meta\ndata: {\"conversationId\":\"c7\",\"turnId\":\"t1\"}\n\nevent: progress\ndata: {\"type\":\"thinking\",\"step\":1}\n\n"))
        server.enqueue(turnReply("Here it is.", "c7"))

        val failed = runCatching { orchestrator.handleTurn("plan my trip", "acct", clientTurnId = "android-turn-0002") }.exceptionOrNull()
        assertEquals(TurnFailureKind.INTERRUPTED, (failed as TurnFailedException).failure.kind)
        assertEquals("c7", active.state.value?.id)
        assertEquals("c7", store.id)

        orchestrator.handleTurn("plan my trip", "acct", clientTurnId = "android-turn-0002")
        assertNull(sentConversationId(server.takeRequest(5, TimeUnit.SECONDS)!!))
        assertEquals("the retry goes to the conversation that holds the message", "c7", sentConversationId(server.takeRequest(5, TimeUnit.SECONDS)!!))
    }

    @Test
    fun aRetryableAiLimitSaysSoOnTheOutcome() = runBlocking<Unit> {
        server.enqueue(MockResponse().setResponseCode(429).setBody("""{"error":"busy","code":"AI_RATE_LIMITED","retryable":true}"""))
        server.enqueue(MockResponse().setResponseCode(429).setBody("""{"error":"spent","code":"AI_QUOTA_EXCEEDED","retryable":false}"""))
        assertTrue(orchestrator.handleTurn("hello there", "acct").retryable)
        assertFalse(orchestrator.handleTurn("hello there", "acct").retryable)
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
        assertEquals(listOf(RestoredMessage("user", "first question"), RestoredMessage("assistant", "first answer")), orchestrator.restoreConversation().messages)
        assertEquals("/api/v1/conversations/chat-A/messages", server.takeRequest(5, TimeUnit.SECONDS)!!.path)

        // Switch to chat B: what is restored is B's, and nothing of A's is mixed in.
        orchestrator.startNewConversation()
        select("chat-B") // the device is now in chat B
        server.enqueue(history("chat-B", "user" to "second chat", "assistant" to "second answer"))
        val restored = orchestrator.restoreConversation().messages
        assertEquals(listOf(RestoredMessage("user", "second chat"), RestoredMessage("assistant", "second answer")), restored)
        assertEquals("/api/v1/conversations/chat-B/messages", server.takeRequest(5, TimeUnit.SECONDS)!!.path)
        assertTrue(restored.none { it.content.contains("first") })
    }

    @Test
    fun afterNewChatThereIsNothingToRestoreAndNothingIsRequested() = runBlocking<Unit> {
        store.id = "chat-A"
        orchestrator.startNewConversation()
        assertEquals(emptyList<RestoredMessage>(), orchestrator.restoreConversation().messages)
        assertEquals("no request goes out for a conversation that was left", 0, server.requestCount)
    }

    @Test
    fun aConversationTheServerNoLongerHasIsForgottenNotShown() = runBlocking<Unit> {
        store.id = "gone"
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"not_found"}"""))
        assertEquals(emptyList<RestoredMessage>(), orchestrator.restoreConversation().messages)
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

    @Test
    fun aReplyCarriesTheConversationItWasRecordedUnderAndNewChatChangesIt() = runBlocking<Unit> {
        server.enqueue(turnReply("Hello!", "chat-A"))
        server.enqueue(turnReply("Hello again!", "chat-B"))
        val first = orchestrator.handleTurn("hello there", "acct")
        assertEquals("chat-A", first.conversation?.id)
        assertEquals(active.current(), first.conversation)
        assertTrue(!first.replacedConversation)

        val freshEpoch = orchestrator.startNewConversation().epoch
        assertTrue("New chat is a different conversation from the one before", freshEpoch != first.conversation!!.epoch)
        val second = orchestrator.handleTurn("a different topic", "acct")
        assertEquals("chat-B", second.conversation?.id)
        assertEquals("a first answer gives the fresh chat its id without leaving it", freshEpoch, second.conversation?.epoch)
    }

    @Test
    fun aServerThatDoesNotKnowTheConversationAnswersInANewOneAndTheReplyIsFlagged() = runBlocking<Unit> {
        store.id = "deleted-on-the-web"
        server.enqueue(turnReply("Hello!", "brand-new"))
        val outcome = orchestrator.handleTurn("hello there", "acct")
        assertEquals("deleted-on-the-web", sentConversationId(server.takeRequest(5, TimeUnit.SECONDS)!!))
        assertEquals("brand-new", outcome.conversation?.id)
        assertTrue("the screen must not keep showing the vanished conversation above this reply", outcome.replacedConversation)
        assertEquals("brand-new", store.id)
    }

    @Test
    fun aReplyThatArrivesAfterNewChatKeepsTheStampItWasSentUnderSoEveryScreenCanDiscardIt() = runBlocking<Unit> {
        store.id = "old"
        server.enqueue(turnReply("late reply", "old").setHeadersDelay(300, TimeUnit.MILLISECONDS))
        // A turn that is NOT cancelled (a screen that is not watching): the reply still comes back.
        val sentUnder = active.current()
        val turn = async(Dispatchers.IO) { orchestrator.handleTurn("hello there", "acct") }
        assertNotNull(server.takeRequest(5, TimeUnit.SECONDS))
        val fresh = orchestrator.startNewConversation()
        val outcome = turn.await()
        assertEquals("old", outcome.conversation?.id)
        assertEquals("the reply is stamped with the conversation it was sent under", sentUnder.epoch, outcome.conversation?.epoch)
        assertTrue(outcome.conversation!!.epoch != active.current().epoch)
        assertEquals("and the late reply did not select the old conversation", fresh, active.current())
        assertNull(store.id)
    }

    @Test
    fun restoringSaysWhichConversationItAskedAbout() = runBlocking<Unit> {
        store.id = "chat-A"
        server.enqueue(history("chat-A", "user" to "q", "assistant" to "a"))
        val restored = orchestrator.restoreConversation()
        assertEquals(active.current(), restored.conversation)
        assertEquals("chat-A", restored.conversation.id)
    }

    @Test
    fun aVanishedConversationChangesTheEpochSoEveryScreenDropsIt() = runBlocking<Unit> {
        store.id = "gone"
        val before = active.current()
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"not_found"}"""))
        val restored = orchestrator.restoreConversation()
        assertEquals("the answer is for the conversation that was asked about", before, restored.conversation)
        assertTrue(active.current().epoch != before.epoch)
        assertNull(active.current().id)
    }

    // ---- Delete chat: the server must confirm before any screen drops it ------------------------------------------------------------

    @Test
    fun deletingTheActiveChatAsksTheServerThenEveryScreenLeavesIt() = runBlocking<Unit> {
        store.id = "chat-A"
        val before = active.current()
        server.enqueue(MockResponse().setResponseCode(204))
        assertEquals(ConversationDeletion.DELETED, orchestrator.deleteConversation())
        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("DELETE", request.method)
        assertEquals("/api/v1/conversations/chat-A", request.path)
        assertNull("no conversation is active any more", active.current().id)
        assertTrue("and the epoch changed, so a screen that missed it still drops what it shows", active.current().epoch != before.epoch)
        assertNull("and it is not saved", store.id)
    }

    @Test
    fun aChatTheServerSaysDoesNotExistIsGoneAndTheDeviceLeavesIt() = runBlocking<Unit> {
        store.id = "chat-A"
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"Conversation not found","code":"conversation_not_found"}"""))
        assertEquals(ConversationDeletion.DELETED, orchestrator.deleteConversation())
        assertNull(active.current().id)
    }

    @Test
    fun aServerWithoutTheDeleteRouteIsNotMistakenForADeletedChat() = runBlocking<Unit> {
        // An older backend answers 404 for the unknown route, with no conversation_not_found code: the chat is still there.
        store.id = "chat-A"
        server.enqueue(MockResponse().setResponseCode(404).setBody("<html>Cannot DELETE /api/v1/conversations/chat-A</html>"))
        assertEquals(ConversationDeletion.FAILED, orchestrator.deleteConversation())
        assertEquals("chat-A", active.current().id)
        assertEquals("chat-A", store.id)
    }

    @Test
    fun aServerErrorKeepsTheChatWhereItWas() = runBlocking<Unit> {
        store.id = "chat-A"
        val before = active.current()
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))
        assertEquals(ConversationDeletion.FAILED, orchestrator.deleteConversation())
        assertEquals(before, active.current())
        assertEquals("chat-A", store.id)
    }

    @Test
    fun aLostConnectionKeepsTheChatWhereItWas() = runBlocking<Unit> {
        store.id = "chat-A"
        val before = active.current()
        server.enqueue(MockResponse().setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_AFTER_REQUEST))
        assertEquals(ConversationDeletion.FAILED, orchestrator.deleteConversation())
        assertEquals(before, active.current())
        assertEquals("chat-A", store.id)
    }

    @Test
    fun aChatWithNoServerIdHasNothingToDeleteAndNoRequestIsMade() = runBlocking<Unit> {
        val before = active.current()
        assertNull(before.id)
        assertEquals(ConversationDeletion.NOTHING_SAVED, orchestrator.deleteConversation())
        assertEquals("no request goes out", 0, server.requestCount)
        assertTrue("but the device starts a fresh chat, so the screen is emptied everywhere", active.current().epoch != before.epoch)
    }

    @Test
    fun afterADeleteTheNextMessageStartsAFreshChatAndNeverSendsTheDeletedId() = runBlocking<Unit> {
        store.id = "chat-A"
        server.enqueue(MockResponse().setResponseCode(204))
        server.enqueue(turnReply("Hello!", "chat-B"))
        orchestrator.deleteConversation()
        server.takeRequest(5, TimeUnit.SECONDS)
        val outcome = orchestrator.handleTurn("hello there", "acct")
        assertNull("the deleted chat's id is not sent", sentConversationId(server.takeRequest(5, TimeUnit.SECONDS)!!))
        assertEquals("chat-B", outcome.conversation?.id)
    }
}
