package com.zarvismobile.agents

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.zarvismobile.core.tooling.ComposeConfirmationPort
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.domain.access.AccessCoordinator
import com.zarvismobile.domain.access.AccessState
import com.zarvismobile.domain.access.PendingAction
import com.zarvismobile.domain.access.PendingActionStore
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.conversation.ActiveConversation
import com.zarvismobile.domain.entity.Reminder
import com.zarvismobile.domain.entity.ToolResultStatus
import com.zarvismobile.domain.port.PermissionPort
import com.zarvismobile.domain.port.SystemClockPort
import com.zarvismobile.domain.skill.ReminderSchedulerPort
import com.zarvismobile.domain.skill.ReminderSkillFactory
import com.zarvismobile.domain.tooling.SkillRegistry
import com.zarvismobile.domain.tooling.ToolPipeline
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit

/**
 * A reminder the Brain hands to the phone, through the real [AndroidOrchestrator], reminder skill and tool pipeline, against a stand-in
 * server that answers as backend/src/api/routes/orchestrator.ts does. The server passes on only the planner's `action` and `title`, and a
 * real model writes the title as a label without the time ("Call mom").
 *
 * Regression: that came back FAILED ("When should I remind you?") and was reported to the server as FAILED, although the user's request
 * ("kal subah 8 baje …") said when. The phone now takes the time from the user's own words.
 */
class AndroidOrchestratorReminderHandoffTest {
    private class Reminders : ReminderSchedulerPort {
        val scheduled = mutableListOf<Reminder>()
        override suspend fun schedule(reminder: Reminder): Reminder = reminder.also { scheduled += it }
        override suspend fun list(): List<Reminder> = scheduled.toList()
        override suspend fun complete(id: String): Boolean = false
    }

    private class InMemoryPendingActions : PendingActionStore {
        override suspend fun save(action: PendingAction) = Unit
        override suspend fun load(): PendingAction? = null
        override suspend fun clear() = Unit
    }

    private lateinit var server: MockWebServer
    private val reminders = Reminders()
    private lateinit var orchestrator: AndroidOrchestrator

    @Before
    fun start() {
        server = MockWebServer().also { it.start() }
        val api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(Json { ignoreUnknownKeys = true }.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ZarvisApi::class.java)
        val registry = SkillRegistry().apply { register(ReminderSkillFactory.create(reminders, SystemClockPort)) }
        val confirmations = ComposeConfirmationPort()
        orchestrator = AndroidOrchestrator(
            onDeviceRegistry = registry,
            // Notifications are allowed (the permission flow has its own tests); a reminder needs no plan or credits.
            onDevicePipeline = ToolPipeline(
                registry, PermissionPort { true }, OrchestratorFixture.unused(), OrchestratorFixture.unused(), confirmations, SystemClockPort,
            ),
            api = api,
            confirmationPort = confirmations,
            capabilities = CapabilityRegistry.loadDefault(),
            access = AccessCoordinator({ AccessState.GRANTED }, OrchestratorFixture.unused(), OrchestratorFixture.unused(), OrchestratorFixture.unused()),
            pendingActions = InMemoryPendingActions(),
            conversation = ActiveConversation(InMemoryConversationId()),
            clock = SystemClockPort,
        )
    }

    @After
    fun stop() {
        server.shutdown()
    }

    /** The turn stream's `done` event: the Brain handed personal.reminder to the phone with [input]. */
    private fun handoff(input: String) = MockResponse().setBody(
        "event: done\ndata: " +
            """{"message":"","toolCalls":[],"conversationId":"c1","deviceAction":{"toolCallId":"tc-1","skillId":"personal.reminder","input":$input}}""" +
            "\n\n",
    )

    @Test
    fun aReminderTheBrainTitledWithoutATimeIsCreatedAtTheTimeTheUserSaidAndReportedDone() = runBlocking<Unit> {
        server.enqueue(handoff("""{"action":"create","title":"Call mom"}"""))
        server.enqueue(MockResponse().setBody("""{"recorded":true}"""))
        val said = "kal subah 8 baje mummy ko call karne ka reminder set kar do"

        val outcome = orchestrator.handleTurn(said, "acct")

        val turn = Json.parseToJsonElement(server.takeRequest(5, TimeUnit.SECONDS)!!.body.readUtf8()).jsonObject
        assertEquals("the phone's own words do not take it (time first), so the Brain was asked", said, turn["utterance"]!!.jsonPrimitive.content)
        assertEquals(outcome.message, ToolResultStatus.COMPLETED, outcome.result?.status)
        val reminder = reminders.scheduled.single()
        val tomorrowAt8 = ZonedDateTime.of(LocalDate.now(ZoneId.systemDefault()).plusDays(1), LocalTime.of(8, 0), ZoneId.systemDefault())
        assertEquals("the time the user said", tomorrowAt8.toInstant(), reminder.dueAt)
        assertEquals("the Brain's title names it", "Call mom", reminder.title)
        assertTrue(outcome.message, outcome.message.startsWith("Reminder set for ") && outcome.message.endsWith(": \"Call mom\"."))

        val report = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/api/v1/orchestrator/device-result", report.path)
        val sent = Json.parseToJsonElement(report.body.readUtf8()).jsonObject
        assertEquals("personal.reminder", sent["skillId"]!!.jsonPrimitive.content)
        assertEquals("COMPLETED", sent["status"]!!.jsonPrimitive.content)
        assertEquals(outcome.message, sent["message"]!!.jsonPrimitive.content)
    }

    @Test
    fun withNoTimeInTheWordsOrTheTitleNothingIsScheduledAndTheUserIsAsked() = runBlocking<Unit> {
        server.enqueue(handoff("""{"action":"create","title":"Drink water"}"""))
        server.enqueue(MockResponse().setBody("""{"recorded":true}"""))

        // "shaam" is a part of the day, not a time: the user is asked rather than given a guessed hour.
        val outcome = orchestrator.handleTurn("roz shaam ko paani peene ka reminder set karo", "acct")

        server.takeRequest(5, TimeUnit.SECONDS)
        assertEquals(ToolResultStatus.FAILED, outcome.result?.status)
        assertTrue(outcome.message, outcome.message.startsWith("When should I remind you?"))
        assertTrue("nothing was scheduled", reminders.scheduled.isEmpty())
        assertEquals("FAILED", Json.parseToJsonElement(server.takeRequest(5, TimeUnit.SECONDS)!!.body.readUtf8()).jsonObject["status"]!!.jsonPrimitive.content)
    }
}
