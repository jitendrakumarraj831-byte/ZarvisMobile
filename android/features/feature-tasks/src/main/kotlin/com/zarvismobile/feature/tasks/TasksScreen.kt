package com.zarvismobile.feature.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.Alignment
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.RiskBadge
import com.zarvismobile.core.ui.components.RiskBadgeLevel
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisCard
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.i18n.LocalAppLocale
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.data.remote.dto.TaskDto
import com.zarvismobile.domain.presentation.StatusLabels
import com.zarvismobile.domain.presentation.UiString

/**
 * Task list + lifecycle controls — MASTER_SPEC.md §18 (Task Engine). It is the Activity tab, and also Work > Tasks (then
 * [onBack] is set and the title is "Tasks").
 */
@Composable
fun TasksScreen(
    onOpenPlans: () -> Unit = {},
    onOpenTasksFeature: () -> Unit = {},
    onBack: (() -> Unit)? = null,
    viewModel: TasksViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(ZarvisSpacing.md)) {
        if (onBack != null) {
            TextButton(onClick = onBack) { Text(tr(UiString.COMMON_BACK)) }
        }
        Text(text = tr(if (onBack != null) UiString.TASKS_TITLE_WORK else UiString.TASKS_TITLE), style = MaterialTheme.typography.headlineMedium)
        Text(
            text = tr(UiString.TASKS_SUBTITLE),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row {
            TextButton(onClick = onOpenPlans) { Text(tr(UiString.COMMON_PLANS_QUOTAS)) }
            TextButton(onClick = onOpenTasksFeature) { Text(tr(UiString.TASKS_ABOUT)) }
        }

        if (uiState.isLoading && uiState.tasks.isEmpty()) {
            Box(modifier = Modifier.fillMaxWidth().padding(ZarvisSpacing.lg), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }

        if (uiState.tasks.isEmpty() && !uiState.isLoading && uiState.error == null) {
            ZarvisCard(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = tr(UiString.TASKS_EMPTY),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (uiState.error != null) {
            // The list could not be loaded: say so and offer the retry here, instead of asking the user to leave and come back.
            Text(text = tr(UiString.TASKS_ERROR), color = MaterialTheme.colorScheme.error)
            ZarvisSecondaryButton(text = tr(UiString.COMMON_TRY_AGAIN), onClick = viewModel::refresh)
        }
        if (uiState.actionFailed) {
            Text(text = tr(UiString.TASKS_ACTION_ERROR), color = MaterialTheme.colorScheme.error)
        }

        LazyColumn(
            contentPadding = PaddingValues(vertical = ZarvisSpacing.md),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
        ) {
            items(uiState.tasks) { task ->
                TaskRow(task = task, viewModel = viewModel)
            }
        }
    }
}

@Composable
private fun TaskRow(task: TaskDto, viewModel: TasksViewModel) {
    val locale = LocalAppLocale.current
    ZarvisCard(modifier = Modifier.fillMaxWidth()) {
        Text(text = task.goal, style = MaterialTheme.typography.titleMedium)
        // Plain-language state and risk, never the raw codes (PENDING, LOW, ...).
        Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm), verticalAlignment = Alignment.CenterVertically) {
            StatusBadge(
                label = StatusLabels.taskText(task.status, task.lifecycle, locale),
                tone = StatusLabels.taskTone(task.status, task.lifecycle),
            )
            val risk = RiskBadgeLevel.fromWire(task.riskLevel)
            if (risk != null) RiskBadge(level = risk) else Text(text = StatusLabels.riskText(task.riskLevel, locale), style = MaterialTheme.typography.labelMedium)
        }
        // Nothing runs a task by itself, and this screen has no Run / Retry control (the website does: POST /tasks/:id/run),
        // so it offers none: an old "Start" button used to show RUNNING while nothing ran.
        if (task.status == "PENDING" || task.status == "PAUSED" || task.status == "FAILED") {
            Text(
                text = tr(UiString.TASKS_NOT_AUTOMATIC),
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
            when (task.status) {
                "PENDING", "PAUSED" -> TextButton(onClick = { viewModel.cancel(task.id) }) { Text(tr(UiString.TASKS_CANCEL)) }
                "RUNNING" -> {
                    TextButton(onClick = { viewModel.pause(task.id) }) { Text(tr(UiString.TASKS_PAUSE)) }
                    TextButton(onClick = { viewModel.cancel(task.id) }) { Text(tr(UiString.TASKS_CANCEL)) }
                }
            }
        }
    }
}
