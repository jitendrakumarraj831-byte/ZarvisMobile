package com.jarvismobile.domain.entity

import java.time.Instant
import java.util.UUID

/** See MASTER_SPEC.md §18 (Task Engine). */
data class TaskStep(
    val id: String = UUID.randomUUID().toString(),
    val description: String,
    val skillId: String? = null,
    val status: StepStatus = StepStatus.PENDING,
    val resultSummary: String? = null,
    val retryCount: Int = 0,
)

data class Task(
    val id: String = UUID.randomUUID().toString(),
    val goal: String,
    val status: TaskStatus = TaskStatus.PENDING,
    val steps: List<TaskStep> = emptyList(),
    val riskLevel: RiskLevel = RiskLevel.LOW,
    val createdAt: Instant = Instant.now(),
) {
    val isTerminal: Boolean
        get() = status == TaskStatus.DONE || status == TaskStatus.FAILED || status == TaskStatus.CANCELLED
}
