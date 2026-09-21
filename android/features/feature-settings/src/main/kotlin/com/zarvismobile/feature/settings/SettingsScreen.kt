package com.zarvismobile.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
    val deleteStatus by viewModel.deleteAccountStatus.collectAsState()
    var showDeleteConfirmation by remember { mutableStateOf(false) }

    // Full-screen destination (no Scaffold bottomBar, MASTER_SPEC.md §23): claims the
    // gesture-nav-bar inset itself.
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(ZarvisSpacing.md),
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
                text = "Viewing individual memories, clearing a single conversation, and exporting your " +
                    "data are planned (see PRIVACY.md and MASTER_SPEC.md §29) — not yet wired to a backend " +
                    "endpoint in this build. Deleting your account below is fully wired: it removes your " +
                    "account, tasks, and usage history from the server.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (deleteStatus == DeleteAccountStatus.FAILED) {
                Text(
                    text = "Couldn't delete your account — check your connection and try again.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            ZarvisDestructiveButton(
                text = if (deleteStatus == DeleteAccountStatus.IN_PROGRESS) "Deleting account…" else "Delete account",
                enabled = deleteStatus != DeleteAccountStatus.IN_PROGRESS,
                onClick = { showDeleteConfirmation = true },
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

    if (showDeleteConfirmation) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirmation = false },
            title = { Text("Delete your account?") },
            text = {
                Text(
                    "This permanently deletes your account, tasks, and usage history from the " +
                        "server. This cannot be undone.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteConfirmation = false
                    viewModel.deleteAccount(onDeleted = onSessionCleared)
                }) { Text("Delete") }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirmation = false }) { Text("Cancel") }
            },
        )
    }
}
