package com.zarvismobile.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisDestructiveButton
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.i18n.trf
import com.zarvismobile.core.ui.theme.ZarvisAccentCyan
import com.zarvismobile.core.ui.theme.ZarvisAccentPink
import com.zarvismobile.data.remote.dto.MemoryNoteDto
import com.zarvismobile.domain.presentation.StatusTone
import com.zarvismobile.domain.presentation.UiString

/**
 * Memory as its own screen (opened from Work). The same content is Settings > Memory; both are [MemoryContent].
 */
@Composable
fun MemoryScreen(onBack: () -> Unit) {
    ZarvisBackground {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onBack) { Text("‹ " + tr(UiString.COMMON_BACK)) }
                Text(tr(UiString.MEMORY_TITLE), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            }
            MemoryContent()
        }
    }
}

/**
 * What ZARVIS remembers, read from the server each time this is shown: the on/off switch, personal memory, project memory and
 * the conversation limit. Items can be deleted one at a time or, for personal memory, all at once; both ask first.
 * Adding memory is done on the website.
 */
@Composable
fun MemoryContent(viewModel: MemoryViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsState()
    var pendingDelete by remember { mutableStateOf<MemoryNoteDto?>(null) }
    var confirmForgetAll by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { viewModel.refresh() }

    val overview = state.overview
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (overview == null) {
            if (state.loadFailed) {
                GlassSurface(Modifier.fillMaxWidth()) {
                    Text(tr(UiString.MEMORY_LOAD_ERROR), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.error)
                    ZarvisSecondaryButton(text = tr(UiString.COMMON_TRY_AGAIN), onClick = viewModel::refresh)
                }
            } else {
                CircularProgressIndicator()
            }
        } else {
            GlassSurface(Modifier.fillMaxWidth()) {
                SettingSwitchRow(
                    title = tr(UiString.MEMORY_USE_TITLE),
                    subtitle = tr(if (overview.enabled) UiString.MEMORY_USE_ON else UiString.MEMORY_USE_OFF),
                    checked = overview.enabled,
                    onCheckedChange = { if (!state.busy) viewModel.setEnabled(it) },
                )
            }
            if (state.actionFailed) {
                Text(tr(UiString.MEMORY_ACTION_ERROR), color = MaterialTheme.colorScheme.error)
            }
            state.forgotten?.let { removed ->
                Text(trf(UiString.MEMORY_FORGOT, removed), color = MaterialTheme.colorScheme.primary)
            }

            SectionTitle(tr(UiString.MEMORY_PERSONAL), ZarvisAccentCyan)
            Text(
                trf(UiString.MEMORY_PERSONAL_HINT, overview.limits.memoryItemsUsed),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (overview.personal.isEmpty()) {
                ReadOnlyCard(tr(UiString.MEMORY_PERSONAL_EMPTY), tr(UiString.MEMORY_PERSONAL_EMPTY_BODY), ZarvisAccentCyan)
            } else {
                overview.personal.forEach { note ->
                    MemoryItemCard(note, enabled = !state.busy, onDelete = { pendingDelete = note })
                }
                ZarvisDestructiveButton(
                    text = tr(UiString.MEMORY_FORGET_ALL),
                    enabled = !state.busy,
                    onClick = { confirmForgetAll = true },
                )
            }

            SectionTitle(tr(UiString.MEMORY_PROJECT), ZarvisAccentPink)
            if (overview.projects.isEmpty()) {
                ReadOnlyCard(tr(UiString.MEMORY_PROJECT_EMPTY), tr(UiString.MEMORY_PROJECT_HINT), ZarvisAccentPink)
            } else {
                Text(
                    tr(UiString.MEMORY_PROJECT_HINT),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                overview.projects.forEach { project ->
                    Text(project.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    project.items.forEach { note ->
                        MemoryItemCard(note, enabled = !state.busy, onDelete = { pendingDelete = note })
                    }
                }
            }

            ReadOnlyCard(
                tr(UiString.MEMORY_CONTEXT_TITLE),
                trf(UiString.MEMORY_CONTEXT_BODY, overview.limits.conversationMessages),
                ZarvisAccentCyan,
            )
        }
    }

    pendingDelete?.let { note ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text(tr(UiString.MEMORY_DELETE_TITLE)) },
            text = { Text(tr(UiString.MEMORY_DELETE_BODY)) },
            confirmButton = {
                TextButton(onClick = { pendingDelete = null; viewModel.delete(note.id) }) { Text(tr(UiString.COMMON_DELETE)) }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text(tr(UiString.COMMON_CANCEL)) } },
        )
    }
    if (confirmForgetAll) {
        AlertDialog(
            onDismissRequest = { confirmForgetAll = false },
            title = { Text(tr(UiString.MEMORY_FORGET_TITLE)) },
            text = { Text(trf(UiString.MEMORY_FORGET_BODY, overview?.personal?.size ?: 0)) },
            confirmButton = {
                TextButton(onClick = { confirmForgetAll = false; viewModel.forgetAllPersonal() }) { Text(tr(UiString.MEMORY_FORGET_CONFIRM)) }
            },
            dismissButton = { TextButton(onClick = { confirmForgetAll = false }) { Text(tr(UiString.COMMON_CANCEL)) } },
        )
    }
}

@Composable
private fun SectionTitle(text: String, accent: androidx.compose.ui.graphics.Color) {
    Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = accent)
}

@Composable
private fun MemoryItemCard(note: MemoryNoteDto, enabled: Boolean, onDelete: () -> Unit) {
    GlassSurface(Modifier.fillMaxWidth()) {
        Text(note.content, style = MaterialTheme.typography.bodyMedium)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            StatusBadge(
                label = tr(if (note.enabled) UiString.MEMORY_USED else UiString.MEMORY_ITEM_PAUSED),
                tone = if (note.enabled) StatusTone.SUCCESS else StatusTone.NEUTRAL,
            )
            // Every row says "Delete this item": a screen reader needs to hear which one.
            val description = trf(UiString.MEMORY_DELETE_ITEM_NAMED, note.content.take(60))
            TextButton(onClick = onDelete, enabled = enabled, modifier = Modifier.semantics { contentDescription = description }) {
                Text(tr(UiString.MEMORY_DELETE_ITEM))
            }
        }
    }
}
