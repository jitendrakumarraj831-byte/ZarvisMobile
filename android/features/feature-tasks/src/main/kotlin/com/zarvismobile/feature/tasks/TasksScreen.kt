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
import com.zarvismobile.core.ui.components.ZarvisCard
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.data.remote.dto.TaskDto

/** Task list + lifecycle controls — MASTER_SPEC.md §18 (Task Engine). */
@Composable
fun TasksScreen(
    onOpenPlans: () -> Unit = {},
    onOpenTasksFeature: () -> Unit = {},
    viewModel: TasksViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(ZarvisSpacing.md)) {
        Text(text = "Activity", style = MaterialTheme.typography.headlineMedium)
        Text(
            text = "Creating a workflow tracks steps. It does not run them.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row {
            TextButton(onClick = onOpenPlans) { Text("Plans & quotas") }
            TextButton(onClick = onOpenTasksFeature) { Text("About tasks") }
        }

        if (uiState.isLoading && uiState.tasks.isEmpty()) {
            Box(modifier = Modifier.fillMaxWidth().padding(ZarvisSpacing.lg), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }

        if (uiState.tasks.isEmpty() && !uiState.isLoading && uiState.error == null) {
            ZarvisCard(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = "No tasks yet. Ask ZARVIS to create a workflow, then control it here.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        uiState.error?.let {
            Text(
                text = "Couldn't load activity. Check your connection and open this screen again.",
                color = MaterialTheme.colorScheme.error,
            )
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
    ZarvisCard(modifier = Modifier.fillMaxWidth()) {
        Text(text = task.goal, style = MaterialTheme.typography.titleMedium)
        Text(text = "Status: ${task.status} · Risk: ${task.riskLevel}", style = MaterialTheme.typography.bodyMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
            when (task.status) {
                "PENDING" -> TextButton(onClick = { viewModel.resume(task.id) }) { Text("Start") }
                "RUNNING" -> {
                    TextButton(onClick = { viewModel.pause(task.id) }) { Text("Pause") }
                    TextButton(onClick = { viewModel.cancel(task.id) }) { Text("Cancel") }
                }
                "PAUSED" -> {
                    TextButton(onClick = { viewModel.resume(task.id) }) { Text("Resume") }
                    TextButton(onClick = { viewModel.cancel(task.id) }) { Text("Cancel") }
                }
                "FAILED" -> TextButton(onClick = { viewModel.retry(task.id) }) { Text("Retry") }
            }
        }
    }
}
