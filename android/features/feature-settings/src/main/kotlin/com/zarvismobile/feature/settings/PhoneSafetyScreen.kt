package com.zarvismobile.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.QueenErrorCard
import com.zarvismobile.core.ui.components.SkeletonList
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisDestructiveButton
import com.zarvismobile.core.ui.i18n.LocalAppLocale
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.domain.policy.AutomationRecord
import com.zarvismobile.domain.presentation.UiString
import java.time.ZoneId
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import com.zarvismobile.core.ui.components.QueenConfirmDialog
import com.zarvismobile.core.ui.components.QueenListCard
import com.zarvismobile.core.ui.components.QueenNote
import com.zarvismobile.core.ui.components.QueenRow
import com.zarvismobile.core.ui.components.QueenRowDivider
import com.zarvismobile.core.ui.components.QueenSection
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Settings › Phone action safety (AUTOMATION_SECURITY_POLICY.md): the switch that pauses every phone action, what ZARVIS never
 * does, what it always asks first, and the history of phone actions kept on this phone, which the user can clear.
 */
@Composable
fun PhoneSafetyContent(viewModel: PhoneSafetyViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsState()
    val locale = LocalAppLocale.current
    var confirmClear by rememberSaveable { mutableStateOf(false) }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (state.readFailed) {
            QueenErrorCard(message = tr(UiString.PHONE_SAFETY_READ_FAILED), retryLabel = tr(UiString.COMMON_TRY_AGAIN), onRetry = viewModel::load)
        }
        val paused = state.paused
        if (paused == null) {
            if (!state.readFailed) SkeletonList(loadingLabel = tr(UiString.COMMON_LOADING), rows = 1)
        } else {
            GlassSurface(Modifier.fillMaxWidth(), borderColor = ZarvisAccents.primary.copy(alpha = 0.30f)) {
                SettingSwitchRow(
                    title = tr(UiString.PHONE_SAFETY_PAUSE_TITLE),
                    subtitle = tr(if (paused) UiString.PHONE_SAFETY_PAUSE_ON else UiString.PHONE_SAFETY_PAUSE_OFF),
                    checked = paused,
                    onCheckedChange = viewModel::setPaused,
                )
            }
        }
        if (state.saveFailed) {
            Text(tr(UiString.PHONE_SAFETY_SAVE_FAILED), color = MaterialTheme.colorScheme.error)
        }

        QueenSection(title = tr(UiString.PHONE_SAFETY_CONFIRM_TITLE)) {
            QueenNote(text = tr(UiString.PHONE_SAFETY_CONFIRM_BODY), icon = ZarvisIcons.Check, tint = ZarvisAccents.cyan)
        }

        QueenSection(title = tr(UiString.PHONE_SAFETY_NEVER_TITLE)) {
            QueenListCard {
                viewModel.neverDoes.forEachIndexed { index, promise ->
                    if (index > 0) QueenRowDivider()
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = ZarvisSpacing.md, vertical = 11.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Icon(ZarvisIcons.X, contentDescription = null, tint = ZarvisAccents.danger, modifier = Modifier.padding(top = 1.dp).size(18.dp))
                        Text(promise.text(locale), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }

        QueenSection(title = tr(UiString.PHONE_SAFETY_HISTORY_TITLE), hint = tr(UiString.PHONE_SAFETY_HISTORY_BODY)) {
            if (state.historyReadFailed) {
                Text(tr(UiString.PHONE_SAFETY_HISTORY_READ_FAILED), color = MaterialTheme.colorScheme.error)
            }
            if (state.history.isEmpty()) {
                QueenListCard { QueenRow(title = tr(UiString.PHONE_SAFETY_HISTORY_EMPTY), icon = ZarvisIcons.Clock) }
            } else {
                QueenListCard {
                    state.history.forEachIndexed { index, entry ->
                        if (index > 0) QueenRowDivider()
                        HistoryRow(entry, locale)
                    }
                }
                ZarvisDestructiveButton(text = tr(UiString.PHONE_SAFETY_HISTORY_CLEAR), onClick = { confirmClear = true }, modifier = Modifier.fillMaxWidth())
            }
        }
    }

    if (confirmClear) {
        QueenConfirmDialog(
            title = tr(UiString.PHONE_SAFETY_HISTORY_CLEAR_TITLE),
            body = tr(UiString.PHONE_SAFETY_HISTORY_CLEAR_BODY),
            confirmLabel = tr(UiString.PHONE_SAFETY_HISTORY_CLEAR),
            dismissLabel = tr(UiString.COMMON_CANCEL),
            onConfirm = { confirmClear = false; viewModel.clearHistory() },
            onDismiss = { confirmClear = false },
            destructive = true,
            icon = ZarvisIcons.Trash,
        )
    }
}

@Composable
private fun HistoryRow(entry: AutomationRecord, locale: String) {
    val outcome = tr(entry.outcome.label())
    val time = HISTORY_TIME.withLocale(if (locale.startsWith("hi")) Locale("hi", "IN") else Locale.ENGLISH)
        .format(entry.at.atZone(ZoneId.systemDefault()))
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .semantics(mergeDescendants = true) { contentDescription = "$outcome. ${entry.action}. $time" }
            .padding(horizontal = ZarvisSpacing.md, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(entry.action, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Text(time, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        StatusBadge(label = outcome, tone = entry.outcome.tone())
    }
}

private val HISTORY_TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM, h:mm a")
