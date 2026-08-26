package com.jarvismobile.feature.developer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import com.jarvismobile.core.ui.components.JarvisCard
import com.jarvismobile.core.ui.components.JarvisPrimaryButton
import com.jarvismobile.core.ui.components.RiskBadge
import com.jarvismobile.core.ui.components.RiskBadgeLevel
import com.jarvismobile.core.ui.theme.JarvisSpacing

/** Developer Mode — see DEVELOPER_AGENT.md. */
@Composable
fun DeveloperScreen(viewModel: DeveloperViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()

    Column(
        modifier = Modifier.fillMaxSize().padding(JarvisSpacing.md),
        verticalArrangement = Arrangement.spacedBy(JarvisSpacing.md),
    ) {
        Text(text = "Developer Mode", style = MaterialTheme.typography.headlineMedium)
        Text(
            text = "Read-only repository analysis. Write access (code changes, pull requests) is planned but not enabled in this build.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Column(verticalArrangement = Arrangement.spacedBy(JarvisSpacing.xs)) {
            Text(text = "Risk level for this action:", style = MaterialTheme.typography.labelMedium)
            RiskBadge(level = RiskBadgeLevel.LOW)
        }

        OutlinedTextField(
            value = uiState.repoUrl,
            onValueChange = viewModel::onRepoUrlChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Repository URL") },
            singleLine = true,
        )

        JarvisPrimaryButton(text = "Analyze", onClick = viewModel::analyze, modifier = Modifier.fillMaxWidth(), enabled = !uiState.isAnalyzing)

        if (uiState.isAnalyzing) {
            CircularProgressIndicator()
        }

        uiState.error?.let { Text(text = it, color = MaterialTheme.colorScheme.error) }

        uiState.result?.let { structure ->
            JarvisCard(modifier = Modifier.fillMaxWidth()) {
                uiState.summary?.let { Text(text = it, style = MaterialTheme.typography.bodyLarge) }
                Text(text = "Primary language: ${structure.primaryLanguage}")
                Text(text = "Build system: ${structure.buildSystem}")
                Text(text = "Has tests: ${structure.hasTests}")
                Text(text = "Has CI: ${structure.hasCi}")
                Text(text = "Files: ${structure.fileCount}")
                Text(text = "Top-level dirs: ${structure.topLevelDirs.joinToString(", ")}")
            }
        }
    }
}
