package com.jarvismobile.feature.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import com.jarvismobile.core.ui.components.JarvisCard
import com.jarvismobile.core.ui.theme.JarvisSpacing
import com.jarvismobile.data.remote.dto.TaskDto

/** Task list + lifecycle controls — MASTER_SPEC.md §18 (Task Engine). */
@Composable
fun TasksScreen(viewModel: TasksViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(JarvisSpacing.md)) {
        Text(text = "Tasks", style = MaterialTheme.typography.headlineMedium)

        if (uiState.tasks.isEmpty() && !uiState.isLoading) {
            Text(
                text = "No tasks yet. Ask JARVIS to do something multi-step, like \"audit my website.\"",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = JarvisSpacing.md),
            )
        }

        uiState.error?.let { Text(text = it, color = MaterialTheme.colorScheme.error) }

        LazyColumn(
            contentPadding = PaddingValues(vertical = JarvisSpacing.md),
            verticalArrangement = Arrangement.spacedBy(JarvisSpacing.sm),
        ) {
            items(uiState.tasks) { task ->
                TaskRow(task = task, viewModel = viewModel)
            }
        }
    }
}

@Composable
private fun TaskRow(task: TaskDto, viewModel: TasksViewModel) {
    JarvisCard(modifier = Modifier.fillMaxWidth()) {
        Text(text = task.goal, style = MaterialTheme.typography.titleMedium)
        Text(text = "Status: ${task.status} · Risk: ${task.riskLevel}", style = MaterialTheme.typography.bodyMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(JarvisSpacing.sm)) {
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
