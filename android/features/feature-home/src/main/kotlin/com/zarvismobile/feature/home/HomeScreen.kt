package com.zarvismobile.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Work
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.core.ui.components.AiOrb
import com.zarvismobile.core.ui.components.ZarvisCard
import com.zarvismobile.core.ui.components.ZarvisChip
import com.zarvismobile.core.ui.components.ZarvisComposer
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.i18n.LocalAppLocale
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.i18n.trf
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.domain.presentation.StatusLabels
import com.zarvismobile.domain.presentation.UiString

/** [example] is the request sent to ZARVIS when the chip is tapped, so it stays in English; only the [label] is translated. */
private data class QuickCategory(val label: UiString, val icon: ImageVector, val example: String)

/** MASTER_SPEC.md §22 "2-Row Compact Category Chips": Web, Documents, Developer, Business, Creative, Automation, Research. */
private val QUICK_CATEGORIES = listOf(
    QuickCategory(UiString.HOME_CAT_WEB, Icons.Filled.Public, "Find the best phone under 20000"),
    QuickCategory(UiString.HOME_CAT_DOCUMENTS, Icons.Filled.Description, "Summarize this document"),
    QuickCategory(UiString.HOME_CAT_DEVELOPER, Icons.Filled.Code, "Check my GitHub project for errors"),
    QuickCategory(UiString.HOME_CAT_BUSINESS, Icons.Filled.Work, "What's important for me to do today?"),
    QuickCategory(UiString.HOME_CAT_CREATIVE, Icons.Filled.Brush, "Write a short product description"),
    QuickCategory(UiString.HOME_CAT_AUTOMATION, Icons.Filled.Autorenew, "Set a daily reminder for standup"),
    QuickCategory(UiString.HOME_CAT_RESEARCH, Icons.Filled.Search, "Research the top 3 competitors"),
)

/** Workspace screen — MASTER_SPEC.md §22 "Workspace Page (/)": voice orb + composer + quick categories. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(
    onNavigateToConversation: (initialText: String?) -> Unit,
    onNavigateToTasks: () -> Unit,
    onNavigateToSubscription: () -> Unit,
    onNavigateToDeveloper: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToCapabilities: () -> Unit = {},
    onOpenFeature: (String) -> Unit = {},
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    var composerText by remember { mutableStateOf("") }
    val locale = LocalAppLocale.current
    LifecycleResumeEffect(Unit) {
        viewModel.refresh()
        onPauseOrDispose { }
    }

    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.fillMaxSize()) {
            LazyColumn(
                modifier = Modifier.fillMaxSize().statusBarsPadding(),
                contentPadding = PaddingValues(ZarvisSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.lg),
            ) {
                item {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        IconButton(onClick = onNavigateToSettings) {
                            Icon(
                                imageVector = Icons.Filled.Settings,
                                contentDescription = tr(UiString.COMMON_SETTINGS),
                            )
                        }
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                        Text(text = "ZARVIS", style = MaterialTheme.typography.displayLarge.copy(fontSize = 34.sp, letterSpacing = 2.sp))
                        Text(text = tr(UiString.HOME_TAGLINE), style = MaterialTheme.typography.labelMedium.copy(letterSpacing = 2.sp), color = MaterialTheme.colorScheme.primary)
                        Text(
                            text = tr(UiString.HOME_INTRO),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                    }
                }

                item {
                    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        AiOrb(state = VoiceState.IDLE, size = 72.dp, onClick = { onNavigateToConversation(null) })
                    }
                }

                item {
                    ZarvisComposer(
                        value = composerText,
                        onValueChange = { composerText = it },
                        onSubmit = {
                            if (composerText.isNotBlank()) {
                                onNavigateToConversation(composerText)
                                composerText = ""
                            }
                        },
                        onMicClick = { onNavigateToConversation(null) },
                        placeholder = tr(UiString.CHAT_COMPOSER_HINT),
                    )
                }

                item {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
                        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
                        maxItemsInEachRow = 4,
                    ) {
                        QUICK_CATEGORIES.forEach { category ->
                            ZarvisChip(
                                label = tr(category.label),
                                icon = category.icon,
                                onClick = { onNavigateToConversation(category.example) },
                            )
                        }
                    }
                }

                item {
                    ZarvisCard(modifier = Modifier.fillMaxWidth()) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(text = tr(UiString.HOME_CAPABILITIES_TITLE), style = MaterialTheme.typography.titleMedium)
                        }
                        Text(
                            text = tr(UiString.HOME_CAPABILITIES_BODY),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(onClick = onNavigateToCapabilities) {
                            Text(trf(UiString.HOME_BROWSE_SKILLS, uiState.skills.size))
                        }
                    }
                }

                item {
                    ZarvisCard(modifier = Modifier.fillMaxWidth()) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(text = tr(UiString.HOME_SUBSCRIPTION), style = MaterialTheme.typography.titleMedium)
                        }
                        val entitlement = uiState.entitlement
                        if (entitlement != null) {
                            Text(trf(UiString.HOME_PLAN_LINE, StatusLabels.humanize(entitlement.plan), entitlement.creditBalance))
                        } else if (uiState.isLoading) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp))
                        }
                        TextButton(onClick = onNavigateToSubscription) {
                            Text(tr(UiString.HOME_MANAGE_SUBSCRIPTION))
                        }
                    }
                }

                item {
                    ZarvisCard(modifier = Modifier.fillMaxWidth()) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(text = tr(UiString.HOME_RECENT_TASKS), style = MaterialTheme.typography.titleMedium)
                            TextButton(onClick = onNavigateToTasks) { Text(tr(UiString.HOME_SEE_ALL)) }
                        }
                        if (uiState.tasks.isEmpty() && !uiState.isLoading) {
                            Text(
                                text = tr(UiString.HOME_NO_TASKS),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        uiState.tasks.take(3).forEach { task ->
                            Text(text = "${task.goal} · ${StatusLabels.taskText(task.status, task.lifecycle, locale)}", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }

                item {
                    ZarvisCard(modifier = Modifier.fillMaxWidth()) {
                        Text(tr(UiString.HOME_PHONE_AGENT), style = MaterialTheme.typography.titleMedium)
                        Text(
                            tr(UiString.HOME_PHONE_AGENT_BODY),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(onClick = { onOpenFeature("phone") }) { Text(tr(UiString.HOME_OPEN_PHONE_AGENT)) }
                    }
                }

                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                        TextButton(onClick = { onOpenFeature("voice") }) { Text(tr(UiString.HOME_VOICE_ASSISTANT)) }
                        TextButton(onClick = { onOpenFeature("developer") }) { Text(tr(UiString.HOME_DEVELOPER_AGENT)) }
                    }
                }

                if (uiState.error != null) {
                    item {
                        // Not the raw exception text ("HTTP 500 ...", "Unable to resolve host ..."): say what failed and offer a retry.
                        Text(text = tr(UiString.HOME_ERROR), color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = viewModel::refresh) { Text(tr(UiString.COMMON_TRY_AGAIN)) }
                    }
                }

                item { Spacer(modifier = Modifier.size(ZarvisSpacing.xxl)) }
            }
        }
    }
}
