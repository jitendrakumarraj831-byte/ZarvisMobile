package com.zarvismobile.agents

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.zarvismobile.core.tooling.ComposeConfirmationPort
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.domain.access.AccessCoordinator
import com.zarvismobile.domain.access.PendingAction
import com.zarvismobile.domain.access.PendingActionStore
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.conversation.ActiveConversation
import com.zarvismobile.domain.entity.ToolResultStatus
import com.zarvismobile.domain.port.PermissionPort
import com.zarvismobile.domain.port.SystemClockPort
import com.zarvismobile.domain.skill.AppLaunchResult
import com.zarvismobile.domain.skill.AppLauncherPort
import com.zarvismobile.domain.skill.PhoneOpenAppSkillFactory
import com.zarvismobile.domain.tooling.SkillRegistry
import com.zarvismobile.domain.tooling.ToolPipeline
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit

/**
 * Brain → device handoff (ZARVIS_ASSISTANT_UPGRADE_PLAN.md Phase 6): the real [AndroidOrchestrator] with the real open-app skill and
 * tool pipeline, against a stand-in server that answers as backend/src/api/routes/orchestrator.ts does. The Brain chooses a phone action;
 * the phone runs it, and what really happened is the reply and is reported back.
 */
class AndroidOrchestratorDeviceActionTest {
    private class RecordingLauncher(private val installed: Map<String, String>) : AppLauncherPort {
        val asked = mutableListOf<String>()
        override suspend fun openApp(appName: String): AppLaunchResult {
            asked += appName
            return installed[appName.lowercase()]?.let { AppLaunchResult.Opened(it) } ?: AppLaunchResult.NotFound
        }
    }

    private class InMemoryPendingActions : PendingActionStore {
        var saved: PendingAction? = null
        override suspend fun save(action: PendingAction) {
            saved = action
        }
        override suspend fun load(): PendingAction? = saved
        override suspend fun clear() {
            saved = null
        }
    }

    private lateinit var server: MockWebServer
    private lateinit var launcher: RecordingLauncher
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
        // The gallery is "Photos" on this phone, as on a Pixel.
        launcher = RecordingLauncher(mapOf("gallery" to "Photos", "whatsapp" to "WhatsApp"))
        val registry = SkillRegistry().apply { register(PhoneOpenAppSkillFactory.create(launcher)) }
        val confirmations = ComposeConfirmationPort()
        active = ActiveConversation(InMemoryConversationId())
        orchestrator = AndroidOrchestrator(
            onDeviceRegistry = registry,
            // Opening an app needs no permission, plan or credits; anything else asked of these stand-ins fails the test.
            onDevicePipeline = ToolPipeline(registry, PermissionPort { true }, OrchestratorFixture.unused(), OrchestratorFixture.unused(), confirmations, SystemClockPort),
            api = api,
            confirmationPort = confirmations,
            capabilities = CapabilityRegistry(emptyList()),
            access = AccessCoordinator(OrchestratorFixture.unused(), OrchestratorFixture.unused(), OrchestratorFixture.unused(), OrchestratorFixture.unused()),
            pendingActions = InMemoryPendingActions(),
            conversation = active,
            clock = SystemClockPort,
        )
    }

    @After
    fun stop() {
        server.shutdown()
    }

    private fun handoff(skillId: String, input: String, conversationId: String = "c1") = MockResponse().setBody(
        """{"message":"","toolCalls":[],"conversationId":"$conversationId",""" +
            """"deviceAction":{"toolCallId":"tc-1","skillId":"$skillId","input":$input}}""",
    )

    private fun recorded() = MockResponse().setBody("""{"recorded":true}""")

    private fun body(request: okhttp3.mockwebserver.RecordedRequest): JsonObject = Json.parseToJsonElement(request.body.readUtf8()).jsonObject

    @Test
    fun theBrainsChosenActionRunsOnThePhoneAndItsRealResultIsTheReplyAndIsReported() = runBlocking<Unit> {
        server.enqueue(handoff("phone.open_app", """{"appName":"Gallery"}"""))
        server.enqueue(recorded())

        val outcome = orchestrator.handleTurn("show me my gallery", "acct")

        val turn = body(server.takeRequest(5, TimeUnit.SECONDS)!!)
        assertEquals("the phone offers the actions it runs", listOf("phone.open_app"), turn["deviceActions"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals("the Brain's app name is what was opened", listOf("Gallery"), launcher.asked)
        assertEquals("Opening Photos.", outcome.message)
        assertEquals(ToolResultStatus.COMPLETED, outcome.result?.status)
        assertEquals("c1", outcome.conversation?.id)

        val report = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/api/v1/orchestrator/device-result", report.path)
        val sent = body(report)
        assertEquals("c1", sent["conversationId"]!!.jsonPrimitive.content)
        assertEquals("tc-1", sent["toolCallId"]!!.jsonPrimitive.content)
        assertEquals("phone.open_app", sent["skillId"]!!.jsonPrimitive.content)
        assertEquals("COMPLETED", sent["status"]!!.jsonPrimitive.content)
        assertEquals("Opening Photos.", sent["message"]!!.jsonPrimitive.content)
    }

    @Test
    fun aFailureIsReportedAsAFailureNeverAsDone() = runBlocking<Unit> {
        server.enqueue(handoff("phone.open_app", """{"appName":"Snapchat"}"""))
        server.enqueue(recorded())

        val outcome = orchestrator.handleTurn("snapchat chahiye", "acct")

        server.takeRequest(5, TimeUnit.SECONDS)
        assertEquals(ToolResultStatus.FAILED, outcome.result?.status)
        assertEquals("I couldn't find an app called \"Snapchat\" on this phone.", outcome.message)
        assertEquals("FAILED", body(server.takeRequest(5, TimeUnit.SECONDS)!!)["status"]!!.jsonPrimitive.content)
    }

    @Test
    fun aRequiredFieldTheBrainLeftOutIsNotGuessedFromTheWords() = runBlocking<Unit> {
        server.enqueue(handoff("phone.open_app", "{}"))
        server.enqueue(recorded())

        val outcome = orchestrator.handleTurn("whatsapp please", "acct")

        assertTrue("nothing was opened", launcher.asked.isEmpty())
        assertTrue(outcome.result?.status != ToolResultStatus.COMPLETED)
    }

    @Test
    fun anActionThisPhoneDoesNotHaveRunsNothingAndSaysSo() = runBlocking<Unit> {
        server.enqueue(handoff("phone.call", """{"target":"Mom"}"""))
        server.enqueue(recorded())

        val outcome = orchestrator.handleTurn("ring my mother", "acct")

        server.takeRequest(5, TimeUnit.SECONDS)
        assertEquals(ToolResultStatus.UNSUPPORTED, outcome.result?.status)
        assertEquals("UNSUPPORTED", body(server.takeRequest(5, TimeUnit.SECONDS)!!)["status"]!!.jsonPrimitive.content)
    }

    @Test
    fun aReportThatCannotBeDeliveredDoesNotLoseTheResult() = runBlocking<Unit> {
        server.enqueue(handoff("phone.open_app", """{"appName":"WhatsApp"}"""))
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))

        val outcome = orchestrator.handleTurn("whatsapp chahiye", "acct")

        assertEquals("Opening WhatsApp.", outcome.message)
        assertEquals(ToolResultStatus.COMPLETED, outcome.result?.status)
    }

    @Test
    fun anActionForAChatTheUserHasLeftIsNotRun() = runBlocking<Unit> {
        server.enqueue(handoff("phone.open_app", """{"appName":"WhatsApp"}""").setBodyDelay(800, TimeUnit.MILLISECONDS))

        val turn = async(Dispatchers.IO) { orchestrator.handleTurn("whatsapp chahiye", "acct") }
        delay(200)
        orchestrator.startNewConversation() // New chat while the answer is on its way
        val outcome = turn.await()

        assertTrue("nothing was opened", launcher.asked.isEmpty())
        assertEquals(ToolResultStatus.FAILED, outcome.result?.status)
        assertEquals("no report for a chat the user left", 1, server.requestCount)
    }

    @Test
    fun ordinaryRepliesAreUnchanged() = runBlocking<Unit> {
        server.enqueue(MockResponse().setBody("""{"message":"Hello!","toolCalls":[],"conversationId":"c1"}"""))

        val outcome = orchestrator.handleTurn("hello there", "acct")

        assertEquals("Hello!", outcome.message)
        assertTrue(launcher.asked.isEmpty())
        assertEquals(1, server.requestCount)
    }
}
