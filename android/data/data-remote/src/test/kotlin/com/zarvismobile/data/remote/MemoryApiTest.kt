package com.zarvismobile.data.remote

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.zarvismobile.data.remote.dto.MemorySettingsRequest
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Retrofit

/**
 * The Memory and task calls against a stand-in server that answers exactly as the backend does
 * (backend/src/api/routes/notes.ts memoryRouter, workspace/views.ts noteView, tasks/taskView.ts): the right
 * method and path go out, and the real response bodies decode.
 */
class MemoryApiTest {
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

    private val overview = """
        {"enabled":true,
         "personal":[{"id":"n1","projectId":null,"kind":"memory","content":"I live in Pune","enabled":true,"sources":[],"executionId":null,
                      "createdAt":"2026-10-10T10:00:00.000Z","updatedAt":"2026-10-10T10:05:00.000Z"},
                     {"id":"n2","projectId":null,"kind":"memory","content":"Prefers Hindi","enabled":false,"sources":[],"executionId":null,
                      "createdAt":"2026-10-10T10:00:00.000Z","updatedAt":"2026-10-10T10:00:00.000Z"}],
         "projects":[{"id":"p1","name":"Trip","status":"active",
                      "items":[{"id":"n3","projectId":"p1","kind":"memory","content":"Hotel is booked","enabled":true,"sources":[],"executionId":null,
                                "createdAt":"2026-10-10T10:00:00.000Z","updatedAt":"2026-10-10T10:00:00.000Z"}]}],
         "limits":{"conversationMessages":20,"memoryItemsUsed":10}}
    """.trimIndent()

    @Test
    fun theMemoryOverviewIsReadFromTheMemoryEndpointAndDecodes() = runBlocking<Unit> {
        server.enqueue(MockResponse().setBody(overview))
        val memory = api.getMemory()

        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/api/v1/memory", request.path)

        assertTrue(memory.enabled)
        assertEquals(listOf("I live in Pune", "Prefers Hindi"), memory.personal.map { it.content })
        assertEquals(listOf(true, false), memory.personal.map { it.enabled })
        assertNull(memory.personal[0].projectId)
        assertEquals("Trip", memory.projects.single().name)
        assertEquals("Hotel is booked", memory.projects.single().items.single().content)
        assertEquals(20, memory.limits.conversationMessages)
        assertEquals(10, memory.limits.memoryItemsUsed)
    }

    @Test
    fun anEmptyMemoryDecodes() = runBlocking<Unit> {
        server.enqueue(MockResponse().setBody("""{"enabled":false,"personal":[],"projects":[],"limits":{"conversationMessages":20,"memoryItemsUsed":10}}"""))
        val memory = api.getMemory()
        assertFalse(memory.enabled)
        assertTrue(memory.personal.isEmpty() && memory.projects.isEmpty())
    }

    @Test
    fun pausingMemorySendsAPutWithTheFlagAndReadsTheAnswer() = runBlocking<Unit> {
        server.enqueue(MockResponse().setBody("""{"enabled":false}"""))
        val answer = api.setMemoryEnabled(MemorySettingsRequest(enabled = false))

        val request = server.takeRequest()
        assertEquals("PUT", request.method)
        assertEquals("/api/v1/memory/settings", request.path)
        assertEquals("""{"enabled":false}""", request.body.readUtf8())
        assertFalse(answer.enabled)
    }

    @Test
    fun forgettingPersonalMemoryIsADeleteAndReportsHowManyWereRemoved() = runBlocking<Unit> {
        server.enqueue(MockResponse().setBody("""{"removed":2}"""))
        val answer = api.forgetPersonalMemory()

        val request = server.takeRequest()
        assertEquals("DELETE", request.method)
        assertEquals("/api/v1/memory/personal", request.path)
        assertEquals(2, answer.removed)
    }

    @Test
    fun deletingOneNoteAcceptsTheServersEmpty204() = runBlocking<Unit> {
        server.enqueue(MockResponse().setResponseCode(204))
        api.deleteNote("n1")

        val request = server.takeRequest()
        assertEquals("DELETE", request.method)
        assertEquals("/api/v1/notes/n1", request.path)
    }

    @Test
    fun aServerErrorSurfacesAsAnHttpExceptionNotAsSuccess() = runBlocking<Unit> {
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":"boom"}"""))
        try {
            api.getMemory()
            fail("a 500 must not look like an empty memory")
        } catch (e: HttpException) {
            assertEquals(500, e.code())
        }
    }

    @Test
    fun aTaskCarriesTheLifecycleWhenTheServerSendsOneAndStillReadsWithout() = runBlocking<Unit> {
        server.enqueue(
            MockResponse().setBody(
                """{"tasks":[
                    {"id":"t1","accountId":"a","goal":"Plan the trip","status":"RUNNING","lifecycle":"WAITING","riskLevel":"LOW","createdAt":"2026-10-10T10:00:00.000Z",
                     "steps":[],"progress":{"done":0,"total":0},"actions":["run","cancel"],"stale":false,"runsInBackground":false},
                    {"id":"t2","accountId":"a","goal":"Old server","status":"DONE","riskLevel":"MEDIUM","createdAt":"2026-10-10T10:00:00.000Z"}]}""",
            ),
        )
        val tasks = api.getTasks().tasks
        assertEquals("WAITING", tasks[0].lifecycle)
        assertNull(tasks[1].lifecycle)
        assertEquals("DONE", tasks[1].status)
    }
}
