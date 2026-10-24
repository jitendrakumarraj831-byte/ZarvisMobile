package com.zarvismobile.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.core.ui.components.AiOrb
import com.zarvismobile.core.ui.components.QueenErrorCard
import com.zarvismobile.core.ui.components.QueenListCard
import com.zarvismobile.core.ui.components.QueenRow
import com.zarvismobile.core.ui.components.QueenRowDivider
import com.zarvismobile.core.ui.components.QueenSection
import com.zarvismobile.core.ui.components.SectionKicker
import com.zarvismobile.core.ui.components.SkeletonBlock
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisChip
import com.zarvismobile.core.ui.components.ZarvisComposer
import com.zarvismobile.core.ui.components.toneColor
import com.zarvismobile.core.ui.i18n.LocalAppLocale
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.i18n.trf
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisDisplayStyles
import com.zarvismobile.core.ui.theme.ZarvisProStyles
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.domain.presentation.StatusLabels
import com.zarvismobile.domain.presentation.StatusTone
import com.zarvismobile.domain.presentation.UiString

/** [example] is the request sent to ZARVIS when the chip is tapped, so it stays in English; only the [label] is translated. */
private data class QuickCategory(val label: UiString, val example: String)

/** MASTER_SPEC.md §22 "2-Row Compact Category Chips": Web, Documents, Developer, Business, Creative, Automation, Research. */
private val QUICK_CATEGORIES = listOf(
    QuickCategory(UiString.HOME_CAT_WEB, "Find the best phone under 20000"),
    QuickCategory(UiString.HOME_CAT_DOCUMENTS, "Summarize this document"),
    QuickCategory(UiString.HOME_CAT_AUTOMATION, "Set a daily reminder for standup"),
    QuickCategory(UiString.HOME_CAT_RESEARCH, "Research the top 3 competitors"),
    QuickCategory(UiString.HOME_CAT_CREATIVE, "Write a short product description"),
    QuickCategory(UiString.HOME_CAT_BUSINESS, "What's important for me to do today?"),
    QuickCategory(UiString.HOME_CAT_DEVELOPER, "Check my GitHub project for errors"),
)

/** The three "Try" requests: sent as written in the app's language, which ZARVIS understands. */
private val SUGGESTIONS = listOf(
    UiString.CHAT_SUGGEST_CAMERA to ZarvisIcons.Camera,
    UiString.CHAT_SUGGEST_REMINDER to ZarvisIcons.Clock,
    UiString.CHAT_SUGGEST_WRITE to ZarvisIcons.Pen,
)

/**
 * Home (ANDROID_QUEEN_DESIGN.md, Queen Pro board 1): the wordmark and Settings, the question "What should we do?" with the orb and
 * the composer, three requests to try, what ZARVIS does on this phone (Phone Agent, and Phone action safety with its live On /
 * Paused state), recent tasks, the categories, and the plan. Home is the one page that keeps the full Queen sky behind it.
 *
 * The orb and the composer's mic open Chat already listening ([onTalk]): the orb says "Tap to speak", so that is what a tap does. The
 * microphone still goes through ZARVIS's own explanation and Android's permission first.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(
    onNavigateToConversation: (initialText: String?) -> Unit,
    onNavigateToTasks: () -> Unit,
    onNavigateToSubscription: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onOpenPhoneSafety: () -> Unit = onNavigateToSettings,
    onOpenFeature: (String) -> Unit = {},
    onTalk: () -> Unit = { onNavigateToConversation(null) },
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val phoneActionsPaused by viewModel.phoneActionsPaused.collectAsState()
    // Saveable: a half-typed request survives turning the phone and a visit to another tab.
    var composerText by rememberSaveable { mutableStateOf("") }
    val locale = LocalAppLocale.current
    LifecycleResumeEffect(Unit) {
        viewModel.refresh()
        onPauseOrDispose { }
    }

    ZarvisBackground(modifier = Modifier.fillMaxSize(), decorated = true) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(horizontal = ZarvisSpacing.md, vertical = ZarvisSpacing.sm),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(text = "ZARVIS", style = ZarvisDisplayStyles.brand, color = ZarvisAccents.gold, modifier = Modifier.weight(1f))
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(imageVector = ZarvisIcons.Settings, contentDescription = tr(UiString.COMMON_SETTINGS), tint = MaterialTheme.colorScheme.onSurface)
                    }
                }
            }

            item {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
                ) {
                    SectionKicker(text = tr(UiString.HOME_TAGLINE), isHeading = false)
                    Text(
                        text = tr(UiString.HOME_HEADLINE),
                        style = ZarvisProStyles.pageTitle,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.semantics { heading() },
                    )
                    Text(
                        text = tr(UiString.HOME_INTRO),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                    // Still while idle (see AiOrb): the first thing on screen costs nothing to keep open.
                    AiOrb(state = VoiceState.IDLE, size = 120.dp, onClick = onTalk, modifier = Modifier.padding(top = ZarvisSpacing.sm))
                    Text(text = tr(UiString.A11Y_ORB_IDLE), style = MaterialTheme.typography.labelLarge, color = ZarvisAccents.gold)
                    ZarvisComposer(
                        value = composerText,
                        onValueChange = { composerText = it },
                        onSubmit = {
                            if (composerText.isNotBlank()) {
                                onNavigateToConversation(composerText)
                                composerText = ""
                            }
                        },
                        onMicClick = onTalk,
                        placeholder = tr(UiString.CHAT_COMPOSER_HINT),
                        modifier = Modifier.padding(top = ZarvisSpacing.xs),
                    )
                }
            }

            item {
                QueenSection(title = tr(UiString.HOME_TRY)) {
                    SUGGESTIONS.forEach { (text, icon) ->
                        val request = tr(text)
                        ZarvisChip(label = request, icon = icon, onClick = { onNavigateToConversation(request) })
                    }
                }
            }

            item {
                QueenSection(title = tr(UiString.WORK_ON_THIS_PHONE)) {
                    QueenListCard {
                        QueenRow(
                            title = tr(UiString.HOME_PHONE_AGENT),
                            detail = tr(UiString.HOME_PHONE_AGENT_SHORT),
                            icon = ZarvisIcons.Phone,
                            iconTint = ZarvisAccents.cyan,
                            onClick = { onOpenFeature("phone") },
                        )
                        QueenRowDivider()
                        QueenRow(
                            title = tr(UiString.SETTINGS_PAGE_PHONE_SAFETY),
                            detail = tr(UiString.HOME_PHONE_SAFETY_SHORT),
                            icon = ZarvisIcons.Shield,
                            iconTint = ZarvisAccents.gold,
                            onClick = onOpenPhoneSafety,
                            trailing = {
                                when (phoneActionsPaused) {
                                    true -> StatusBadge(label = tr(UiString.PHONE_SAFETY_OUTCOME_PAUSED), tone = StatusTone.WAITING)
                                    false -> StatusBadge(label = tr(UiString.HOME_PHONE_ACTIONS_ON), tone = StatusTone.SUCCESS)
                                    null -> Unit // not read yet
                                }
                            },
                        )
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.xs)) {
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        SectionKicker(text = tr(UiString.HOME_RECENT_TASKS), modifier = Modifier.weight(1f))
                        TextButton(onClick = onNavigateToTasks) { Text(tr(UiString.HOME_SEE_ALL), color = ZarvisAccents.gold, fontWeight = FontWeight.Bold) }
                    }
                    QueenListCard {
                        when {
                            uiState.tasks.isNotEmpty() -> uiState.tasks.take(3).forEachIndexed { index, task ->
                                if (index > 0) QueenRowDivider()
                                val tone = StatusLabels.taskTone(task.status, task.lifecycle)
                                QueenRow(
                                    title = task.goal,
                                    icon = ZarvisIcons.Task,
                                    iconTint = toneColor(tone),
                                    trailing = { StatusBadge(label = StatusLabels.taskText(task.status, task.lifecycle, locale), tone = tone) },
                                )
                            }
                            uiState.isLoading -> Column(Modifier.padding(ZarvisSpacing.md), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                SkeletonBlock(Modifier.fillMaxWidth(0.65f).height(16.dp))
                                SkeletonBlock(Modifier.fillMaxWidth(0.45f).height(16.dp))
                            }
                            else -> QueenRow(
                                title = tr(UiString.TASKS_EMPTY_TITLE),
                                detail = tr(UiString.HOME_NO_TASKS_HINT),
                                icon = ZarvisIcons.Task,
                            )
                        }
                    }
                }
            }

            item {
                QueenSection(title = tr(UiString.HOME_CAPABILITIES_TITLE)) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
                        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
                    ) {
                        QUICK_CATEGORIES.forEach { category ->
                            ZarvisChip(label = tr(category.label), onClick = { onNavigateToConversation(category.example) })
                        }
                    }
                }
            }

            item {
                QueenSection(title = tr(UiString.HOME_PLAN)) {
                    QueenListCard {
                        val entitlement = uiState.entitlement
                        when {
                            entitlement != null -> QueenRow(
                                title = StatusLabels.humanize(entitlement.plan),
                                detail = trf(UiString.HOME_PLAN_LINE, StatusLabels.humanize(entitlement.plan), entitlement.creditBalance),
                                icon = ZarvisIcons.Card,
                                iconTint = ZarvisAccents.gold,
                                onClick = onNavigateToSubscription,
                            )
                            uiState.isLoading -> Column(Modifier.padding(ZarvisSpacing.md)) { SkeletonBlock(Modifier.fillMaxWidth(0.7f).height(16.dp)) }
                            else -> QueenRow(title = tr(UiString.WORK_PLANS_TITLE), icon = ZarvisIcons.Card, iconTint = ZarvisAccents.gold, onClick = onNavigateToSubscription)
                        }
                    }
                }
            }

            if (uiState.error != null) {
                item {
                    // Not the raw exception text ("HTTP 500 ...", "Unable to resolve host ..."): say what failed and offer a retry.
                    QueenErrorCard(message = tr(UiString.HOME_ERROR), retryLabel = tr(UiString.COMMON_TRY_AGAIN), onRetry = viewModel::refresh)
                }
            }

            item { Spacer(modifier = Modifier.size(ZarvisSpacing.xl)) }
        }
    }
}
