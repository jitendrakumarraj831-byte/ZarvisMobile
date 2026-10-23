package com.zarvismobile.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.zarvismobile.core.ui.theme.ZarvisAccentCyan
import com.zarvismobile.domain.policy.AutomationRecord
import com.zarvismobile.domain.presentation.UiString
import java.time.ZoneId
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
            GlassSurface(Modifier.fillMaxWidth()) {
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

        SafetySectionTitle(tr(UiString.PHONE_SAFETY_NEVER_TITLE))
        GlassSurface(Modifier.fillMaxWidth()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                viewModel.neverDoes.forEach { promise ->
                    Text("• " + promise.text(locale), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        ReadOnlyCard(tr(UiString.PHONE_SAFETY_CONFIRM_TITLE), tr(UiString.PHONE_SAFETY_CONFIRM_BODY), ZarvisAccentCyan)

        SafetySectionTitle(tr(UiString.PHONE_SAFETY_HISTORY_TITLE))
        Text(tr(UiString.PHONE_SAFETY_HISTORY_BODY), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (state.historyReadFailed) {
            Text(tr(UiString.PHONE_SAFETY_HISTORY_READ_FAILED), color = MaterialTheme.colorScheme.error)
        }
        if (state.history.isEmpty()) {
            Text(tr(UiString.PHONE_SAFETY_HISTORY_EMPTY), style = MaterialTheme.typography.bodyMedium)
        } else {
            state.history.forEach { HistoryRow(it, locale) }
            ZarvisDestructiveButton(text = tr(UiString.PHONE_SAFETY_HISTORY_CLEAR), onClick = { confirmClear = true })
        }
    }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text(tr(UiString.PHONE_SAFETY_HISTORY_CLEAR_TITLE)) },
            text = { Text(tr(UiString.PHONE_SAFETY_HISTORY_CLEAR_BODY)) },
            confirmButton = {
                TextButton(onClick = { confirmClear = false; viewModel.clearHistory() }) { Text(tr(UiString.PHONE_SAFETY_HISTORY_CLEAR)) }
            },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text(tr(UiString.COMMON_CANCEL)) } },
        )
    }
}

@Composable
private fun HistoryRow(entry: AutomationRecord, locale: String) {
    val outcome = tr(entry.outcome.label())
    val time = HISTORY_TIME.withLocale(if (locale.startsWith("hi")) Locale("hi", "IN") else Locale.ENGLISH)
        .format(entry.at.atZone(ZoneId.systemDefault()))
    GlassSurface(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = "$outcome. ${entry.action}. $time" }) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(entry.action, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                Text(time, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            StatusBadge(label = outcome, tone = entry.outcome.tone())
        }
    }
}

@Composable
private fun SafetySectionTitle(text: String) {
    com.zarvismobile.core.ui.components.SectionKicker(text = text, modifier = Modifier.padding(top = 8.dp))
}

private val HISTORY_TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM, h:mm a")
