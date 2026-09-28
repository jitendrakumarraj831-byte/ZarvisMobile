package com.zarvismobile.data.repository

import com.zarvismobile.core.security.SecretStore
import com.zarvismobile.data.remote.ApiClientFactory
import com.zarvismobile.data.remote.SessionEvents
import com.zarvismobile.data.remote.TokenStorageKeys
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

private class MemoryStore : SecretStore {
    val values = mutableMapOf<String, String>()
    override fun putString(key: String, value: String) { values[key] = value }
    override fun getString(key: String): String? = values[key]
    override fun remove(key: String) { values.remove(key) }
}

/** Real Retrofit/OkHttp stack (ApiClientFactory) against a local HTTP server. */
class SessionRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var store: MemoryStore

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        store = MemoryStore()
        SessionEvents.clear()
    }

    @After
    fun tearDown() {
        server.shutdown()
        SessionEvents.clear()
    }

    private fun repo() = SessionRepository(ApiClientFactory.create(store, server.url("/").toString()), store)

    private fun signedIn() {
        store.putString(TokenStorageKeys.ACCESS_TOKEN, "a1")
        store.putString(TokenStorageKeys.REFRESH_TOKEN, "r1")
        store.putString(TokenStorageKeys.ACCOUNT_ID, "acct-1")
        store.putString(TokenStorageKeys.IS_GUEST, "false")
        store.putString(TokenStorageKeys.EMAIL, "a@b.co")
    }

    @Test
    fun `first launch creates exactly one guest account`() = runTest {
        server.enqueue(MockResponse().setBody("""{"accessToken":"a","refreshToken":"r","accountId":"guest-1","isGuest":true}"""))
        val repo = repo()

        assertEquals("guest-1", repo.ensureSession())
        assertEquals("guest-1", repo.ensureSession())
        assertEquals(1, server.requestCount)
        assertEquals("/api/v1/auth/guest", server.takeRequest().path)
    }

    @Test
    fun `an active session is reused without any network call`() = runTest {
        signedIn()
        assertEquals("acct-1", repo().ensureSession())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `server-ended session surfaces Expired and never creates a replacement account`() = runTest {
        signedIn()
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"code":"session_revoked"}"""))
        val repo = repo()

        runCatching { ApiClientFactory.create(store, server.url("/").toString()).me() }

        val state = repo.refreshState()
        assertTrue(state is SessionState.Expired)
        assertEquals("a@b.co", (state as SessionState.Expired).lastEmail)
        try {
            repo.ensureSession()
            fail("ensureSession must not silently start a new account")
        } catch (e: SessionExpiredException) {
            assertEquals("session_revoked", e.reason)
        }
        assertEquals(2, server.requestCount)
        assertEquals("/api/v1/auth/me", server.takeRequest().path)
        assertEquals("/api/v1/auth/refresh", server.takeRequest().path)
    }

    @Test
    fun `backend outage keeps the same account active`() = runTest {
        signedIn()
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(502))
        val repo = repo()

        runCatching { ApiClientFactory.create(store, server.url("/").toString()).me() }

        assertEquals(SessionState.Active("acct-1", isGuest = false, email = "a@b.co"), repo.refreshState())
        assertEquals("acct-1", repo.ensureSession())
        assertEquals(2, server.requestCount)
    }

    @Test
    fun `starting a new guest after expiry is an explicit action that replaces the stale identity`() = runTest {
        signedIn()
        store.putString(TokenStorageKeys.SESSION_EXPIRED, "session_revoked")
        server.enqueue(MockResponse().setBody("""{"accessToken":"a","refreshToken":"r","accountId":"guest-2","isGuest":true}"""))
        val repo = repo()

        assertEquals("guest-2", repo.startGuestSession())
        assertEquals(SessionState.Active("guest-2", isGuest = true, email = null), repo.state.value)
        assertEquals(null, store.getString(TokenStorageKeys.EMAIL))
    }
}
