package com.zarvismobile.data.remote

import okhttp3.Authenticator
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

/**
 * A POST that reached the server must never be sent a second time behind the user's back:
 * for /orchestrator/turn that is a second agent turn (and AI call).
 */
class SafeRetryInterceptorTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
    }

    @After
    fun tearDown() = server.shutdown()

    private val refresh = Authenticator { _, response ->
        if (response.request.header("Authorization") != null) null
        else response.request.newBuilder().header("Authorization", "Bearer rotated").build()
    }

    /** The production configuration (see ApiClientFactory.httpClient). */
    private fun client() = OkHttpClient.Builder()
        .addInterceptor(SafeRetryInterceptor())
        .retryOnConnectionFailure(false)
        .authenticator(refresh)
        .build()

    private fun post(client: OkHttpClient): Int =
        client.newCall(
            Request.Builder().url(server.url("/api/v1/orchestrator/turn"))
                .post("""{"utterance":"hi"}""".toRequestBody("application/json".toMediaType()))
                .build(),
        ).execute().use { it.code }

    private fun get(client: OkHttpClient, path: String): Int =
        client.newCall(Request.Builder().url(server.url(path)).build()).execute().use { it.code }

    /** Leaves a pooled connection that the server drops right after reading the next request. */
    private fun primeStaleConnection(client: OkHttpClient) {
        server.enqueue(MockResponse().setBody("{}"))
        assertEquals(200, get(client, "/health"))
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        server.enqueue(MockResponse().setBody("{}"))
    }

    @Test
    fun plainOkHttpSilentlyResendsAPostThatAlreadyReachedTheServer() {
        // Control: the failure mode is real for a default client.
        val plain = OkHttpClient()
        primeStaleConnection(plain)
        assertEquals(200, post(plain))
        assertEquals("the same POST reached the server twice", 3, server.requestCount)
    }

    @Test
    fun aTurnThatReachedTheServerIsNotSentAgain() {
        val client = client()
        primeStaleConnection(client)
        val failed = runCatching { post(client) }.exceptionOrNull()
        assertTrue("the dropped turn surfaces as an error, got $failed", failed is IOException)
        assertEquals("the POST reached the server exactly once", 2, server.requestCount)
    }

    @Test
    fun aPostRejectedWith401IsStillReplayedAfterTheTokenRefresh() {
        val client = client()
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setBody("{}"))
        assertEquals(200, post(client))
        assertEquals(2, server.requestCount)
    }

    @Test
    fun anIdempotentGetIsRetriedOnceOverAStaleConnection() {
        val client = client()
        primeStaleConnection(client)
        assertEquals(200, get(client, "/api/v1/auth/me"))
        assertEquals(3, server.requestCount)
    }
}
