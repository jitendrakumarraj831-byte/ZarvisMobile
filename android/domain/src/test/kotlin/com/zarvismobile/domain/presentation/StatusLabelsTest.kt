package com.zarvismobile.domain.presentation

import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.TaskStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull

class StatusLabelsTest {
    @Test
    fun `every status and risk the backend can send has a label that is not the raw code`() {
        for (status in TaskStatus.entries) {
            assertNotNull(StatusLabels.task(status.name), "no label for task status ${status.name}")
            assertNotEquals(status.name, StatusLabels.taskText(status.name, null, "en"))
        }
        for (risk in RiskLevel.entries) {
            assertNotNull(StatusLabels.risk(risk.name), "no label for risk ${risk.name}")
            assertNotEquals(risk.name, StatusLabels.riskText(risk.name, "en"))
        }
    }

    @Test
    fun `the old status words read as the website names them`() {
        assertEquals("Queued · not started", StatusLabels.taskText("PENDING", null, "en"))
        assertEquals("Running", StatusLabels.taskText("RUNNING", null, "en"))
        assertEquals("Paused", StatusLabels.taskText("PAUSED", null, "en"))
        assertEquals("Completed", StatusLabels.taskText("DONE", null, "en"))
        assertEquals("Failed", StatusLabels.taskText("FAILED", null, "en"))
        assertEquals("Cancelled", StatusLabels.taskText("CANCELLED", null, "en"))
        assertEquals("पूरा हुआ", StatusLabels.taskText("DONE", null, "hi"))
        assertEquals("कतार में · शुरू नहीं हुआ", StatusLabels.taskText("PENDING", null, "hi"))
    }

    @Test
    fun `the lifecycle, when the server sends a known one, is more exact than the status`() {
        assertEquals("Waiting for you", StatusLabels.taskText("RUNNING", "WAITING", "en"))
        assertEquals("Needs your confirmation", StatusLabels.taskText("PAUSED", "CONFIRMATION_REQUIRED", "en"))
        assertEquals("Checking the result", StatusLabels.taskText("RUNNING", "VERIFYING", "en"))
        assertEquals("Blocked", StatusLabels.taskText("FAILED", "BLOCKED", "en"))
    }

    @Test
    fun `an unknown lifecycle falls back to the status, and an unknown code is shown readably never raw`() {
        assertEquals("Running", StatusLabels.taskText("RUNNING", "SOMETHING_NEW", "en"))
        assertEquals("Waiting for review", StatusLabels.taskText("WAITING_FOR_REVIEW", null, "en"))
        assertEquals("Under review", StatusLabels.taskText("PENDING_X", "UNDER_REVIEW", "en"))
        assertEquals("Very high risk", StatusLabels.riskText("VERY_HIGH", "en"))
        assertEquals("Severe", StatusLabels.riskText("SEVERE", "en"))
        assertEquals("", StatusLabels.humanize("  "))
    }

    @Test
    fun `codes are matched without regard to case`() {
        assertEquals("Completed", StatusLabels.taskText("done", null, "en"))
        assertEquals("Low risk", StatusLabels.riskText("low", "en"))
    }

    @Test
    fun `tone groups states by how they should be painted`() {
        assertEquals(StatusTone.ACTIVE, StatusLabels.taskTone("RUNNING"))
        assertEquals(StatusTone.ACTIVE, StatusLabels.taskTone("PAUSED", "EXECUTING"))
        assertEquals(StatusTone.WAITING, StatusLabels.taskTone("PENDING"))
        assertEquals(StatusTone.WAITING, StatusLabels.taskTone("PAUSED"))
        assertEquals(StatusTone.SUCCESS, StatusLabels.taskTone("DONE"))
        assertEquals(StatusTone.PROBLEM, StatusLabels.taskTone("FAILED"))
        assertEquals(StatusTone.NEUTRAL, StatusLabels.taskTone("CANCELLED"))
        assertEquals(StatusTone.NEUTRAL, StatusLabels.taskTone("MYSTERY"))
    }
}
