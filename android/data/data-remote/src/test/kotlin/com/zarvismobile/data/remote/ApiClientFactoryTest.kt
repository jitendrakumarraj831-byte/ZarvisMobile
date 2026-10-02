package com.zarvismobile.data.remote

import org.junit.Assert.assertTrue
import org.junit.Test

class ApiClientFactoryTest {
    @Test
    fun aFullAgentTurnFitsInsideTheClientTimeouts() {
        val client = ApiClientFactory.httpClient(MemorySecretStore(), "http://localhost/")
        // A turn can run a web search and two model calls (each bounded server-side at 90 s by
        // the Gemini request timeout, plus retries) before the JSON response starts.
        assertTrue("read timeout ${client.readTimeoutMillis}", client.readTimeoutMillis >= 120_000)
        assertTrue("call timeout ${client.callTimeoutMillis}", client.callTimeoutMillis >= client.readTimeoutMillis)
        assertTrue("connect timeout ${client.connectTimeoutMillis}", client.connectTimeoutMillis in 5_000..30_000)
    }
}
