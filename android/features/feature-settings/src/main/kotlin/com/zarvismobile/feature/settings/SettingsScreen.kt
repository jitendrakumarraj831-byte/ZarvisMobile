package com.zarvismobile.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.ZarvisCard
import com.zarvismobile.core.ui.components.ZarvisDestructiveButton
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.theme.ZarvisSpacing

/** Privacy, permissions, and memory controls — MASTER_SPEC.md §16, §17, §27; PRIVACY.md. */
@Composable
fun SettingsScreen(
    onSessionCleared: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Column(
        modifier = Modifier.fillMaxSize().padding(ZarvisSpacing.md),
        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
    ) {
        Text(text = "Settings", style = MaterialTheme.typography.headlineMedium)

        ZarvisCard(modifier = Modifier.fillMaxWidth()) {
            Text(text = "Language", style = MaterialTheme.typography.titleMedium)
            Text(text = "Current: ${uiState.locale}")
            Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.xs)) {
                listOf("en" to "English", "hi" to "हिंदी").forEach { (code, label) ->
                    ZarvisSecondaryButton(text = label, onClick = { viewModel.setLocale(code) })
                }
            }
        }

        ZarvisCard(modifier = Modifier.fillMaxWidth()) {
            Text(text = "Memory & Data", style = MaterialTheme.typography.titleMedium)
            Text(
                text = "View memory, clear conversation, export data, and delete account are planned " +
                    "(see PRIVACY.md and MASTER_SPEC.md §29) — not yet wired to a backend endpoint in this build.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        ZarvisCard(modifier = Modifier.fillMaxWidth()) {
            Text(text = "Session", style = MaterialTheme.typography.titleMedium)
            ZarvisDestructiveButton(
                text = "Clear local session",
                onClick = {
                    viewModel.clearLocalSession()
                    onSessionCleared()
                },
            )
        }
    }
}
