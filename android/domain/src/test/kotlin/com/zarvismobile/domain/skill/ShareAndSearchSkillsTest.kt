package com.zarvismobile.domain.skill

import com.zarvismobile.domain.FakeContactLookupPort
import com.zarvismobile.domain.capability.ActionPolicy
import com.zarvismobile.domain.entity.PreparedAction
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.SkillResult
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ShareAndSearchSkillsTest {
    private val context = SkillExecutionContext(accountId = "acc-1")

    private class RecordingDrafts(private val result: (MessageDraft) -> DraftResult = { DraftResult.Opened(it.appName ?: it.channel.name) }) : MessageDraftPort {
        val opened = mutableListOf<MessageDraft>()
        override suspend fun open(draft: MessageDraft): DraftResult {
            opened += draft
            return result(draft)
        }
    }

    private val contacts = FakeContactLookupPort(
        listOf(PhoneContact("Rahul Sharma", "+91 98765 43210"), PhoneContact("Ram Kumar", "98111 11111"), PhoneContact("Ram Singh", "98222 22222")),
    )

    /** What the tool pipeline does: prepare, then run the handler with the prepared input. */
    private suspend fun run(skill: SkillDefinition, values: Map<String, Any?>): SkillResult =
        when (val prepared = skill.preparer?.prepare(SkillInput(values), context) ?: PreparedAction.Ready("", SkillInput(values))) {
            is PreparedAction.Ready -> skill.handler.execute(prepared.input, context)
            is PreparedAction.Failed -> prepared.failure
        }

    @Test
    fun `a WhatsApp message to a contact opens a draft to that number, which the user sends`() = runTest {
        val drafts = RecordingDrafts()
        val skill = MessageDraftSkillFactory.create(contacts, drafts)
        val result = assertIs<SkillResult.Success>(run(skill, mapOf("text" to "main late hoon", "app" to "WhatsApp", "to" to "rahul")))
        assertEquals(MessageDraft("main late hoon", MessageChannel.WHATSAPP, "WhatsApp", "Rahul Sharma", "+91 98765 43210"), drafts.opened.single())
        assertTrue(result.userActionRequired)
        assertTrue(result.summary.contains("Press Send"))
        assertTrue(result.summary.contains("doesn't send"))
        // Opening a draft sends nothing, so it needs no confirmation of its own.
        assertFalse(ActionPolicy.requiresConfirmation(skill))
    }

    @Test
    fun `a draft never goes to an unknown or ambiguous contact`() = runTest {
        val drafts = RecordingDrafts()
        val skill = MessageDraftSkillFactory.create(contacts, drafts)
        assertEquals("contact_not_found", assertIs<SkillResult.Failure>(run(skill, mapOf("text" to "hi", "app" to "whatsapp", "to" to "Neha"))).reason)
        assertEquals("ambiguous_contact", assertIs<SkillResult.Failure>(run(skill, mapOf("text" to "hi", "to" to "Ram"))).reason)
        assertEquals("missing_text", assertIs<SkillResult.Failure>(run(skill, mapOf("text" to "  ", "to" to "Rahul"))).reason)
        assertTrue(drafts.opened.isEmpty())
    }

    @Test
    fun `the app named decides where the draft opens`() = runTest {
        val drafts = RecordingDrafts()
        val skill = MessageDraftSkillFactory.create(contacts, drafts)
        run(skill, mapOf("text" to "hi", "to" to "98765 43210"))
        run(skill, mapOf("text" to "hi", "app" to "email", "to" to "rahul@example.com"))
        run(skill, mapOf("text" to "hi", "app" to "Telegram", "to" to "Rahul"))
        run(skill, mapOf("text" to "hi"))
        run(skill, mapOf("text" to "hi", "app" to "व्हाट्सएप"))
        assertEquals(
            listOf(
                MessageDraft("hi", MessageChannel.SMS, null, "98765 43210", "9876543210"),
                MessageDraft("hi", MessageChannel.EMAIL, "email", "rahul@example.com", "rahul@example.com"),
                // Telegram cannot be told who it is for: the user picks the chat, and no contact is looked up.
                MessageDraft("hi", MessageChannel.OTHER_APP, "Telegram", "Rahul", null),
                MessageDraft("hi", MessageChannel.ANY_APP, null, null, null),
                MessageDraft("hi", MessageChannel.WHATSAPP, "व्हाट्सएप", null, null),
            ),
            drafts.opened,
        )
    }

    @Test
    fun `contacts are needed only to put a name's number into WhatsApp or SMS`() {
        assertTrue(MessageDraftSkillFactory.needsContacts(mapOf("text" to "hi", "to" to "Rahul")))
        assertTrue(MessageDraftSkillFactory.needsContacts(mapOf("text" to "hi", "app" to "WhatsApp", "to" to "Rahul")))
        assertFalse(MessageDraftSkillFactory.needsContacts(mapOf("text" to "hi", "app" to "WhatsApp", "to" to "+91 98765 43210")))
        assertFalse(MessageDraftSkillFactory.needsContacts(mapOf("text" to "hi", "app" to "Telegram", "to" to "Rahul")))
        assertFalse(MessageDraftSkillFactory.needsContacts(mapOf("text" to "hi", "app" to "email", "to" to "Rahul")))
        assertFalse(MessageDraftSkillFactory.needsContacts(mapOf("text" to "hi")))
    }

    @Test
    fun `an app that cannot take the draft is an honest failure`() = runTest {
        val skill = MessageDraftSkillFactory.create(contacts, RecordingDrafts { DraftResult.Unavailable("WhatsApp isn't installed on this phone.") })
        val failure = assertIs<SkillResult.Failure>(run(skill, mapOf("text" to "hi", "app" to "WhatsApp")))
        assertEquals("WhatsApp isn't installed on this phone.", failure.userMessage)
    }

    @Test
    fun `WhatsApp gets the full international number, from the phone's country when the contact has none`() {
        assertEquals("919876543210", PhoneNumbers.international("98765 43210", "IN"))
        assertEquals("919876543210", PhoneNumbers.international("098765 43210", "in"))
        assertEquals("919876543210", PhoneNumbers.international("+91 98765 43210", null))
        assertEquals("919876543210", PhoneNumbers.international("0091 98765 43210", null))
        assertEquals("919876543210", PhoneNumbers.international("919876543210", "in"))
        // A national number that happens to start with the country code is still a national number.
        assertEquals("919198765432", PhoneNumbers.international("91987 65432", "in"))
        assertEquals("14155551234", PhoneNumbers.international("(415) 555-1234", "us"))
        assertEquals("447700900123", PhoneNumbers.international("07700 900123", "gb"))
        assertNull(PhoneNumbers.international("98765 43210", null))
        assertNull(PhoneNumbers.international("98765 43210", "zz"))
        assertNull(PhoneNumbers.international("112", "in"))
    }

    @Test
    fun `a search opens the app named, and directions only show the route`() = runTest {
        val asked = mutableListOf<Pair<SearchTarget, String>>()
        val skill = AppSearchSkillFactory.create { target, query ->
            asked += target to query
            SearchShown.Shown(if (target == SearchTarget.WEB) "Chrome" else target.displayName)
        }
        val youtube = assertIs<SkillResult.Success>(run(skill, mapOf("query" to "arijit songs", "app" to "YouTube")))
        assertEquals("Searching YouTube for \"arijit songs\".", youtube.summary)
        assertFalse(youtube.userActionRequired)
        val route = assertIs<SkillResult.Success>(run(skill, mapOf("query" to "airport", "app" to "Directions")))
        assertTrue(route.userActionRequired)
        assertTrue(route.summary.contains("Press Start"))
        run(skill, mapOf("query" to "best laptop"))
        run(skill, mapOf("query" to "whatsapp", "app" to "play store"))
        run(skill, mapOf("query" to "pizza", "app" to "मैप"))
        assertEquals(
            listOf(
                SearchTarget.YOUTUBE to "arijit songs", SearchTarget.DIRECTIONS to "airport", SearchTarget.WEB to "best laptop",
                SearchTarget.PLAY_STORE to "whatsapp", SearchTarget.MAPS to "pizza",
            ),
            asked,
        )
        assertEquals("unsupported_search_app", assertIs<SkillResult.Failure>(run(skill, mapOf("query" to "x", "app" to "Netflix"))).reason)
        assertEquals(5, asked.size)
    }
}
