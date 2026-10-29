package com.zarvismobile.feature.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.QueenEmptyState
import com.zarvismobile.core.ui.components.QueenErrorCard
import com.zarvismobile.core.ui.components.QueenInlineError
import com.zarvismobile.core.ui.components.QueenPageHeader
import com.zarvismobile.core.ui.components.SectionKicker
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.toneColor
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisChip
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.components.SkeletonList
import com.zarvismobile.core.ui.i18n.LocalAppLocale
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.data.remote.dto.TaskDto
import com.zarvismobile.domain.presentation.StatusLabels
import com.zarvismobile.domain.presentation.TaskGroup
import com.zarvismobile.domain.presentation.UiString

/**
 * Task list + lifecycle controls — MASTER_SPEC.md §18 (Task Engine), Queen Pro board 8. It is the Tasks tab, and also Work > Tasks
 * (then [onBack] is set). Tasks are grouped by who has to act next (Needs you, In progress, Finished); each shows its real state and
 * risk in words. The list scrolls as one column: the header, notices and cards all move together.
 */
@Composable
fun TasksScreen(
    onOpenPlans: () -> Unit = {},
    onOpenTasksFeature: () -> Unit = {},
    onOpenChat: () -> Unit = {},
    onBack: (() -> Unit)? = null,
    viewModel: TasksViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    LifecycleResumeEffect(Unit) {
        viewModel.refresh()
        onPauseOrDispose { }
    }
    val groups = uiState.tasks.distinctBy { it.id }.groupBy { StatusLabels.taskGroup(it.status, it.lifecycle) }

    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(horizontal = ZarvisSpacing.md, vertical = ZarvisSpacing.md),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                QueenPageHeader(
                    title = tr(UiString.TASKS_TITLE_WORK),
                    subtitle = tr(UiString.TASKS_SUBTITLE),
                    onBack = onBack,
                    backLabel = tr(UiString.COMMON_BACK),
                    actions = {
                        ZarvisChip(label = tr(UiString.COMMON_PLANS_QUOTAS), onClick = onOpenPlans, icon = ZarvisIcons.Plan)
                        ZarvisChip(label = tr(UiString.TASKS_ABOUT), onClick = onOpenTasksFeature, icon = ZarvisIcons.Task)
                    },
                )
            }

            // The four states of the list: a gold skeleton while loading, the crown when empty, an error card with Try again, and the tasks.
            if (uiState.isLoading && uiState.tasks.isEmpty()) {
                item { SkeletonList(loadingLabel = tr(UiString.COMMON_LOADING), rows = 4) }
            }

            if (uiState.tasks.isEmpty() && !uiState.isLoading && uiState.error == null) {
                item {
                    QueenEmptyState(
                        title = tr(UiString.TASKS_EMPTY_TITLE),
                        body = tr(UiString.TASKS_EMPTY),
                        actionLabel = tr(UiString.TASKS_OPEN_CHAT),
                        onAction = onOpenChat,
                    )
                }
            }

            if (uiState.error != null) {
                // The list could not be loaded: say so and offer the retry here, instead of asking the user to leave and come back.
                item { QueenErrorCard(message = tr(UiString.TASKS_ERROR), retryLabel = tr(UiString.COMMON_TRY_AGAIN), onRetry = viewModel::refresh) }
            }
            if (uiState.actionFailed) {
                item { QueenInlineError(text = tr(UiString.TASKS_ACTION_ERROR)) }
            }

            TaskGroup.entries.forEach { group ->
                val tasks = groups[group].orEmpty()
                if (tasks.isNotEmpty()) {
                    item(key = "group-${group.name}") { SectionKicker(text = tr(group.label), modifier = Modifier.padding(top = ZarvisSpacing.sm)) }
                    items(tasks, key = { it.id }) { task ->
                        TaskRow(task = task, busy = task.id in uiState.busy, viewModel = viewModel)
                    }
                }
            }
            item { Spacer(modifier = Modifier.size(ZarvisSpacing.xl)) }
        }
    }
}

@Composable
private fun TaskRow(task: TaskDto, busy: Boolean, viewModel: TasksViewModel) {
    val locale = LocalAppLocale.current
    val tone = StatusLabels.taskTone(task.status, task.lifecycle)
    GlassSurface(modifier = Modifier.fillMaxWidth(), contentPadding = 0.dp) {
        // A stripe down the left edge in the status's colour, so a long list reads at a glance (the chip says it in words).
        Row(modifier = Modifier.height(IntrinsicSize.Min)) {
            Box(
                Modifier
                    .padding(vertical = 14.dp)
                    .width(4.dp)
                    .fillMaxHeight()
                    .background(toneColor(tone), RoundedCornerShape(topEnd = 4.dp, bottomEnd = 4.dp)),
            )
            Column(modifier = Modifier.weight(1f).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(text = task.goal, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                // Plain-language state and risk, never the raw codes (PENDING, LOW, ...).
                Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm), verticalAlignment = Alignment.CenterVertically) {
                    StatusBadge(label = StatusLabels.taskText(task.status, task.lifecycle, locale), tone = tone)
                    Text(
                        text = StatusLabels.riskText(task.riskLevel, locale),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                // Nothing runs a task by itself, and this screen has no Run / Retry control (the website does: POST /tasks/:id/run),
                // so it offers none: an old "Start" button used to show RUNNING while nothing ran.
                if (task.status == "PENDING" || task.status == "PAUSED" || task.status == "FAILED") {
                    Text(
                        text = tr(UiString.TASKS_NOT_AUTOMATIC),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                // Off while this task's Cancel is on its way. No Pause: the server refuses to pause a step that is running (its
                // result would be thrown away and its tools run again), so a Pause button here would only ever answer with an error.
                if (task.status == "PENDING" || task.status == "PAUSED" || task.status == "RUNNING") {
                    ZarvisSecondaryButton(tr(UiString.TASKS_CANCEL), onClick = { viewModel.cancel(task.id) }, enabled = !busy)
                }
            }
        }
    }
}
