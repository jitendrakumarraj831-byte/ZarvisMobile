package com.zarvismobile.feature.tasks

import com.zarvismobile.data.remote.ZarvisApi
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** A task list that fails to load and a Pause or Cancel that fails are different problems and are reported differently. */
@OptIn(ExperimentalCoroutinesApi::class)
class TasksViewModelTest {
    @Before
    fun mainDispatcher() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun resetDispatcher() = Dispatchers.resetMain()

    private fun task(id: String, status: String = "RUNNING") = TaskDto(id = id, accountId = "a", goal = "Task $id", status = status, riskLevel = "LOW", createdAt = "2026-10-10T10:00:00.000Z", lifecycle = "RUNNING")

    private fun api(answer: (String, List<Any?>) -> Any?): ZarvisApi =
        Proxy.newProxyInstance(ZarvisApi::class.java.classLoader, arrayOf(ZarvisApi::class.java)) { _, method, args ->
            answer(method.name, (args ?: emptyArray()).toList().dropLast(1))
        } as ZarvisApi

    @Test
    fun theListLoads() {
        val vm = TasksViewModel(api { name, _ -> if (name == "getTasks") TasksResponse(listOf(task("1"))) else error(name) })
        assertEquals(listOf("1"), vm.uiState.value.tasks.map { it.id })
        assertFalse(vm.uiState.value.isLoading)
        assertNull(vm.uiState.value.error)
    }

    @Test
    fun aListThatCannotBeLoadedIsAnErrorNotAnEmptyList() {
        val vm = TasksViewModel(api { _, _ -> throw IllegalStateException("offline") })
        assertNotNull(vm.uiState.value.error)
        assertFalse(vm.uiState.value.actionFailed)
        assertTrue(vm.uiState.value.tasks.isEmpty())
    }

    @Test
    fun aFailedCancelKeepsTheListAndFlagsTheActionNotTheLoad() {
        val vm = TasksViewModel(
            api { name, _ ->
                when (name) {
                    "getTasks" -> TasksResponse(listOf(task("1")))
                    "transitionTask" -> throw IllegalStateException("409")
                    else -> error(name)
                }
            },
        )
        vm.cancel("1")

        assertTrue(vm.uiState.value.actionFailed)
        assertNull(vm.uiState.value.error)
        assertEquals(listOf("1"), vm.uiState.value.tasks.map { it.id })
    }

    @Test
    fun aSuccessfulCancelReloadsTheListAndClearsTheFlag() {
        var status = "RUNNING"
        val vm = TasksViewModel(
            api { name, args ->
                when (name) {
                    "getTasks" -> TasksResponse(listOf(task("1", status)))
                    "transitionTask" -> { assertEquals(listOf<Any?>("1", "cancel"), args); status = "CANCELLED"; task("1", status) }
                    else -> error(name)
                }
            },
        )
        vm.cancel("1")

        assertFalse(vm.uiState.value.actionFailed)
        assertEquals("CANCELLED", vm.uiState.value.tasks.single().status)
    }
}
