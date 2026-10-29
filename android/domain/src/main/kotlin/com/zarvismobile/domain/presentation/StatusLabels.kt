package com.zarvismobile.domain.presentation

import com.zarvismobile.domain.entity.CapabilityStatus

/** How a status should look: the colour family a screen paints its badge in. */
enum class StatusTone { ACTIVE, WAITING, SUCCESS, PROBLEM, NEUTRAL }

/** The three groups of the Tasks list, in the order they are shown. */
enum class TaskGroup(val label: UiString) {
    /** Waiting on the person: an answer, a confirmation, or something that blocks it. */
    NEEDS_YOU(UiString.TASKS_GROUP_NEEDS_YOU),

    /** Not finished: queued, running, checking, paused, or a state this client does not know yet. */
    IN_PROGRESS(UiString.TASKS_GROUP_IN_PROGRESS),

    /** Ended, however it ended: completed, failed or cancelled. */
    FINISHED(UiString.TASKS_GROUP_FINISHED),
}

/**
 * Plain-language names for the codes the backend sends (`PENDING`, `DONE`, `LOW`, ...). A screen must never
 * show a raw code. Wording and meaning follow the website (`web/workspace.js` LIFECYCLE_LABEL, `web/logic.js` riskLabel).
 *
 * A task carries two fields: `status` (the older PENDING / RUNNING / PAUSED / DONE / FAILED / CANCELLED) and
 * `lifecycle` (what it is really doing: QUEUED, WAITING, EXECUTING, ...). The lifecycle is more exact, so it wins
 * when the server sent a known one.
 */
object StatusLabels {
    private val LIFECYCLE: Map<String, UiString> = mapOf(
        "QUEUED" to UiString.TASK_QUEUED,
        "WAITING" to UiString.TASK_WAITING,
        "RUNNING" to UiString.TASK_RUNNING,
        "EXECUTING" to UiString.TASK_EXECUTING,
        "VERIFYING" to UiString.TASK_VERIFYING,
        "CONFIRMATION_REQUIRED" to UiString.TASK_CONFIRMATION,
        "COMPLETED" to UiString.TASK_COMPLETED,
        "FAILED" to UiString.TASK_FAILED,
        "CANCELLED" to UiString.TASK_CANCELLED,
        "BLOCKED" to UiString.TASK_BLOCKED,
    )

    private val STATUS: Map<String, UiString> = mapOf(
        "PENDING" to UiString.TASK_QUEUED,
        "RUNNING" to UiString.TASK_RUNNING,
        "PAUSED" to UiString.TASK_PAUSED,
        "DONE" to UiString.TASK_COMPLETED,
        "FAILED" to UiString.TASK_FAILED,
        "CANCELLED" to UiString.TASK_CANCELLED,
    )

    private val RISK: Map<String, UiString> = mapOf(
        "LOW" to UiString.RISK_LOW,
        "MEDIUM" to UiString.RISK_MEDIUM,
        "HIGH" to UiString.RISK_HIGH,
        "VERY_HIGH" to UiString.RISK_VERY_HIGH,
    )

    /** The label for a task, or `null` when neither field is one this client knows. */
    fun task(status: String, lifecycle: String? = null): UiString? =
        lifecycle?.let { LIFECYCLE[it.uppercase()] } ?: STATUS[status.uppercase()]

    /** The task label in [locale]. A code this client has never seen is shown readably ("Waiting for review"), never raw. */
    fun taskText(status: String, lifecycle: String?, locale: String): String =
        task(status, lifecycle)?.text(locale) ?: humanize(lifecycle?.takeIf { it.isNotBlank() } ?: status)

    fun taskTone(status: String, lifecycle: String? = null): StatusTone = when (task(status, lifecycle)) {
        UiString.TASK_RUNNING, UiString.TASK_EXECUTING, UiString.TASK_VERIFYING -> StatusTone.ACTIVE
        UiString.TASK_QUEUED, UiString.TASK_WAITING, UiString.TASK_CONFIRMATION, UiString.TASK_PAUSED -> StatusTone.WAITING
        UiString.TASK_COMPLETED -> StatusTone.SUCCESS
        UiString.TASK_FAILED, UiString.TASK_BLOCKED -> StatusTone.PROBLEM
        else -> StatusTone.NEUTRAL
    }

    /** Which group of the Tasks list a task belongs to. A state this client has never seen is in progress, never hidden as finished. */
    fun taskGroup(status: String, lifecycle: String? = null): TaskGroup = when (task(status, lifecycle)) {
        UiString.TASK_WAITING, UiString.TASK_CONFIRMATION, UiString.TASK_BLOCKED -> TaskGroup.NEEDS_YOU
        UiString.TASK_COMPLETED, UiString.TASK_FAILED, UiString.TASK_CANCELLED -> TaskGroup.FINISHED
        else -> TaskGroup.IN_PROGRESS
    }

    /** How far a capability works, in the same words on the Skills tab, on its own page and in Permissions & Device Access. */
    fun capability(status: CapabilityStatus): UiString = when (status) {
        CapabilityStatus.WORKING -> UiString.SKILLS_STATUS_WORKING
        CapabilityStatus.PARTIAL -> UiString.SKILLS_STATUS_PARTIAL
        CapabilityStatus.PLANNED -> UiString.SKILLS_STATUS_PLANNED
        CapabilityStatus.UNSUPPORTED -> UiString.SKILLS_STATUS_UNSUPPORTED
    }

    fun risk(level: String): UiString? = RISK[level.uppercase()]

    fun riskText(level: String, locale: String): String = risk(level)?.text(locale) ?: humanize(level)

    /** `WAITING_FOR_REVIEW` -> `Waiting for review`; blank stays blank. */
    fun humanize(code: String): String {
        val words = code.trim().replace('_', ' ').replace('-', ' ').lowercase().trim()
        return words.replaceFirstChar { it.uppercase() }
    }
}
