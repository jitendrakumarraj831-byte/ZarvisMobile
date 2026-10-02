package com.zarvismobile.data.remote

import com.zarvismobile.core.security.SecretStore
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class MemorySecretStore : SecretStore {
    val values = mutableMapOf<String, String>()
    override fun putString(key: String, value: String) { values[key] = value }
    override fun getString(key: String): String? = values[key]
    override fun remove(key: String) { values.remove(key) }
}

/**
 * The refresh path must never replace the account: only an explicit server session_* code
 * ends the session; every other failure keeps the same account's tokens.
 */
class TokenAuthenticatorTest {
    private lateinit var server: MockWebServer
    private lateinit var store: MemorySecretStore
    private lateinit var client: OkHttpClient

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        store = MemorySecretStore().apply {
            putString(TokenStorageKeys.ACCESS_TOKEN, "old-access")
            putString(TokenStorageKeys.REFRESH_TOKEN, "old-refresh")
            putString(TokenStorageKeys.ACCOUNT_ID, "acct-1")
        }
        SessionEvents.clear()
        client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(store))
            .authenticator(TokenAuthenticator(server.url("/").toString(), store))
            .build()
    }

    @After
    fun tearDown() {
        server.shutdown()
        SessionEvents.clear()
    }

    private fun call(): Int = client.newCall(Request.Builder().url(server.url("/api/v1/auth/me")).build()).execute().use { it.code }

    private fun paths(): List<String> = List(server.requestCount) { server.takeRequest().path!! }

    @Test
    fun `refresh success retries the request with the rotated token for the same account`() {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setBody("""{"accessToken":"new-access","refreshToken":"new-refresh","accountId":"acct-1","isGuest":false,"email":"a@b.co"}"""))
        server.enqueue(MockResponse().setBody("{}"))

        assertEquals(200, call())
        server.takeRequest()
        val refresh = server.takeRequest()
        assertEquals("/api/v1/auth/refresh", refresh.path)
        assertEquals(true, refresh.body.readUtf8().contains("old-refresh"))
        assertEquals("Bearer new-access", server.takeRequest().getHeader("Authorization"))
        assertEquals("new-refresh", store.getString(TokenStorageKeys.REFRESH_TOKEN))
        assertEquals("acct-1", store.getString(TokenStorageKeys.ACCOUNT_ID))
        assertNull(SessionEvents.expired.value)
    }

    @Test
    fun `server-rejected session clears tokens and marks expired without creating an account`() {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"x","code":"refresh_token_reused"}"""))

        assertEquals(401, call())
        assertEquals(listOf("/api/v1/auth/me", "/api/v1/auth/refresh"), paths())
        assertNull(store.getString(TokenStorageKeys.ACCESS_TOKEN))
        assertNull(store.getString(TokenStorageKeys.REFRESH_TOKEN))
        assertEquals("refresh_token_reused", store.getString(TokenStorageKeys.SESSION_EXPIRED))
        assertEquals("refresh_token_reused", SessionEvents.expired.value)
    }

    @Test
    fun `server error during refresh keeps the same account`() {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(503))

        assertEquals(401, call())
        assertEquals(listOf("/api/v1/auth/me", "/api/v1/auth/refresh"), paths())
        assertEquals("old-refresh", store.getString(TokenStorageKeys.REFRESH_TOKEN))
        assertEquals("acct-1", store.getString(TokenStorageKeys.ACCOUNT_ID))
        assertNull(SessionEvents.expired.value)
    }

    @Test
    fun `401 without a session code (proxy or captive portal) keeps the account`() {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(401).setBody("<html>login to wifi</html>"))

        assertEquals(401, call())
        assertEquals("old-refresh", store.getString(TokenStorageKeys.REFRESH_TOKEN))
        assertNull(store.getString(TokenStorageKeys.SESSION_EXPIRED))
    }

    @Test
    fun `network failure during refresh keeps the account`() {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))

        assertEquals(401, call())
        assertEquals("old-refresh", store.getString(TokenStorageKeys.REFRESH_TOKEN))
        assertNull(SessionEvents.expired.value)
    }

    @Test
    fun `a token already rotated by another request is reused instead of refreshing again`() {
        // The failed request carried "stale"; storage already holds a newer token.
        store.putString(TokenStorageKeys.ACCESS_TOKEN, "fresh")
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setBody("{}"))
        val plain = OkHttpClient.Builder().authenticator(TokenAuthenticator(server.url("/").toString(), store)).build()

        val code = plain.newCall(
            Request.Builder().url(server.url("/api/v1/auth/me")).header("Authorization", "Bearer stale").build(),
        ).execute().use { it.code }

        assertEquals(200, code)
        assertEquals(listOf("/api/v1/auth/me", "/api/v1/auth/me"), paths())
    }

    @Test
    fun `retries at most once`() {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setBody("""{"accessToken":"a2","refreshToken":"r2","accountId":"acct-1"}"""))
        server.enqueue(MockResponse().setResponseCode(401))

        assertEquals(401, call())
        assertEquals(3, server.requestCount)
    }

    @Test
    fun `a refresh that reached the server is never silently re-sent`() {
        val authenticator = TokenAuthenticator(server.url("/").toString(), store)
        // First refresh succeeds and leaves a pooled connection...
        server.enqueue(MockResponse().setBody("""{"accessToken":"a2","refreshToken":"r2","accountId":"acct-1","isGuest":false,"email":null}"""))
        assertEquals(TokenAuthenticator.RefreshOutcome.Refreshed("a2"), authenticator.refresh())
        // ...which the server drops after reading the next refresh. Re-sending it would present
        // the rotated refresh token twice and the server would revoke the whole session.
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"code":"refresh_token_reused"}"""))
        assertEquals(TokenAuthenticator.RefreshOutcome.Unreachable, authenticator.refresh())
        assertEquals("the second refresh reached the server exactly once", 2, server.requestCount)
        assertEquals("r2", store.getString(TokenStorageKeys.REFRESH_TOKEN))
    }
}
