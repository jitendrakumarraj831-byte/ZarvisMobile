package com.zarvismobile.feature.settings

import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.CreateNoteRequest
import com.zarvismobile.data.remote.dto.MemoryForgetResponse
import com.zarvismobile.data.remote.dto.MemoryLimitsDto
import com.zarvismobile.data.remote.dto.MemoryNoteDto
import com.zarvismobile.data.remote.dto.MemoryOverviewResponse
import com.zarvismobile.data.remote.dto.MemoryProjectDto
import com.zarvismobile.data.remote.dto.MemorySettingsRequest
import com.zarvismobile.data.remote.dto.MemorySettingsResponse
import com.zarvismobile.data.remote.dto.UpdateNoteRequest
import java.lang.reflect.Proxy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Browse, delete and forget go to the real memory endpoints and the screen shows what the server answered. The server is a
 * stand-in object that records every call; a failed call must leave the list as it was and say so.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MemoryViewModelTest {
    @Before
    fun mainDispatcher() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun resetDispatcher() = Dispatchers.resetMain()

    private fun note(id: String, content: String, projectId: String? = null, enabled: Boolean = true) =
        MemoryNoteDto(id = id, projectId = projectId, content = content, enabled = enabled)

    private fun overview(personal: List<MemoryNoteDto>, enabled: Boolean = true) = MemoryOverviewResponse(
        enabled = enabled,
        personal = personal,
        projects = listOf(MemoryProjectDto("p1", "Trip", "active", listOf(note("n3", "Hotel is booked", "p1")))),
        limits = MemoryLimitsDto(conversationMessages = 20, memoryItemsUsed = 10),
    )

    /** A ZarvisApi that answers each call from [answer] (by method name) and records the calls in [calls]. */
    private class Server(private val answer: (String, List<Any?>) -> Any?) {
        val calls = mutableListOf<String>()
        val api: ZarvisApi = Proxy.newProxyInstance(ZarvisApi::class.java.classLoader, arrayOf(ZarvisApi::class.java)) { _, method, args ->
            // A suspend function's last argument is the continuation: not part of the request.
            val given = (args ?: emptyArray()).toList().dropLast(1)
            calls += method.name + given.filterNot { it == null }.joinToString(prefix = "(", postfix = ")") { it.toString() }
            answer(method.name, given)
        } as ZarvisApi
    }

    @Test
    fun refreshShowsWhatTheServerHolds() {
        val server = Server { name, _ -> if (name == "getMemory") overview(listOf(note("n1", "I live in Pune"))) else error("unexpected $name") }
        val vm = MemoryViewModel(server.api)
        vm.refresh()

        val state = vm.uiState.value
        assertEquals(listOf("I live in Pune"), state.overview?.personal?.map { it.content })
        assertEquals("Hotel is booked", state.overview?.projects?.single()?.items?.single()?.content)
        assertFalse(state.isLoading)
        assertFalse(state.loadFailed)
    }

    @Test
    fun aFailedLoadIsReportedNotShownAsAnEmptyMemory() {
        val server = Server { _, _ -> throw IllegalStateException("offline") }
        val vm = MemoryViewModel(server.api)
        vm.refresh()

        assertNull(vm.uiState.value.overview)
        assertTrue(vm.uiState.value.loadFailed)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun deletingAnItemDeletesThatNoteThenReadsTheMemoryAgain() {
        var items = listOf(note("n1", "I live in Pune"), note("n2", "Prefers Hindi"))
        val server = Server { name, args ->
            when (name) {
                "getMemory" -> overview(items)
                "deleteNote" -> { items = items.filterNot { it.id == args[0] }; Unit }
                else -> error("unexpected $name")
            }
        }
        val vm = MemoryViewModel(server.api)
        vm.refresh()
        server.calls.clear()

        vm.delete("n1")

        assertEquals(listOf("deleteNote(n1)", "getMemory()"), server.calls)
        assertEquals(listOf("Prefers Hindi"), vm.uiState.value.overview?.personal?.map { it.content })
        assertFalse(vm.uiState.value.busy)
        assertFalse(vm.uiState.value.actionFailed)
    }

    @Test
    fun aDeleteThatFailsLeavesTheListAsItWasAndSaysSo() {
        val server = Server { name, _ ->
            when (name) {
                "getMemory" -> overview(listOf(note("n1", "I live in Pune")))
                else -> throw IllegalStateException("500")
            }
        }
        val vm = MemoryViewModel(server.api)
        vm.refresh()
        server.calls.clear()

        vm.delete("n1")

        assertEquals(listOf("deleteNote(n1)"), server.calls) // no reload that could hide the failure
        assertTrue(vm.uiState.value.actionFailed)
        assertEquals(listOf("I live in Pune"), vm.uiState.value.overview?.personal?.map { it.content })
        assertFalse(vm.uiState.value.busy)
    }

    @Test
    fun forgettingAllPersonalMemoryReportsHowManyWereRemoved() {
        var items = listOf(note("n1", "a"), note("n2", "b"))
        val server = Server { name, _ ->
            when (name) {
                "getMemory" -> overview(items)
                "forgetPersonalMemory" -> MemoryForgetResponse(removed = items.size).also { items = emptyList() }
                else -> error("unexpected $name")
            }
        }
        val vm = MemoryViewModel(server.api)
        vm.refresh()

        vm.forgetAllPersonal()

        assertEquals(2, vm.uiState.value.forgotten)
        assertTrue(vm.uiState.value.overview?.personal?.isEmpty() == true)
        assertEquals("Trip", vm.uiState.value.overview?.projects?.single()?.name) // project memory is untouched
    }

    @Test
    fun pausingMemoryAsksTheServerAndShowsTheNewState() {
        var enabled = true
        val server = Server { name, args ->
            when (name) {
                "getMemory" -> overview(listOf(note("n1", "a")), enabled)
                "setMemoryEnabled" -> MemorySettingsResponse((args[0] as MemorySettingsRequest).enabled).also { enabled = it.enabled }
                else -> error("unexpected $name")
            }
        }
        val vm = MemoryViewModel(server.api)
        vm.refresh()

        vm.setEnabled(false)

        assertTrue(server.calls.any { it.startsWith("setMemoryEnabled") })
        assertEquals(false, vm.uiState.value.overview?.enabled)
    }

    @Test
    fun aReloadThatFailsAfterASuccessfulDeleteKeepsTheLastListButFlagsItAsOld() {
        var offline = false
        val server = Server { name, _ ->
            when (name) {
                "getMemory" -> if (offline) throw IllegalStateException("offline") else overview(listOf(note("n1", "I live in Pune")))
                "deleteNote" -> { offline = true; Unit }
                else -> error("unexpected $name")
            }
        }
        val vm = MemoryViewModel(server.api)
        vm.refresh()

        vm.delete("n1")

        // The delete went through but the list could not be read back: the screen must say the list may be out of date, not show it as current.
        assertTrue(vm.uiState.value.loadFailed)
        assertFalse(vm.uiState.value.actionFailed)
        assertEquals(listOf("I live in Pune"), vm.uiState.value.overview?.personal?.map { it.content })
    }

    @Test
    fun addingSavesTheTrimmedTextAsPersonalMemoryThenReadsTheMemoryAgain() {
        var items = listOf(note("n1", "I live in Pune"))
        val server = Server { name, args ->
            when (name) {
                "getMemory" -> overview(items)
                "createNote" -> (args[0] as CreateNoteRequest).let { request ->
                    note("n2", request.content).also { items = items + it }
                }
                else -> error("unexpected $name")
            }
        }
        val vm = MemoryViewModel(server.api)
        vm.refresh()
        server.calls.clear()

        assertTrue(vm.add("  I am vegetarian  "))

        assertEquals(listOf("createNote(CreateNoteRequest(kind=memory, content=I am vegetarian))", "getMemory()"), server.calls)
        assertEquals(listOf("I live in Pune", "I am vegetarian"), vm.uiState.value.overview?.personal?.map { it.content })
        assertTrue(vm.uiState.value.added)
        assertFalse(vm.uiState.value.busy)
    }

    @Test
    fun emptyOrOverLongTextIsNotSent() {
        val server = Server { name, _ -> if (name == "getMemory") overview(emptyList()) else error("unexpected $name") }
        val vm = MemoryViewModel(server.api)
        vm.refresh()
        server.calls.clear()

        assertFalse(vm.add("   "))
        assertFalse(vm.add("x".repeat(MemoryViewModel.MAX_MEMORY_CHARS + 1)))
        assertTrue("nothing went to the server", server.calls.isEmpty())
        assertFalse(vm.uiState.value.added)
    }

    @Test
    fun aRefusedAddSaysSoAndIsNotShownAsSaved() {
        val server = Server { name, _ ->
            when (name) {
                "getMemory" -> overview(listOf(note("n1", "I live in Pune")))
                "createNote" -> throw IllegalStateException("409 limit_reached")
                else -> error("unexpected $name")
            }
        }
        val vm = MemoryViewModel(server.api)
        vm.refresh()

        vm.add("one more")

        assertTrue(vm.uiState.value.actionFailed)
        assertFalse(vm.uiState.value.added)
        assertEquals(listOf("I live in Pune"), vm.uiState.value.overview?.personal?.map { it.content })
    }

    @Test
    fun pausingOneItemPatchesThatItemOnlyAndShowsItPaused() {
        var items = listOf(note("n1", "I live in Pune"), note("n2", "Prefers Hindi"))
        val server = Server { name, args ->
            when (name) {
                "getMemory" -> overview(items)
                "updateNote" -> {
                    val id = args[0] as String
                    val enabled = (args[1] as UpdateNoteRequest).enabled
                    items = items.map { if (it.id == id) it.copy(enabled = enabled) else it }
                    items.single { it.id == id }
                }
                else -> error("unexpected $name")
            }
        }
        val vm = MemoryViewModel(server.api)
        vm.refresh()
        server.calls.clear()

        vm.setItemEnabled("n2", false)

        assertEquals(listOf("updateNote(n2, UpdateNoteRequest(enabled=false))", "getMemory()"), server.calls)
        assertEquals(listOf(true, false), vm.uiState.value.overview?.personal?.map { it.enabled })
        // Memory as a whole stays on: only that one item is not used.
        assertEquals(true, vm.uiState.value.overview?.enabled)
    }
}
