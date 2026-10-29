package com.zarvismobile.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.core.ui.components.AiOrb
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.QueenErrorCard
import com.zarvismobile.core.ui.components.QueenIconTile
import com.zarvismobile.core.ui.components.QueenListCard
import com.zarvismobile.core.ui.components.QueenRow
import com.zarvismobile.core.ui.components.QueenRowDivider
import com.zarvismobile.core.ui.components.QueenSection
import com.zarvismobile.core.ui.components.QueenSectionAction
import com.zarvismobile.core.ui.components.QueenStatTile
import com.zarvismobile.core.ui.components.SkeletonBlock
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisComposer
import com.zarvismobile.core.ui.components.glassFill
import com.zarvismobile.core.ui.components.toneColor
import com.zarvismobile.core.ui.i18n.LocalAppLocale
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisCorners
import com.zarvismobile.core.ui.theme.ZarvisDisplayStyles
import com.zarvismobile.core.ui.theme.ZarvisProStyles
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.domain.presentation.StatusLabels
import com.zarvismobile.domain.presentation.UiString
import java.time.LocalTime

/**
 * One quick action. [example] is the request sent to ZARVIS when the tile is tapped, so it stays in English; only the [label] is
 * translated. TalkBack hears the request as the tile's action, so it is never a surprise what a tap sends. [accent] picks the tile's
 * colour (one of the theme's text-safe accents), so the grid reads at a glance; the label still says what each one is.
 */
private data class QuickCategory(val label: UiString, val example: String, val icon: ImageVector, val accent: QuickAccent)

/** The accent family of a quick action's icon tile. Resolved per theme by [color], so it stays readable on both pages. */
private enum class QuickAccent { BLUE, CYAN, VIOLET, PRIMARY, PINK, SUCCESS }

@Composable
private fun QuickAccent.color(): Color = when (this) {
    QuickAccent.BLUE -> ZarvisAccents.blue
    QuickAccent.CYAN -> ZarvisAccents.cyan
    QuickAccent.VIOLET -> ZarvisAccents.violet
    QuickAccent.PRIMARY -> ZarvisAccents.primary
    QuickAccent.PINK -> ZarvisAccents.pink
    QuickAccent.SUCCESS -> ZarvisAccents.success
}

/** MASTER_SPEC.md §22 categories (Web, Documents, Developer, Business, Creative, Automation, Research), each starting a real request. */
private val QUICK_CATEGORIES = listOf(
    QuickCategory(UiString.HOME_CAT_WEB, "Find the best phone under 20000", ZarvisIcons.Globe, QuickAccent.BLUE),
    QuickCategory(UiString.HOME_CAT_DOCUMENTS, "Summarize this document", ZarvisIcons.File, QuickAccent.CYAN),
    QuickCategory(UiString.HOME_CAT_AUTOMATION, "Set a daily reminder for standup", ZarvisIcons.Bolt, QuickAccent.VIOLET),
    QuickCategory(UiString.HOME_CAT_RESEARCH, "Research the top 3 competitors", ZarvisIcons.Search, QuickAccent.PRIMARY),
    QuickCategory(UiString.HOME_CAT_CREATIVE, "Write a short product description", ZarvisIcons.Pen, QuickAccent.PINK),
    QuickCategory(UiString.HOME_CAT_BUSINESS, "What's important for me to do today?", ZarvisIcons.Briefcase, QuickAccent.SUCCESS),
    QuickCategory(UiString.HOME_CAT_DEVELOPER, "Check my GitHub project for errors", ZarvisIcons.Code, QuickAccent.CYAN),
)

/**
 * Home (ANDROID_QUEEN_DESIGN.md, Queen Pro board 1, refined in phase 5 and in Queen Night's dashboard pass). What a person needs
 * first is on the first screen, in the order they use it: the wordmark and Settings, a greeting for the time of day and the question
 * "What should we do?", the glowing orb (tap to speak), the Ask ZARVIS field, and the quick actions. Below them: two live tiles "at a
 * glance" (the credits left on the plan, and whether phone actions are on or paused), recent tasks, and the Phone Agent. Home is the
 * one page that keeps the full night sky behind it.
 *
 * The orb and the composer's mic open Chat already listening ([onTalk]): the orb says "Tap to speak", so that is what a tap does. The
 * microphone still goes through ZARVIS's own explanation and Android's permission first. Each quick action sends its request to
 * Chat; the last one, All skills, opens the Skills tab ([onOpenSkills]). Every number on Home is read from the server or this phone;
 * one that could not be read says so instead of showing zero.
 */
@Composable
fun HomeScreen(
    onNavigateToConversation: (initialText: String?) -> Unit,
    onNavigateToTasks: () -> Unit,
    onNavigateToSubscription: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onOpenSkills: () -> Unit,
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
            contentPadding = PaddingValues(start = ZarvisSpacing.pageGutter, end = ZarvisSpacing.pageGutter, top = ZarvisSpacing.xs, bottom = ZarvisSpacing.xl),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.section),
        ) {
            item { HomeTopBar(onOpenSettings = onNavigateToSettings) }

            item {
                HomeHero(
                    composerText = composerText,
                    onComposerChange = { composerText = it },
                    onSubmit = {
                        if (composerText.isNotBlank()) {
                            onNavigateToConversation(composerText)
                            composerText = ""
                        }
                    },
                    onTalk = onTalk,
                )
            }

            item {
                QueenSection(title = tr(UiString.HOME_QUICK_ACTIONS)) {
                    QuickActions(onAsk = { onNavigateToConversation(it) }, onOpenSkills = onOpenSkills)
                }
            }

            if (uiState.failed) {
                item {
                    // Next to what failed to load, not at the bottom. Not the raw exception text ("HTTP 500 ...", "Unable to resolve host
                    // ..."): say what failed and offer a retry.
                    QueenErrorCard(message = tr(UiString.HOME_ERROR), retryLabel = tr(UiString.COMMON_TRY_AGAIN), onRetry = viewModel::refresh)
                }
            }

            item {
                QueenSection(title = tr(UiString.HOME_AT_A_GLANCE)) {
                    AtAGlance(
                        uiState = uiState,
                        phoneActionsPaused = phoneActionsPaused,
                        onOpenPlans = onNavigateToSubscription,
                        onOpenPhoneSafety = onOpenPhoneSafety,
                    )
                }
            }

            item {
                QueenSection(
                    title = tr(UiString.HOME_RECENT_TASKS),
                    action = { QueenSectionAction(label = tr(UiString.HOME_SEE_ALL), onClick = onNavigateToTasks) },
                ) {
                    QueenListCard {
                        when {
                            uiState.tasks.isNotEmpty() -> uiState.tasks.take(3).forEachIndexed { index, task ->
                                if (index > 0) QueenRowDivider()
                                val tone = StatusLabels.taskTone(task.status, task.lifecycle)
                                // Opens Tasks, where the task's controls are; a long goal is cut at two lines here.
                                QueenRow(
                                    title = task.goal,
                                    icon = ZarvisIcons.Task,
                                    iconTint = toneColor(tone),
                                    titleMaxLines = 2,
                                    onClick = onNavigateToTasks,
                                    trailing = { StatusBadge(label = StatusLabels.taskText(task.status, task.lifecycle, locale), tone = tone) },
                                )
                            }
                            uiState.isLoading -> Column(Modifier.padding(ZarvisSpacing.md), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                SkeletonBlock(Modifier.fillMaxWidth(0.65f).height(16.dp))
                                SkeletonBlock(Modifier.fillMaxWidth(0.45f).height(16.dp))
                            }
                            // Not read: never "No tasks yet" (the error card above has Try again).
                            uiState.tasksFailed -> QueenRow(
                                title = tr(UiString.HOME_TASKS_UNAVAILABLE),
                                icon = ZarvisIcons.Alert,
                                iconTint = ZarvisAccents.danger,
                            )
                            else -> QueenRow(
                                title = tr(UiString.TASKS_EMPTY_TITLE),
                                detail = tr(UiString.HOME_NO_TASKS_HINT),
                                icon = ZarvisIcons.Task,
                                iconTint = ZarvisAccents.primary,
                            )
                        }
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
                            iconTint = ZarvisAccents.primary,
                            onClick = onOpenPhoneSafety,
                        )
                    }
                }
            }
        }
    }
}

/** The gold wordmark with what ZARVIS is under it, and Settings (TalkBack and the emulator tests find it by the word "Settings"). */
@Composable
private fun HomeTopBar(onOpenSettings: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(text = "ZARVIS", style = ZarvisDisplayStyles.brand, color = ZarvisAccents.gold)
            val tagline = tr(UiString.HOME_TAGLINE)
            // Hindi must not be letter-spaced: it breaks the joined letters.
            val latin = tagline.all { it.code < 0x0900 }
            Text(
                text = tagline,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 12.sp, letterSpacing = if (latin) 1.5.sp else 0.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(
            onClick = onOpenSettings,
            modifier = Modifier
                .size(48.dp)
                .background(GlassColors.surfaceTint.copy(alpha = 0.7f), CircleShape)
                .border(1.dp, GlassColors.border, CircleShape),
        ) {
            Icon(imageVector = ZarvisIcons.Settings, contentDescription = tr(UiString.COMMON_SETTINGS), tint = MaterialTheme.colorScheme.onSurface)
        }
    }
}

/** The greeting for the phone's time of day: morning until noon, afternoon until five, evening after. */
private fun greetingFor(hour: Int): UiString = when (hour) {
    in 5..11 -> UiString.HOME_GREETING_MORNING
    in 12..16 -> UiString.HOME_GREETING_AFTERNOON
    else -> UiString.HOME_GREETING_EVENING
}

/**
 * The first screen's centre: the greeting, the question, one line on what ZARVIS can do, the orb (breathing slowly while it waits,
 * unless motion is off), "Tap to speak", and the Ask ZARVIS field with its mic.
 */
@Composable
private fun HomeHero(composerText: String, onComposerChange: (String) -> Unit, onSubmit: () -> Unit, onTalk: () -> Unit) {
    // Read when Home is composed, which is every time it is shown.
    val greeting = remember { greetingFor(LocalTime.now().hour) }
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = ZarvisSpacing.xs),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = tr(greeting),
            style = MaterialTheme.typography.titleSmall,
            color = ZarvisAccents.primary,
            textAlign = TextAlign.Center,
        )
        Text(
            text = tr(UiString.HOME_HEADLINE),
            style = ZarvisProStyles.pageTitle,
            color = MaterialTheme.colorScheme.onBackground,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = ZarvisSpacing.xs).semantics { heading() },
        )
        Text(
            text = tr(UiString.HOME_INTRO),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = ZarvisSpacing.sm, start = ZarvisSpacing.sm, end = ZarvisSpacing.sm),
        )
        AiOrb(
            state = VoiceState.IDLE,
            onClick = onTalk,
            size = 176.dp,
            idleMotion = true,
            modifier = Modifier.padding(top = ZarvisSpacing.lg),
        )
        // The orb's own words for TalkBack already say this, so the pill is only for sighted people (it would be read twice).
        Row(
            modifier = Modifier
                .padding(top = ZarvisSpacing.sm)
                .clearAndSetSemantics { }
                .background(ZarvisAccents.primary.copy(alpha = 0.12f), ZarvisCorners.pill)
                .padding(horizontal = ZarvisSpacing.gap, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(imageVector = ZarvisIcons.Mic, contentDescription = null, tint = ZarvisAccents.primary, modifier = Modifier.size(16.dp))
            Text(text = tr(UiString.A11Y_ORB_IDLE), style = MaterialTheme.typography.labelLarge, color = ZarvisAccents.primary)
        }
        ZarvisComposer(
            value = composerText,
            onValueChange = onComposerChange,
            onSubmit = onSubmit,
            onMicClick = onTalk,
            placeholder = tr(UiString.CHAT_COMPOSER_HINT),
            modifier = Modifier.padding(top = ZarvisSpacing.lg),
        )
    }
}

/**
 * Two live tiles side by side: the credits left on the plan (opens Plans) and whether phone actions are on or paused (opens Phone
 * action safety). Each says what it is in words; one still being read shows a placeholder, and one that could not be read says so.
 */
@Composable
private fun AtAGlance(uiState: HomeUiState, phoneActionsPaused: Boolean?, onOpenPlans: () -> Unit, onOpenPhoneSafety: () -> Unit) {
    // The two tiles are always the same height, whichever has the longer label.
    Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.gap)) {
        val tile = Modifier.weight(1f).fillMaxHeight()
        val entitlement = uiState.entitlement
        when {
            entitlement != null -> QueenStatTile(
                value = entitlement.creditBalance.toString(),
                label = "${tr(UiString.PLANS_CREDITS_LEFT)} · ${StatusLabels.humanize(entitlement.plan)}",
                valueColor = ZarvisAccents.gold,
                icon = ZarvisIcons.Card,
                iconTint = ZarvisAccents.gold,
                onClick = onOpenPlans,
                modifier = tile,
            )
            uiState.isLoading -> TilePlaceholder(tile)
            else -> QueenStatTile(
                value = "—",
                label = "${tr(UiString.WORK_PLANS_TITLE)} · ${tr(UiString.WORK_SUMMARY_UNAVAILABLE)}",
                icon = ZarvisIcons.Card,
                iconTint = ZarvisAccents.gold,
                onClick = onOpenPlans,
                modifier = tile,
            )
        }
        when (phoneActionsPaused) {
            null -> TilePlaceholder(tile) // not read yet
            else -> QueenStatTile(
                value = tr(if (phoneActionsPaused) UiString.PHONE_SAFETY_OUTCOME_PAUSED else UiString.HOME_PHONE_ACTIONS_ON),
                label = tr(UiString.HOME_PHONE_ACTIONS),
                valueColor = if (phoneActionsPaused) ZarvisAccents.warning else ZarvisAccents.success,
                icon = ZarvisIcons.Shield,
                iconTint = ZarvisAccents.primary,
                onClick = onOpenPhoneSafety,
                modifier = tile,
            )
        }
    }
}

/** A tile's shape while its number is read: skeleton lines where the icon, the value and the label will be. */
@Composable
private fun TilePlaceholder(modifier: Modifier) {
    GlassSurface(modifier = modifier, contentPadding = ZarvisSpacing.gap) {
        SkeletonBlock(Modifier.size(32.dp))
        SkeletonBlock(Modifier.padding(top = ZarvisSpacing.sm).fillMaxWidth(0.5f).height(22.dp))
        SkeletonBlock(Modifier.padding(top = 6.dp).fillMaxWidth(0.8f).height(12.dp))
    }
}

/**
 * The quick actions: four to a row (two, side by side, when the phone is narrow or its text is set large, so no label is cut). A
 * category sends its request to Chat at once ([onAsk]), as its chip always did; All skills opens the Skills tab.
 */
@Composable
private fun QuickActions(onAsk: (String) -> Unit, onOpenSkills: () -> Unit) {
    val tiles = QUICK_CATEGORIES.map { category ->
        QuickTile(label = tr(category.label), icon = category.icon, accent = category.accent.color(), actionLabel = category.example, opensPage = false, onClick = { onAsk(category.example) })
    } + QuickTile(label = tr(UiString.HOME_ALL_SKILLS), icon = ZarvisIcons.Grid, accent = ZarvisAccents.primary, actionLabel = null, opensPage = true, onClick = onOpenSkills)
    val fontScale = LocalDensity.current.fontScale
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns = if (maxWidth < 340.dp || fontScale > 1.15f) 2 else 4
        Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
            tiles.chunked(columns).forEach { row ->
                Row(modifier = Modifier.height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                    row.forEach { tile -> QuickActionTile(tile = tile, wide = columns == 2, modifier = Modifier.weight(1f).fillMaxHeight()) }
                    repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * What a quick action shows and does. [actionLabel], when given, is the exact request a tap sends (TalkBack reads it as the action).
 * [opensPage] marks the one tile that opens a page instead of sending a request (All skills): it is edged in the primary.
 */
private class QuickTile(val label: String, val icon: ImageVector, val accent: Color, val actionLabel: String?, val opensPage: Boolean, val onClick: () -> Unit)

/**
 * One quick action: a glass tile with its icon on a soft wash of its accent and its label under it ([wide] false) or beside it. A
 * press shows the ripple clipped to the tile.
 */
@Composable
private fun QuickActionTile(tile: QuickTile, wide: Boolean, modifier: Modifier = Modifier) {
    val shape = ZarvisCorners.featureCard
    val pressable = modifier
        .clip(shape)
        .glassFill(GlassColors.surfaceTint, GlassColors.highlight, shape)
        .border(1.dp, if (tile.opensPage) ZarvisAccents.primary.copy(alpha = 0.35f) else GlassColors.border, shape)
        .clickable(role = Role.Button, onClickLabel = tile.actionLabel, onClick = tile.onClick)
    if (wide) {
        Row(
            modifier = pressable.heightIn(min = 64.dp).padding(horizontal = ZarvisSpacing.gap, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            QueenIconTile(icon = tile.icon, tint = tile.accent, size = 40.dp)
            Text(text = tile.label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurface)
        }
    } else {
        Column(
            modifier = pressable.heightIn(min = 92.dp).padding(horizontal = 4.dp, vertical = ZarvisSpacing.gap),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
        ) {
            QueenIconTile(icon = tile.icon, tint = tile.accent, size = 40.dp)
            Text(
                text = tile.label,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center,
                maxLines = 2,
            )
        }
    }
}
