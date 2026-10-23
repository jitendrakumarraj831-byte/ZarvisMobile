package com.zarvismobile.feature.home

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Work
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.core.ui.components.AiOrb
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.GoldDivider
import com.zarvismobile.core.ui.components.GoldText
import com.zarvismobile.core.ui.components.Jewel
import com.zarvismobile.core.ui.components.JewelIcon
import com.zarvismobile.core.ui.components.QueenCrown
import com.zarvismobile.core.ui.components.QueenErrorCard
import com.zarvismobile.core.ui.components.SectionKicker
import com.zarvismobile.core.ui.components.SkeletonBlock
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisChip
import com.zarvismobile.core.ui.components.ZarvisComposer
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.i18n.LocalAppLocale
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.i18n.trf
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisDisplayStyles
import com.zarvismobile.core.ui.theme.ZarvisRose
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.domain.presentation.StatusLabels
import com.zarvismobile.domain.presentation.StatusTone
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

/**
 * Workspace screen — MASTER_SPEC.md §22 "Workspace Page (/)": voice orb + composer + quick categories, in the Queen layout
 * (ANDROID_QUEEN_DESIGN.md, board A03): the gold wordmark, the crowned orb, the gold-edged composer, the category chips, and jewel
 * cards for skills, the plan, recent tasks and the agents.
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
    onNavigateToDeveloper: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToCapabilities: () -> Unit = {},
    onOpenFeature: (String) -> Unit = {},
    onTalk: () -> Unit = { onNavigateToConversation(null) },
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    // Saveable: a half-typed request survives turning the phone and a visit to another tab.
    var composerText by rememberSaveable { mutableStateOf("") }
    val locale = LocalAppLocale.current
    LifecycleResumeEffect(Unit) {
        viewModel.refresh()
        onPauseOrDispose { }
    }

    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(horizontal = ZarvisSpacing.md, vertical = ZarvisSpacing.sm),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                Row(modifier = Modifier.fillMaxWidth().padding(start = ZarvisSpacing.xs), verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        GoldText(text = "ZARVIS", style = ZarvisDisplayStyles.brand)
                        SectionKicker(text = tr(UiString.HOME_TAGLINE), isHeading = false)
                    }
                    IconButton(
                        onClick = onNavigateToSettings,
                        modifier = Modifier.background(GlassColors.surfaceTintElevated, CircleShape),
                    ) {
                        Icon(imageVector = Icons.Filled.Settings, contentDescription = tr(UiString.COMMON_SETTINGS), tint = ZarvisAccents.gold)
                    }
                }
            }

            item {
                Text(
                    text = tr(UiString.HOME_INTRO),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = ZarvisSpacing.xs),
                )
            }

            item {
                // The crowned orb. Still while idle (see AiOrb): the first thing on screen costs nothing to keep open.
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                    // Compact enough that the composer and the category chips stay on the first screen of a small phone.
                    Box(modifier = Modifier.fillMaxWidth().height(180.dp), contentAlignment = Alignment.TopCenter) {
                        AiOrb(state = VoiceState.IDLE, size = 132.dp, onClick = onTalk, modifier = Modifier.padding(top = 44.dp))
                        QueenCrown(width = 64.dp, modifier = Modifier.padding(top = 2.dp))
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                        Box(Modifier.size(7.dp).background(ZarvisAccents.gold, CircleShape))
                        SectionKicker(text = tr(UiString.A11Y_ORB_IDLE), isHeading = false)
                    }
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
                    onMicClick = onTalk,
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
                GlassSurface(modifier = Modifier.fillMaxWidth(), contentPadding = 18.dp) {
                    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        JewelIcon(ZarvisIcons.Grid, Jewel.AMETHYST, size = 48.dp)
                        Column(Modifier.weight(1f)) {
                            Text(text = tr(UiString.HOME_CAPABILITIES_TITLE), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                            Text(
                                text = tr(UiString.HOME_CAPABILITIES_BODY),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    ZarvisPrimaryButton(
                        text = trf(UiString.HOME_BROWSE_SKILLS, uiState.skills.size),
                        onClick = onNavigateToCapabilities,
                        modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                    )
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                    GlassSurface(modifier = Modifier.fillMaxWidth()) {
                        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            JewelIcon(ZarvisIcons.Card, Jewel.GOLD)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                SectionKicker(text = tr(UiString.HOME_SUBSCRIPTION))
                                val entitlement = uiState.entitlement
                                if (entitlement != null) {
                                    Text(
                                        trf(UiString.HOME_PLAN_LINE, StatusLabels.humanize(entitlement.plan), entitlement.creditBalance),
                                        style = MaterialTheme.typography.bodyLarge,
                                        fontWeight = FontWeight.Bold,
                                    )
                                } else if (uiState.isLoading) {
                                    SkeletonBlock(Modifier.fillMaxWidth(0.7f).height(16.dp))
                                }
                            }
                        }
                    }
                    ZarvisSecondaryButton(
                        text = tr(UiString.HOME_MANAGE_SUBSCRIPTION),
                        onClick = onNavigateToSubscription,
                        modifier = Modifier.align(Alignment.End),
                    )
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.xs)) {
                    Row(modifier = Modifier.fillMaxWidth().padding(start = ZarvisSpacing.xs), verticalAlignment = Alignment.CenterVertically) {
                        SectionKicker(text = tr(UiString.HOME_RECENT_TASKS), modifier = Modifier.weight(1f))
                        TextButton(onClick = onNavigateToTasks) { Text(tr(UiString.HOME_SEE_ALL), color = ZarvisAccents.pink, fontWeight = FontWeight.Bold) }
                    }
                    GlassSurface(modifier = Modifier.fillMaxWidth(), contentPadding = 0.dp) {
                        when {
                            uiState.tasks.isNotEmpty() -> uiState.tasks.take(3).forEachIndexed { index, task ->
                                if (index > 0) GoldDivider()
                                val tone = StatusLabels.taskTone(task.status, task.lifecycle)
                                Row(
                                    modifier = Modifier.fillMaxWidth().heightIn(min = 62.dp).padding(horizontal = 14.dp, vertical = 10.dp),
                                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    JewelIcon(ZarvisIcons.Task, jewelFor(tone))
                                    Text(
                                        text = task.goal,
                                        style = MaterialTheme.typography.bodyLarge,
                                        fontWeight = FontWeight.Bold,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f),
                                    )
                                    StatusBadge(label = StatusLabels.taskText(task.status, task.lifecycle, locale), tone = tone)
                                }
                            }
                            uiState.isLoading -> Column(Modifier.padding(ZarvisSpacing.md), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                SkeletonBlock(Modifier.fillMaxWidth(0.65f).height(16.dp))
                                SkeletonBlock(Modifier.fillMaxWidth(0.45f).height(16.dp))
                            }
                            else -> Text(
                                text = tr(UiString.HOME_NO_TASKS),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(ZarvisSpacing.md),
                            )
                        }
                    }
                }
            }

            item {
                GlassSurface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            // Fully qualified: Icons.Filled.Brush is imported above for the Creative chip.
                            androidx.compose.ui.graphics.Brush.linearGradient(listOf(ZarvisRose.copy(alpha = 0.14f), ZarvisAccents.violet.copy(alpha = 0.10f))),
                            RoundedCornerShape(20.dp),
                        ),
                    contentPadding = 18.dp,
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        JewelIcon(ZarvisIcons.Phone, Jewel.RUBY, size = 48.dp)
                        Column(Modifier.weight(1f)) {
                            Text(tr(UiString.HOME_PHONE_AGENT), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                            Text(
                                tr(UiString.HOME_PHONE_AGENT_BODY),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    ZarvisSecondaryButton(
                        text = tr(UiString.HOME_OPEN_PHONE_AGENT),
                        onClick = { onOpenFeature("phone") },
                        modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                    )
                }
            }

            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    AgentTile(tr(UiString.HOME_VOICE_ASSISTANT), ZarvisIcons.Mic, Jewel.AMETHYST, Modifier.weight(1f)) { onOpenFeature("voice") }
                    AgentTile(tr(UiString.HOME_DEVELOPER_AGENT), ZarvisIcons.Code, Jewel.EMERALD, Modifier.weight(1f)) { onOpenFeature("developer") }
                }
            }

            if (uiState.error != null) {
                item {
                    // Not the raw exception text ("HTTP 500 ...", "Unable to resolve host ..."): say what failed and offer a retry.
                    QueenErrorCard(message = tr(UiString.HOME_ERROR), retryLabel = tr(UiString.COMMON_TRY_AGAIN), onRetry = viewModel::refresh)
                }
            }

            item { Spacer(modifier = Modifier.size(ZarvisSpacing.xxl)) }
        }
    }
}

/** A square glass tile that opens an agent: its jewel icon at the top, its name at the bottom. One button. */
@Composable
private fun AgentTile(label: String, icon: ImageVector, jewel: Jewel, modifier: Modifier = Modifier, onClick: () -> Unit) {
    GlassSurface(modifier = modifier.heightIn(min = 104.dp), contentPadding = 14.dp, onClick = onClick) {
        JewelIcon(icon, jewel)
        Spacer(Modifier.height(ZarvisSpacing.md))
        Text(label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Start)
    }
}

/** The jewel behind a task's icon follows its status, so the list reads at a glance (the badge still says it in words). */
private fun jewelFor(tone: StatusTone): Jewel = when (tone) {
    StatusTone.ACTIVE -> Jewel.SAPPHIRE
    StatusTone.WAITING -> Jewel.GOLD
    StatusTone.SUCCESS -> Jewel.EMERALD
    StatusTone.PROBLEM -> Jewel.RUBY
    StatusTone.NEUTRAL -> Jewel.AMETHYST
}
