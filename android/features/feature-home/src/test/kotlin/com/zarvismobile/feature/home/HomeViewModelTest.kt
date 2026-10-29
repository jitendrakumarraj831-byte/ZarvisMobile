package com.zarvismobile.feature.home

import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.EntitlementSnapshotResponse
import com.zarvismobile.data.remote.dto.TaskDto
import com.zarvismobile.data.remote.dto.TasksResponse
import com.zarvismobile.domain.policy.AutomationPauseStore
import java.lang.reflect.Proxy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
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
 * Home's recent tasks and plan come from the real endpoints, each on its own: one failing never blanks the other, and a list that could
 * not be read is never shown as "No tasks yet".
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {
    @Before
    fun mainDispatcher() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun resetDispatcher() = Dispatchers.resetMain()

    private val calls = mutableListOf<String>()

    private val notPaused = object : AutomationPauseStore {
        override val paused: Flow<Boolean> = flowOf(false)
        override suspend fun setPaused(paused: Boolean) = Unit
    }

    private fun task(id: String) = TaskDto(id = id, accountId = "a", goal = "g$id", status = "PENDING", riskLevel = "LOW", createdAt = "2026-10-10T10:00:00.000Z")

    private fun plan(credits: Int) = EntitlementSnapshotResponse(accountId = "a", plan = "TRIAL", trialExpiresAt = null, creditBalance = credits)

    private fun home(answer: (String) -> Any?): HomeViewModel {
        val api = Proxy.newProxyInstance(ZarvisApi::class.java.classLoader, arrayOf(ZarvisApi::class.java)) { _, method, _ ->
            calls += method.name
            answer(method.name)
        } as ZarvisApi
        return HomeViewModel(api, notPaused)
    }

    @Test
    fun tasksAndPlanLoad() {
        val vm = home { name ->
            when (name) {
                "getTasks" -> TasksResponse(listOf(task("1"), task("2")))
                "getEntitlements" -> plan(50)
                else -> error("unexpected $name")
            }
        }

        vm.refresh()
        val state = vm.uiState.value
        assertEquals(2, state.tasks.size)
        assertEquals(50, state.entitlement?.creditBalance)
        assertFalse(state.isLoading)
        assertFalse(state.failed)
    }

    @Test
    fun homeDoesNotAskForTheSkillListItNeverShows() {
        val vm = home { name -> if (name == "getTasks") TasksResponse(emptyList()) else plan(5) }
        vm.refresh()
        // A failing /skills used to blank the recent tasks and the plan too, though Home shows no skills.
        assertFalse("getSkills" in calls)
    }

    @Test
    fun aFailedTaskReadDoesNotBlankThePlanAndIsNotNoTasks() {
        val vm = home { name ->
            when (name) {
                "getTasks" -> throw IllegalStateException("offline")
                "getEntitlements" -> plan(7)
                else -> error("unexpected $name")
            }
        }

        vm.refresh()
        val state = vm.uiState.value
        assertTrue("the section must say it could not load, not that there are none", state.tasksFailed)
        assertTrue(state.failed)
        assertFalse(state.planFailed)
        assertEquals(7, state.entitlement?.creditBalance)
    }

    @Test
    fun aFailedPlanReadDoesNotBlankTheTasks() {
        val vm = home { name ->
            when (name) {
                "getTasks" -> TasksResponse(listOf(task("1")))
                "getEntitlements" -> throw IllegalStateException("offline")
                else -> error("unexpected $name")
            }
        }

        vm.refresh()
        val state = vm.uiState.value
        assertEquals(1, state.tasks.size)
        assertFalse(state.tasksFailed)
        assertTrue(state.planFailed)
        assertNull(state.entitlement)
    }

    @Test
    fun aFailedRefreshKeepsWhatWasShownAndSaysSoAndTheNextGoodOneClearsIt() {
        var offline = false
        val vm = home { name ->
            if (offline) throw IllegalStateException("offline")
            when (name) {
                "getTasks" -> TasksResponse(listOf(task("1")))
                "getEntitlements" -> plan(50)
                else -> error("unexpected $name")
            }
        }
        vm.refresh()

        offline = true
        vm.refresh()
        assertEquals("the last good list stays", 1, vm.uiState.value.tasks.size)
        assertTrue(vm.uiState.value.failed)

        offline = false
        vm.refresh()
        assertFalse(vm.uiState.value.failed)
    }
}
