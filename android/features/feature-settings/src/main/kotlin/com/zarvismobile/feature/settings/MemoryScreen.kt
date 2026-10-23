package com.zarvismobile.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisDestructiveButton
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.QueenErrorCard
import com.zarvismobile.core.ui.components.SkeletonList
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
            com.zarvismobile.core.ui.components.QueenPageHeader(
                title = tr(UiString.MEMORY_TITLE),
                subtitle = tr(UiString.WORK_MEMORY_BODY),
                icon = com.zarvismobile.core.ui.icons.ZarvisIcons.Memory,
                jewel = com.zarvismobile.core.ui.components.Jewel.ORCHID,
                kicker = "ZARVIS",
                onBack = onBack,
                backLabel = tr(UiString.COMMON_BACK),
            )
            MemoryContent()
        }
    }
}

/**
 * What ZARVIS remembers, read from the server each time this is shown: the on/off switch, personal memory, project memory and
 * the conversation limit. The user can add a personal item, pause or resume any item, and delete items one at a time or, for
 * personal memory, all at once; deleting asks first. Nothing is ever added by ZARVIS itself.
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
                QueenErrorCard(message = tr(UiString.MEMORY_LOAD_ERROR), retryLabel = tr(UiString.COMMON_TRY_AGAIN), onRetry = viewModel::refresh)
            } else {
                SkeletonList(loadingLabel = tr(UiString.COMMON_LOADING), rows = 3)
            }
        } else {
            if (state.loadFailed) {
                // The list below is the last one the server gave: say that it could not be refreshed instead of presenting it as current.
                QueenErrorCard(message = tr(UiString.MEMORY_LOAD_ERROR), retryLabel = tr(UiString.COMMON_TRY_AGAIN), onRetry = viewModel::refresh)
            }
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

            SectionTitle(tr(UiString.MEMORY_PERSONAL))
            Text(
                trf(UiString.MEMORY_PERSONAL_HINT, overview.limits.memoryItemsUsed),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            AddMemoryCard(busy = state.busy, added = state.added, onSave = { viewModel.add(it) })
            if (overview.personal.isEmpty()) {
                ReadOnlyCard(tr(UiString.MEMORY_PERSONAL_EMPTY), tr(UiString.MEMORY_PERSONAL_EMPTY_BODY), ZarvisAccentCyan)
            } else {
                overview.personal.forEach { note ->
                    MemoryItemCard(
                        note,
                        enabled = !state.busy,
                        onUseChange = { viewModel.setItemEnabled(note.id, it) },
                        onDelete = { pendingDelete = note },
                    )
                }
                ZarvisDestructiveButton(
                    text = tr(UiString.MEMORY_FORGET_ALL),
                    enabled = !state.busy,
                    onClick = { confirmForgetAll = true },
                )
            }

            SectionTitle(tr(UiString.MEMORY_PROJECT))
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
                        MemoryItemCard(
                            note,
                            enabled = !state.busy,
                            onUseChange = { viewModel.setItemEnabled(note.id, it) },
                            onDelete = { pendingDelete = note },
                        )
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
private fun SectionTitle(text: String) {
    // The gold section label every Queen page uses.
    com.zarvismobile.core.ui.components.SectionKicker(text = text, modifier = Modifier.padding(top = 8.dp))
}

/** One personal item, typed by the user. What was typed is cleared only once the server has saved it, so a failed save keeps it. */
@Composable
private fun AddMemoryCard(busy: Boolean, added: Boolean, onSave: (String) -> Unit) {
    var draft by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(added) { if (added) draft = "" }
    val tooLong = draft.trim().length > MemoryViewModel.MAX_MEMORY_CHARS
    GlassSurface(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(tr(UiString.MEMORY_ADD_TITLE), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                enabled = !busy,
                placeholder = { Text(tr(UiString.MEMORY_ADD_HINT)) },
                isError = tooLong,
                supportingText = if (tooLong) {
                    { Text(trf(UiString.MEMORY_ADD_TOO_LONG, MemoryViewModel.MAX_MEMORY_CHARS)) }
                } else {
                    null
                },
                minLines = 2,
                modifier = Modifier.fillMaxWidth(),
            )
            ZarvisPrimaryButton(
                text = tr(UiString.MEMORY_ADD_SAVE),
                enabled = !busy && draft.isNotBlank() && !tooLong,
                onClick = { onSave(draft) },
            )
            if (added) Text(tr(UiString.MEMORY_ADDED), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun MemoryItemCard(note: MemoryNoteDto, enabled: Boolean, onUseChange: (Boolean) -> Unit, onDelete: () -> Unit) {
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
        // Pausing keeps the item saved; ZARVIS only stops using it in replies. Each switch names its item for a screen reader.
        val useDescription = trf(UiString.MEMORY_ITEM_USE_NAMED, note.content.take(60))
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .toggleable(value = note.enabled, enabled = enabled, role = Role.Switch, onValueChange = onUseChange)
                .semantics { contentDescription = useDescription },
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(tr(UiString.MEMORY_ITEM_USE), style = MaterialTheme.typography.bodyMedium)
            Switch(checked = note.enabled, onCheckedChange = null, enabled = enabled)
        }
    }
}
