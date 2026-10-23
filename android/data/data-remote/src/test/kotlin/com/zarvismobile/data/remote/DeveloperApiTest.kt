package com.zarvismobile.data.remote

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.zarvismobile.data.remote.dto.DeveloperAnalyzeRequest
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit

/**
 * `POST /api/v1/developer/analyze` answers `{...outcome, structured}` (backend/src/api/routes/developer.ts). The success body and the
 * failure bodies the pipeline really produces must all decode: a failed analysis used to be a decoding error, shown as such.
 */
class DeveloperApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: ZarvisApi

    @Before
    fun start() {
        server = MockWebServer().also { it.start() }
        api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(Json { ignoreUnknownKeys = true }.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ZarvisApi::class.java)
    }

    @After
    fun stop() {
        server.shutdown()
    }

    @Test
    fun aSuccessfulAnalysisDecodesWithItsStructure() = runBlocking<Unit> {
        server.enqueue(
            MockResponse().setBody(
                """{"kind":"success","chargedCredits":0,
                    "result":{"kind":"success","summary":"Analyzed https://github.com/a/b: primarily Kotlin.",
                              "output":{"structure":{"repoUrl":"https://github.com/a/b","primaryLanguage":"Kotlin","buildSystem":"Gradle",
                                        "hasTests":true,"hasCi":true,"fileCount":42,"topLevelDirs":["app","domain"]},"githubLogin":null}},
                    "structured":{"success":true,"status":"COMPLETED","capabilityId":null,"skillId":"developer.analyze_repo",
                                  "userSafeMessage":"Analyzed https://github.com/a/b: primarily Kotlin.","retryable":false}}""",
            ),
        )
        val answer = api.analyzeRepo(DeveloperAnalyzeRequest("https://github.com/a/b"))

        assertEquals("/api/v1/developer/analyze", server.takeRequest().path)
        assertEquals("success", answer.kind)
        assertEquals("Kotlin", answer.result?.output?.structure?.primaryLanguage)
        assertEquals(42, answer.result?.output?.structure?.fileCount)
        assertEquals("COMPLETED", answer.structured?.status)
    }

    @Test
    fun aFailedAnalysisDecodesWithTheServersOwnWords() = runBlocking<Unit> {
        server.enqueue(
            MockResponse().setBody(
                """{"kind":"execution_failed",
                    "result":{"kind":"failure","reason":"repo_not_found","userMessage":"That repository doesn't exist or isn't public."},
                    "structured":{"success":false,"status":"FAILED","skillId":"developer.analyze_repo",
                                  "userSafeMessage":"That repository doesn't exist or isn't public.","retryable":false}}""",
            ),
        )
        val answer = api.analyzeRepo(DeveloperAnalyzeRequest("https://github.com/a/missing"))

        assertEquals("execution_failed", answer.kind)
        assertNull(answer.result?.output)
        assertEquals("repo_not_found", answer.result?.reason)
        assertEquals("That repository doesn't exist or isn't public.", answer.result?.userMessage)
        assertEquals("That repository doesn't exist or isn't public.", answer.structured?.userSafeMessage)
    }

    @Test
    fun aDenialWithoutAResultDecodes() = runBlocking<Unit> {
        server.enqueue(
            MockResponse().setBody(
                """{"kind":"entitlement_denied","decision":{"allowed":false,"reason":"OUT_OF_CREDITS"},
                    "structured":{"success":false,"status":"DENIED","skillId":"developer.analyze_repo",
                                  "userSafeMessage":"You're out of credits for this action.","retryable":false}}""",
            ),
        )
        val answer = api.analyzeRepo(DeveloperAnalyzeRequest("https://github.com/a/b"))

        assertEquals("entitlement_denied", answer.kind)
        assertNull(answer.result)
        assertEquals("You're out of credits for this action.", answer.structured?.userSafeMessage)
    }
}
