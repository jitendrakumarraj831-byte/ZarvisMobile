package com.zarvismobile.feature.settings

import com.zarvismobile.domain.policy.AutomationHistory
import com.zarvismobile.domain.policy.AutomationHistoryStore
import com.zarvismobile.domain.policy.AutomationOutcome
import com.zarvismobile.domain.policy.AutomationPauseStore
import com.zarvismobile.domain.policy.AutomationRecord
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
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

/** Settings › Phone action safety shows exactly what the phone's store holds, and a change that fails says so. */
@OptIn(ExperimentalCoroutinesApi::class)
class PhoneSafetyViewModelTest {
    @Before
    fun mainDispatcher() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun resetDispatcher() = Dispatchers.resetMain()

    /** The phone's store, in memory. [failReads] makes the pause setting unreadable; [failWrites] makes changes fail. */
    private class Store(paused: Boolean = false, entries: List<AutomationRecord> = emptyList()) : AutomationPauseStore, AutomationHistoryStore {
        val pausedState = MutableStateFlow(paused)
        val history = MutableStateFlow(entries)
        var failReads = false
        var failWrites = false

        override val paused: Flow<Boolean> = flow {
            if (failReads) throw IOException("unreadable")
            pausedState.collect { emit(it) }
        }

        override suspend fun setPaused(paused: Boolean) {
            if (failWrites) throw IOException("disk full")
            pausedState.value = paused
        }

        override val entries: Flow<List<AutomationRecord>> = history

        override suspend fun record(entry: AutomationRecord) {
            history.value = AutomationHistory.append(history.value, entry)
        }

        override suspend fun clear() {
            if (failWrites) throw IOException("disk full")
            history.value = emptyList()
        }
    }

    private val tap = AutomationRecord(Instant.parse("2026-10-23T10:00:00Z"), "screen.tap", "Tap \"Next\" in Notes.", AutomationOutcome.DONE)
    private val bank = AutomationRecord(Instant.parse("2026-10-23T10:05:00Z"), "screen.read", "Read screen", AutomationOutcome.REFUSED)

    @Test
    fun theSettingAndTheHistoryAreWhatThePhoneHolds() {
        val store = Store(entries = listOf(bank, tap))
        val vm = PhoneSafetyViewModel(store, store)

        assertEquals(false, vm.uiState.value.paused)
        assertEquals(listOf(bank, tap), vm.uiState.value.history)

        vm.setPaused(true)
        assertTrue(store.pausedState.value)
        assertEquals(true, vm.uiState.value.paused)

        vm.setPaused(false)
        assertEquals(false, vm.uiState.value.paused)
    }

    @Test
    fun aNewPhoneActionAppearsAtTheTop() {
        val store = Store(entries = listOf(tap))
        val vm = PhoneSafetyViewModel(store, store)

        kotlinx.coroutines.runBlocking { store.record(bank) }

        assertEquals(listOf(bank, tap), vm.uiState.value.history)
    }

    @Test
    fun anUnreadableSettingIsShownAsSoAndNotAsOn() {
        val store = Store().apply { failReads = true }
        val vm = PhoneSafetyViewModel(store, store)

        assertTrue(vm.uiState.value.readFailed)
        assertNull("no switch position is shown that the phone did not report", vm.uiState.value.paused)

        store.failReads = false
        vm.load()
        assertFalse(vm.uiState.value.readFailed)
        assertEquals(false, vm.uiState.value.paused)
    }

    @Test
    fun clearingEmptiesTheHistoryAndAFailedChangeSaysSoAndChangesNothing() {
        val store = Store(paused = false, entries = listOf(tap))
        val vm = PhoneSafetyViewModel(store, store)

        store.failWrites = true
        vm.setPaused(true)
        vm.clearHistory()
        assertTrue(vm.uiState.value.saveFailed)
        assertEquals(false, vm.uiState.value.paused)
        assertEquals(listOf(tap), vm.uiState.value.history)

        store.failWrites = false
        vm.clearHistory()
        assertFalse(vm.uiState.value.saveFailed)
        assertTrue(vm.uiState.value.history.isEmpty())
    }

    @Test
    fun whatZarvisNeverDoesComesFromThePolicyInBothLanguages() {
        val store = Store()
        val vm = PhoneSafetyViewModel(store, store)

        assertTrue(vm.neverDoes.any { "Send" in it.en })
        assertTrue(vm.neverDoes.all { it.text("hi") == it.hi && it.text("en") == it.en })
    }

    @Test
    fun everyEndingHasItsOwnName() {
        val labels = AutomationOutcome.entries.map { it.label() }
        assertEquals(labels.size, labels.toSet().size)
    }
}
