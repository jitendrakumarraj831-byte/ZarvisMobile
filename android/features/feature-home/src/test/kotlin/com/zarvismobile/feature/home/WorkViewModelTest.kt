package com.zarvismobile.feature.home

import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.EntitlementSnapshotResponse
import com.zarvismobile.data.remote.dto.MemoryOverviewResponse
import com.zarvismobile.data.remote.dto.TaskDto
import com.zarvismobile.data.remote.dto.TasksResponse
import java.lang.reflect.Proxy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The live numbers on the Work cards come from the real endpoints, each on its own: one failing never shows as zero or blanks the rest. */
@OptIn(ExperimentalCoroutinesApi::class)
class WorkViewModelTest {
    @Before
    fun mainDispatcher() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun resetDispatcher() = Dispatchers.resetMain()

    private fun task(id: String) = TaskDto(id = id, accountId = "a", goal = "g$id", status = "PENDING", riskLevel = "LOW", createdAt = "2026-10-10T10:00:00.000Z")

    private fun api(answer: (String) -> Any?): ZarvisApi =
        Proxy.newProxyInstance(ZarvisApi::class.java.classLoader, arrayOf(ZarvisApi::class.java)) { _, method, _ -> answer(method.name) } as ZarvisApi

    @Test
    fun allThreeLinesLoad() {
        val vm = WorkViewModel(
            api { name ->
                when (name) {
                    "getTasks" -> TasksResponse(listOf(task("1"), task("2"), task("3")))
                    "getMemory" -> MemoryOverviewResponse(enabled = true)
                    "getEntitlements" -> EntitlementSnapshotResponse(accountId = "a", plan = "TRIAL", trialExpiresAt = null, creditBalance = 50)
                    else -> error("unexpected $name")
                }
            },
        )

        vm.refresh()
        val state = vm.uiState.value
        assertEquals(Fetched.Ready(3), state.taskCount)
        assertEquals(true, (state.memory as Fetched.Ready).value.enabled)
        assertEquals(50, (state.plan as Fetched.Ready).value.creditBalance)
    }

    @Test
    fun oneFailingCallShowsAsFailedAndDoesNotBlankTheOthers() {
        val vm = WorkViewModel(
            api { name ->
                when (name) {
                    "getTasks" -> TasksResponse(listOf(task("1")))
                    "getMemory" -> throw IllegalStateException("offline")
                    "getEntitlements" -> EntitlementSnapshotResponse(accountId = "a", plan = "FREE", trialExpiresAt = null, creditBalance = 5)
                    else -> error("unexpected $name")
                }
            },
        )

        vm.refresh()
        val state = vm.uiState.value
        assertEquals(Fetched.Ready(1), state.taskCount)
        assertEquals(Fetched.Failed, state.memory)
        assertTrue(state.plan is Fetched.Ready)
    }

    @Test
    fun noTasksIsReadyZeroButAFailedLoadIsNeverZero() {
        val empty = WorkViewModel(api { name -> if (name == "getTasks") TasksResponse(emptyList()) else throw IllegalStateException("x") })
        empty.refresh()
        assertEquals(Fetched.Ready(0), empty.uiState.value.taskCount)

        val failed = WorkViewModel(api { throw IllegalStateException("offline") })
        failed.refresh()
        assertEquals(Fetched.Failed, failed.uiState.value.taskCount)
    }

    @Test
    fun nothingIsLoadedUntilTheScreenAsks() {
        val vm = WorkViewModel(api { error("must not be called before refresh()") })
        assertEquals(Fetched.Loading, vm.uiState.value.taskCount)
    }

    @Test
    fun showingTheScreenAgainReadsFreshCountsAndAFailureReplacesTheOldNumber() {
        var tasks = 3
        var offline = false
        val vm = WorkViewModel(
            api { name ->
                if (offline) throw IllegalStateException("offline")
                when (name) {
                    "getTasks" -> TasksResponse((1..tasks).map { task("$it") })
                    "getMemory" -> MemoryOverviewResponse(enabled = true)
                    "getEntitlements" -> EntitlementSnapshotResponse(accountId = "a", plan = "TRIAL", trialExpiresAt = null, creditBalance = 50)
                    else -> error("unexpected $name")
                }
            },
        )
        vm.refresh()
        assertEquals(Fetched.Ready(3), vm.uiState.value.taskCount)

        tasks = 1 // a task was removed on the website while this tab was away
        vm.refresh()
        assertEquals(Fetched.Ready(1), vm.uiState.value.taskCount)

        offline = true // the old number is not kept as if it were still true
        vm.refresh()
        assertEquals(Fetched.Failed, vm.uiState.value.taskCount)
    }
}
