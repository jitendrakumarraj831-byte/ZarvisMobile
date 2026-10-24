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
import com.zarvismobile.domain.policy.AutomationJournal
import com.zarvismobile.domain.policy.AutomationOutcome
import com.zarvismobile.domain.policy.AutomationPolicy
import com.zarvismobile.domain.policy.AutomationRecord
import com.zarvismobile.domain.policy.AutomationSwitch
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
import org.junit.Assert.assertNull
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

    /** The phone action safety setting and history, as Settings › Phone action safety keeps them. */
    private class Safety : AutomationSwitch, AutomationJournal {
        var paused = false
        val history = mutableListOf<AutomationRecord>()
        override suspend fun isPaused() = paused
        override suspend fun record(entry: AutomationRecord) {
            history += entry
        }
    }

    private lateinit var server: MockWebServer
    private lateinit var launcher: RecordingLauncher
    private val safety = Safety()
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
            onDevicePipeline = ToolPipeline(
                registry, PermissionPort { true }, OrchestratorFixture.unused(), OrchestratorFixture.unused(), confirmations, SystemClockPort,
                automationSwitch = safety, journal = safety,
            ),
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

    private fun action(skillId: String, input: String, then: String? = null, id: String = "tc-1") =
        """{"toolCallId":"$id","skillId":"$skillId","input":$input${then?.let { ",\"then\":\"$it\"" } ?: ""}}"""

    /** The turn stream's answer: the finished turn as its `done` event. */
    private fun streamed(turn: String) = MockResponse().setBody("event: done\ndata: $turn\n\n")

    private fun handoff(skillId: String, input: String, conversationId: String = "c1", then: String? = null) = streamed(
        """{"message":"","toolCalls":[],"conversationId":"$conversationId","deviceAction":${action(skillId, input, then)}}""",
    )

    /** The server's answer to a report that asked for the next step: [next] is the following turn's JSON. */
    private fun continued(next: String) = MockResponse().setBody("""{"recorded":true,"next":$next}""")

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
    fun aReportAnswerThatIsNotJsonDoesNotLoseTheResult() = runBlocking<Unit> {
        server.enqueue(handoff("phone.open_app", """{"appName":"WhatsApp"}""", then = "open the gallery"))
        server.enqueue(MockResponse().setBody("<html>Bad gateway</html>"))

        val outcome = orchestrator.handleTurn("whatsapp chahiye", "acct")

        assertEquals("Opening WhatsApp.", outcome.message)
        assertEquals(ToolResultStatus.COMPLETED, outcome.result?.status)
        assertEquals("nothing more is planned", listOf("WhatsApp"), launcher.asked)
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
    fun aMultiStepRequestRunsEachPlannedStepAndReportsEachRealResult() = runBlocking<Unit> {
        val gallery = action("phone.open_app", """{"appName":"Gallery"}""", id = "tc-2")
        server.enqueue(handoff("phone.open_app", """{"appName":"WhatsApp"}""", then = "open the gallery"))
        server.enqueue(continued("""{"message":"","toolCalls":[],"conversationId":"c1","deviceAction":$gallery}"""))
        server.enqueue(recorded())

        val outcome = orchestrator.handleTurn("whatsapp and then the gallery", "acct")

        assertEquals(listOf("WhatsApp", "Gallery"), launcher.asked)
        assertEquals("Opening WhatsApp.\nOpening Photos.", outcome.message)
        assertEquals(ToolResultStatus.COMPLETED, outcome.result?.status)
        server.takeRequest(5, TimeUnit.SECONDS) // the turn
        val first = body(server.takeRequest(5, TimeUnit.SECONDS)!!)
        assertEquals("open the gallery", first["continueWith"]!!.jsonPrimitive.content)
        assertEquals("1", first["step"]!!.jsonPrimitive.content)
        assertEquals(listOf("phone.open_app"), first["deviceActions"]!!.jsonArray.map { it.jsonPrimitive.content })
        val second = body(server.takeRequest(5, TimeUnit.SECONDS)!!)
        assertEquals("tc-2", second["toolCallId"]!!.jsonPrimitive.content)
        assertEquals("Opening Photos.", second["message"]!!.jsonPrimitive.content)
        assertNull("the last step asks for nothing more", second["continueWith"])
    }

    @Test
    fun aMultiStepRequestEndsWithTheBrainsReplyWhenNothingIsLeft() = runBlocking<Unit> {
        server.enqueue(handoff("phone.open_app", """{"appName":"WhatsApp"}""", then = "nothing else"))
        server.enqueue(continued("""{"message":"WhatsApp is open.","toolCalls":[],"conversationId":"c1"}"""))

        val outcome = orchestrator.handleTurn("whatsapp chahiye", "acct")

        assertEquals("Opening WhatsApp.\nWhatsApp is open.", outcome.message)
        assertEquals(2, server.requestCount)
    }

    @Test
    fun aStepThatFailsEndsTheRequestThere() = runBlocking<Unit> {
        server.enqueue(handoff("phone.open_app", """{"appName":"Snapchat"}""", then = "open the gallery"))
        server.enqueue(recorded())

        val outcome = orchestrator.handleTurn("snapchat chahiye", "acct")

        assertEquals(listOf("Snapchat"), launcher.asked)
        assertEquals(ToolResultStatus.FAILED, outcome.result?.status)
        server.takeRequest(5, TimeUnit.SECONDS)
        assertNull("a failed step is never continued", body(server.takeRequest(5, TimeUnit.SECONDS)!!)["continueWith"])
        assertEquals(2, server.requestCount)
    }

    @Test
    fun theServersReasonForStoppingIsShown() = runBlocking<Unit> {
        server.enqueue(handoff("phone.open_app", """{"appName":"WhatsApp"}""", then = "open the gallery"))
        server.enqueue(MockResponse().setBody("""{"recorded":true,"stopped":"I stopped after 5 phone steps."}"""))

        val outcome = orchestrator.handleTurn("whatsapp chahiye", "acct")

        assertEquals("Opening WhatsApp.\nI stopped after 5 phone steps.", outcome.message)
        assertEquals(listOf("WhatsApp"), launcher.asked)
    }

    @Test
    fun leavingTheChatStopsAMultiStepRequest() = runBlocking<Unit> {
        val gallery = action("phone.open_app", """{"appName":"Gallery"}""", id = "tc-2")
        server.enqueue(handoff("phone.open_app", """{"appName":"WhatsApp"}""", then = "open the gallery"))
        server.enqueue(
            continued("""{"message":"","toolCalls":[],"conversationId":"c1","deviceAction":$gallery}""").setBodyDelay(800, TimeUnit.MILLISECONDS),
        )

        val turn = async(Dispatchers.IO) { orchestrator.handleTurn("whatsapp and then the gallery", "acct") }
        delay(400)
        orchestrator.startNewConversation() // New chat while the next step is being planned
        val outcome = turn.await()

        assertEquals(listOf("WhatsApp"), launcher.asked)
        assertTrue(outcome.message, outcome.message.endsWith("You left this chat, so I stopped there."))
    }

    @Test
    fun ordinaryRepliesAreUnchanged() = runBlocking<Unit> {
        server.enqueue(streamed("""{"message":"Hello!","toolCalls":[],"conversationId":"c1"}"""))

        val outcome = orchestrator.handleTurn("hello there", "acct")

        assertEquals("Hello!", outcome.message)
        assertTrue(launcher.asked.isEmpty())
        assertEquals(1, server.requestCount)
    }

    @Test
    fun everyPhoneActionIsWrittenToThePhonesHistoryAndNothingElseIs() = runBlocking<Unit> {
        server.enqueue(handoff("phone.open_app", """{"appName":"Gallery"}"""))
        server.enqueue(recorded())
        orchestrator.handleTurn("show me my gallery", "acct")
        server.enqueue(streamed("""{"message":"Hello!","toolCalls":[],"conversationId":"c1"}"""))
        orchestrator.handleTurn("hello there", "acct")

        assertEquals(listOf("phone.open_app" to AutomationOutcome.DONE), safety.history.map { it.skillId to it.outcome })
    }

    @Test
    fun whilePhoneActionsArePausedTheBrainIsOfferedNoneAndAnswersInWords() = runBlocking<Unit> {
        safety.paused = true
        server.enqueue(streamed("""{"message":"Open your gallery app from the home screen.","toolCalls":[],"conversationId":"c1"}"""))

        val outcome = orchestrator.handleTurn("show me my gallery", "acct")

        val turn = body(server.takeRequest(5, TimeUnit.SECONDS)!!)
        assertNull("no phone action is offered while they are paused", turn["deviceActions"]?.takeUnless { it is kotlinx.serialization.json.JsonNull })
        assertEquals("Open your gallery app from the home screen.", outcome.message)
        assertTrue(launcher.asked.isEmpty())
    }

    @Test
    fun aPhoneActionHandedOverWhilePausedIsNotRunAndIsReportedAsRefused() = runBlocking<Unit> {
        // A server that hands over an action anyway (an older one, or one that did not see the empty list): the phone still refuses.
        safety.paused = true
        server.enqueue(handoff("phone.open_app", """{"appName":"Gallery"}"""))
        server.enqueue(recorded())

        val outcome = orchestrator.handleTurn("show me my gallery", "acct")

        assertTrue("nothing was opened", launcher.asked.isEmpty())
        assertEquals(ToolResultStatus.DENIED, outcome.result?.status)
        assertTrue(outcome.message, "paused" in outcome.message)
        server.takeRequest(5, TimeUnit.SECONDS)
        val report = body(server.takeRequest(5, TimeUnit.SECONDS)!!)
        assertEquals("DENIED", report["status"]!!.jsonPrimitive.content)
        assertEquals(AutomationOutcome.PAUSED, safety.history.single().outcome)
    }

    @Test
    fun theResultsThatNeverLeaveThePhoneAreTheOnesThePolicyMarksPrivate() {
        assertEquals(AutomationPolicy.default.privateResultSkills, PRIVATE_RESULT_SKILLS)
    }
}
