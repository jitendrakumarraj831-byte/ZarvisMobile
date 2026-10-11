package com.zarvismobile.agents

import com.zarvismobile.core.security.SecretStore
import com.zarvismobile.data.remote.ApiClientFactory
import com.zarvismobile.data.remote.TokenAuthenticator
import com.zarvismobile.domain.conversation.ActiveConversation
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * The Android client code against a RUNNING backend: the production HTTP stack (`ApiClientFactory`, with its auth and retry interceptors),
 * the DTOs, the orchestrator and the active-conversation logic, talking to a real ZARVIS backend over HTTP. It is skipped unless
 * `ZARVIS_LIVE_BASE_URL` is set, so a normal build never touches a network:
 *
 *     cd android && ZARVIS_LIVE_BASE_URL=http://localhost:3000/ ./gradlew :agents:testDebugUnitTest --tests '*LiveBackendConversationTest*'
 *
 * It creates a guest account and two conversations on that backend and deletes the account at the end, so point it at a local or staging
 * backend, never at production. Greetings are answered by the backend itself, so no AI key is needed. This runs on the JVM: it does not
 * involve an emulator or a phone, so it says nothing about a device's network path to the backend.
 */
class LiveBackendConversationTest {
    private class Secrets : SecretStore {
        private val values = mutableMapOf<String, String>()
        override fun putString(key: String, value: String) { values[key] = value }
        override fun getString(key: String): String? = values[key]
        override fun remove(key: String) { values.remove(key) }
    }

    @Test
    fun guestSignInTurnsNewChatAndRestoreWorkAgainstTheRealBackend() = runBlocking<Unit> {
        val configured = System.getenv("ZARVIS_LIVE_BASE_URL")?.trim()?.ifEmpty { null }
        assumeTrue("set ZARVIS_LIVE_BASE_URL (for example http://localhost:3000/) to run this against a backend", configured != null)
        val baseUrl = configured!!.let { if (it.endsWith("/")) it else "$it/" }

        val secrets = Secrets()
        val api = ApiClientFactory.create(secrets, baseUrl)
        val tokens = api.createGuest()
        TokenAuthenticator.storeTokens(secrets, tokens)
        try {
            val orchestrator = OrchestratorFixture.create(api, ActiveConversation(InMemoryConversationId()))

            // A first message starts a conversation on the server.
            val first = orchestrator.handleTurn("hello", tokens.accountId)
            val firstId = assertNotNull("the server must answer with a conversation id", first.conversation?.id).let { first.conversation!!.id!! }
            val firstHistory = orchestrator.restoreConversation().messages
            assertEquals(listOf("user", "assistant"), firstHistory.map { it.role })
            assertEquals("hello", firstHistory.first().content)

            // New chat: the next message starts a different conversation, and restoring shows only that one.
            orchestrator.startNewConversation()
            val second = orchestrator.handleTurn("hey zarvis", tokens.accountId)
            val secondId = second.conversation!!.id!!
            assertTrue("a New chat must be a new server conversation", secondId != firstId)
            val secondHistory = orchestrator.restoreConversation().messages
            assertEquals("hey zarvis", secondHistory.first().content)
            assertTrue(secondHistory.none { it.content == "hello" })

            // The first conversation is still there, unchanged.
            assertEquals("hello", api.conversationMessages(firstId).messages.first().content)

            // The other calls the screens make decode the backend's real payloads.
            api.getMemory()
            api.getTasks()
            api.getEntitlements()
        } finally {
            runCatching { api.deleteAccount() }
        }
    }
}
