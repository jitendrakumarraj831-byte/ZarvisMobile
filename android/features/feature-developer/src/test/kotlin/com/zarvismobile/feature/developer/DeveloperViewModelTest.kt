package com.zarvismobile.feature.developer

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.zarvismobile.data.remote.ZarvisApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit

/**
 * The Developer screen shows the analysis, or the server's own words for why there is none — never an exception's text. The server is
 * a stand-in that answers exactly as backend/src/api/routes/developer.ts does (`{...outcome, structured}`).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DeveloperViewModelTest {
    private lateinit var server: MockWebServer

    @Before
    fun start() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = MockWebServer().also { it.start() }
    }

    @After
    fun stop() {
        server.shutdown()
        Dispatchers.resetMain()
    }

    private fun analyze(vararg responses: MockResponse): DeveloperUiState = runBlocking {
        responses.forEach(server::enqueue)
        val api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(Json { ignoreUnknownKeys = true }.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ZarvisApi::class.java)
        val vm = DeveloperViewModel(api)
        vm.onRepoUrlChange("https://github.com/a/b")
        vm.analyze()
        // The call runs on OkHttp's thread; wait for the screen to leave "analyzing".
        withTimeout(10_000) { vm.uiState.first { !it.isAnalyzing } }
    }

    @Test
    fun aSuccessShowsTheStructureAndTheSummary() {
        val state = analyze(
            MockResponse().setBody(
                """{"kind":"success","chargedCredits":0,
                    "result":{"kind":"success","summary":"Analyzed it.",
                              "output":{"structure":{"repoUrl":"https://github.com/a/b","primaryLanguage":"Kotlin","buildSystem":"Gradle",
                                        "hasTests":true,"hasCi":false,"fileCount":7,"topLevelDirs":["app"]},"githubLogin":null}},
                    "structured":{"success":true,"status":"COMPLETED","skillId":"developer.analyze_repo","userSafeMessage":"Analyzed it."}}""",
            ),
        )
        assertEquals("Kotlin", state.result?.primaryLanguage)
        assertEquals("Analyzed it.", state.summary)
        assertNull(state.error)
    }

    @Test
    fun aFailedRunShowsTheServersOwnWords() {
        val state = analyze(
            MockResponse().setBody(
                """{"kind":"execution_failed",
                    "result":{"kind":"failure","reason":"repo_not_found","userMessage":"That repository doesn't exist or isn't public."},
                    "structured":{"success":false,"status":"FAILED","skillId":"developer.analyze_repo",
                                  "userSafeMessage":"That repository doesn't exist or isn't public.","retryable":false}}""",
            ),
        )
        assertNull(state.result)
        assertEquals("Analysis was not completed: That repository doesn't exist or isn't public.", state.error)
    }

    @Test
    fun aRefusedRequestShowsTheServersReason() {
        val state = analyze(MockResponse().setResponseCode(400).setBody("""{"error":"repoUrl is required"}"""))
        assertEquals("repoUrl is required", state.error)
    }

    @Test
    fun aDroppedConnectionSaysSoInsteadOfTheExceptionText() {
        // Three refusals: this test's plain client retries a dropped connection by itself, and meets the same refusal.
        val state = analyze(*Array(3) { MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START) })
        assertEquals("Couldn't reach ZARVIS, so nothing was analyzed. Check your connection and try again.", state.error)
    }
}
