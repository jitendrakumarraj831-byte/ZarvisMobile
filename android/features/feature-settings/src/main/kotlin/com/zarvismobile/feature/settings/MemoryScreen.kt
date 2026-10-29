package com.zarvismobile.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.QueenConfirmDialog
import com.zarvismobile.core.ui.components.QueenListCard
import com.zarvismobile.core.ui.components.QueenNote
import com.zarvismobile.core.ui.components.QueenRow
import com.zarvismobile.core.ui.components.QueenRowDivider
import com.zarvismobile.core.ui.components.QueenSection
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisDestructiveButton
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.QueenErrorCard
import com.zarvismobile.core.ui.components.QueenInlineError
import com.zarvismobile.core.ui.components.SkeletonList
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.i18n.trf
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisSpacing
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
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(ZarvisSpacing.md),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            com.zarvismobile.core.ui.components.QueenPageHeader(
                title = tr(UiString.MEMORY_TITLE),
                subtitle = tr(UiString.WORK_MEMORY_BODY),
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
                QueenInlineError(text = tr(UiString.MEMORY_ACTION_ERROR))
            }
            state.forgotten?.let { removed ->
                QueenNote(text = trf(UiString.MEMORY_FORGOT, removed), icon = ZarvisIcons.Check)
            }

            QueenSection(title = tr(UiString.MEMORY_ADD_TITLE)) {
                AddMemoryCard(busy = state.busy, added = state.added, onSave = { viewModel.add(it) })
            }

            QueenSection(title = tr(UiString.MEMORY_PERSONAL), hint = trf(UiString.MEMORY_PERSONAL_HINT, overview.limits.memoryItemsUsed)) {
                if (overview.personal.isEmpty()) {
                    QueenListCard { QueenRow(title = tr(UiString.MEMORY_PERSONAL_EMPTY), detail = tr(UiString.MEMORY_PERSONAL_EMPTY_BODY)) }
                } else {
                    QueenListCard {
                        overview.personal.forEachIndexed { index, note ->
                            if (index > 0) QueenRowDivider()
                            MemoryItemRow(
                                note,
                                enabled = !state.busy,
                                onUseChange = { viewModel.setItemEnabled(note.id, it) },
                                onDelete = { pendingDelete = note },
                            )
                        }
                    }
                    ZarvisDestructiveButton(
                        text = tr(UiString.MEMORY_FORGET_ALL),
                        enabled = !state.busy,
                        onClick = { confirmForgetAll = true },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            QueenSection(title = tr(UiString.MEMORY_PROJECT), hint = tr(UiString.MEMORY_PROJECT_HINT)) {
                if (overview.projects.isEmpty()) {
                    QueenListCard { QueenRow(title = tr(UiString.MEMORY_PROJECT_EMPTY)) }
                } else {
                    overview.projects.forEach { project ->
                        Text(project.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        QueenListCard {
                            project.items.forEachIndexed { index, note ->
                                if (index > 0) QueenRowDivider()
                                MemoryItemRow(
                                    note,
                                    enabled = !state.busy,
                                    onUseChange = { viewModel.setItemEnabled(note.id, it) },
                                    onDelete = { pendingDelete = note },
                                )
                            }
                        }
                    }
                }
            }

            QueenSection(title = tr(UiString.MEMORY_CONTEXT_TITLE)) {
                QueenNote(text = trf(UiString.MEMORY_CONTEXT_BODY, overview.limits.conversationMessages), icon = ZarvisIcons.Chat)
            }
        }
    }

    pendingDelete?.let { note ->
        QueenConfirmDialog(
            title = tr(UiString.MEMORY_DELETE_TITLE),
            body = tr(UiString.MEMORY_DELETE_BODY),
            confirmLabel = tr(UiString.COMMON_DELETE),
            dismissLabel = tr(UiString.COMMON_CANCEL),
            onConfirm = { pendingDelete = null; viewModel.delete(note.id) },
            onDismiss = { pendingDelete = null },
            destructive = true,
            icon = ZarvisIcons.Trash,
        )
    }
    if (confirmForgetAll) {
        QueenConfirmDialog(
            title = tr(UiString.MEMORY_FORGET_TITLE),
            body = trf(UiString.MEMORY_FORGET_BODY, overview?.personal?.size ?: 0),
            confirmLabel = tr(UiString.MEMORY_FORGET_CONFIRM),
            dismissLabel = tr(UiString.COMMON_CANCEL),
            onConfirm = { confirmForgetAll = false; viewModel.forgetAllPersonal() },
            onDismiss = { confirmForgetAll = false },
            destructive = true,
            icon = ZarvisIcons.Trash,
        )
    }
}

/**
 * One personal item, typed by the user, with how many characters are left. What was typed is cleared only once the server has
 * saved it, so a failed save keeps it.
 */
@Composable
private fun AddMemoryCard(busy: Boolean, added: Boolean, onSave: (String) -> Unit) {
    var draft by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(added) { if (added) draft = "" }
    val length = draft.trim().length
    val tooLong = length > MemoryViewModel.MAX_MEMORY_CHARS
    GlassSurface(Modifier.fillMaxWidth(), contentPadding = 12.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                enabled = !busy,
                placeholder = { Text(tr(UiString.MEMORY_ADD_HINT)) },
                isError = tooLong,
                supportingText = {
                    Text(
                        if (tooLong) trf(UiString.MEMORY_ADD_TOO_LONG, MemoryViewModel.MAX_MEMORY_CHARS) else trf(UiString.MEMORY_ADD_COUNT, length, MemoryViewModel.MAX_MEMORY_CHARS),
                    )
                },
                minLines = 2,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            )
            ZarvisPrimaryButton(
                text = tr(UiString.MEMORY_ADD_SAVE),
                enabled = !busy && draft.isNotBlank() && !tooLong,
                onClick = { onSave(draft) },
                modifier = Modifier.align(Alignment.End),
            )
            if (added) Text(tr(UiString.MEMORY_ADDED), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        }
    }
}

/**
 * One saved item as a row: what it says and whether it is used, a switch that pauses or resumes it, and Delete (which asks first).
 * The switch and Delete each name their item for a screen reader. A long item (up to 2,000 characters) shows its first lines with
 * Show more, so one item cannot fill the screen; TalkBack still reads it whole.
 */
@Composable
private fun MemoryItemRow(note: MemoryNoteDto, enabled: Boolean, onUseChange: (Boolean) -> Unit, onDelete: () -> Unit) {
    val useDescription = trf(UiString.MEMORY_ITEM_USE_NAMED, note.content.take(60))
    val deleteDescription = trf(UiString.MEMORY_DELETE_ITEM_NAMED, note.content.take(60))
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(start = ZarvisSpacing.md, end = 4.dp, top = 8.dp, bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            var expanded by rememberSaveable(note.id) { mutableStateOf(false) }
            // Measured while collapsed: only an item that really is cut gets the button.
            var cut by remember(note.id, note.content) { mutableStateOf(false) }
            Text(
                note.content,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = if (expanded) Int.MAX_VALUE else COLLAPSED_LINES,
                overflow = TextOverflow.Ellipsis,
                onTextLayout = { if (!expanded) cut = it.hasVisualOverflow },
            )
            if (cut || expanded) {
                TextButton(onClick = { expanded = !expanded }, contentPadding = PaddingValues(horizontal = 0.dp)) {
                    Text(
                        tr(if (expanded) UiString.COMMON_SHOW_LESS else UiString.COMMON_SHOW_MORE),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold,
                        color = ZarvisAccents.primary,
                    )
                }
            }
            StatusBadge(
                label = tr(if (note.enabled) UiString.MEMORY_USED else UiString.MEMORY_ITEM_PAUSED),
                tone = if (note.enabled) StatusTone.SUCCESS else StatusTone.NEUTRAL,
            )
        }
        // Pausing keeps the item saved; ZARVIS only stops using it in replies.
        Box(
            Modifier
                .heightIn(min = 48.dp)
                .toggleable(value = note.enabled, enabled = enabled, role = Role.Switch, onValueChange = onUseChange)
                .semantics { contentDescription = useDescription }
                .padding(horizontal = 4.dp),
            contentAlignment = Alignment.Center,
        ) {
            Switch(checked = note.enabled, onCheckedChange = null, enabled = enabled)
        }
        IconButton(onClick = onDelete, enabled = enabled) {
            Icon(imageVector = ZarvisIcons.Trash, contentDescription = deleteDescription, tint = MaterialTheme.colorScheme.error)
        }
    }
}

/** How many lines of a saved item show before Show more. */
private const val COLLAPSED_LINES = 4
