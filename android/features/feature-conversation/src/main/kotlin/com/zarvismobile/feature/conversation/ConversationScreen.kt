package com.zarvismobile.feature.conversation

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.TextButton
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.core.ui.components.AiOrb
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.GlowColorsFor
import com.zarvismobile.core.ui.components.GoldText
import com.zarvismobile.core.ui.components.QueenBackButton
import com.zarvismobile.core.ui.components.QueenCrown
import com.zarvismobile.core.ui.components.ZarvisChip
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.components.MarkdownText
import com.zarvismobile.core.ui.components.ZarvisCard
import com.zarvismobile.core.ui.components.ZarvisComposer
import com.zarvismobile.core.ui.components.StatusPulseBadge
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.i18n.trf
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisDisplayStyles
import com.zarvismobile.core.ui.theme.ZarvisGold
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.core.ui.theme.zarvisActionBrush
import com.zarvismobile.core.ui.theme.zarvisReduceMotion
import com.zarvismobile.domain.presentation.StatusTone
import com.zarvismobile.domain.presentation.UiString
import com.zarvismobile.domain.entity.ToolResultStatus

/**
 * The full voice/text conversation surface — MASTER_SPEC.md §11, §23. Reached from
 * Workspace's orb/composer/quick-categories; every [VoiceState] is rendered distinctly via
 * [AiOrb] plus a [StatusPulseBadge] so the user always knows what ZARVIS is doing, from the
 * very first frame after they submit a turn (the optimistic "Executing…" feedback is this
 * badge, driven by the same state the ViewModel already sets synchronously before the
 * network call starts).
 */
@Composable
fun ConversationScreen(
    initialText: String?,
    submitInitialText: Boolean = true,
    listenOnStart: Boolean = false,
    onBack: (() -> Unit)? = null,
    viewModel: ConversationViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    val density = LocalDensity.current
    val imeInsets = WindowInsets.ime
    // derivedStateOf: the screen recomposes when the keyboard opens or closes, not on every frame of its slide.
    val keyboardOpen by remember { derivedStateOf { imeInsets.getBottom(density) > 0 } }

    LaunchedEffect(initialText, submitInitialText, listenOnStart) {
        // Runs again after rotation / process recreation; the ViewModel handles it only once.
        viewModel.onStartRequest(initialText, submitInitialText, listenOnStart)
    }

    LaunchedEffect(uiState.turns.size) {
        if (uiState.turns.isNotEmpty()) listState.animateScrollToItem(uiState.turns.size - 1)
    }

    // Back while the microphone is open stops listening first, instead of leaving the chat with the mic still on.
    BackHandler(enabled = uiState.voiceState == VoiceState.LISTENING) { viewModel.cancelListening() }

    // The Chat tab and a chat opened from Home continue the same server conversation. Coming back to one of them picks up what
    // the other added, so neither shows a stale half.
    LifecycleResumeEffect(Unit) {
        viewModel.syncWithServer()
        onPauseOrDispose { }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(tr(UiString.CHAT_DELETE_TITLE)) },
            text = { Text(tr(UiString.CHAT_DELETE_BODY)) },
            confirmButton = {
                TextButton(onClick = { confirmDelete = false; viewModel.deleteConversation() }) {
                    Text(tr(UiString.COMMON_DELETE), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(tr(UiString.COMMON_CANCEL)) } },
        )
    }

    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        // No Scaffold bottomBar on this route (MASTER_SPEC.md §23 — Conversation is a
        // full-screen destination), so nothing else claims the gesture-nav-bar inset for it;
        // without navigationBarsPadding() the composer/orb would sit flush against or under
        // it. imePadding() raises the same content above the keyboard instead of it covering
        // the composer — the "content remains usable while typing" requirement (MASTER_SPEC
        // §11 "text input must also remain available").
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding(),
        ) {
            // The header is always there: "New chat" used to exist only on a chat opened from Home, so the Chat tab could never start fresh.
            // Back is shown only when there is somewhere to go back to (the Chat tab is a tab, and the system Back button leaves it).
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = ZarvisSpacing.md, vertical = ZarvisSpacing.xs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
            ) {
                if (onBack != null) QueenBackButton(label = tr(UiString.COMMON_BACK), onClick = onBack)
                // The title shares the row only on the Chat tab (no Back); with Back it sits on its own line below.
                if (onBack == null) {
                    // titleMedium: it shares a 360dp row with New chat and Delete.
                    GoldText(
                        text = tr(UiString.CHAT_TITLE),
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.ExtraBold),
                        modifier = Modifier.weight(1f).semantics { heading() },
                    )
                } else {
                    Spacer(Modifier.weight(1f))
                }
                // Always enabled: after a failed restore the screen can look empty while the server still holds the conversation, and the user must be able to leave it.
                ZarvisChip(label = tr(UiString.CHAT_NEW), onClick = viewModel::startNewConversation, icon = ZarvisIcons.Plus)
                // Offered only once there is something to delete, and not while a reply is on its way or a delete is already out.
                if (uiState.turns.isNotEmpty()) {
                    val idle = uiState.voiceState == VoiceState.IDLE || uiState.voiceState == VoiceState.SUCCESS || uiState.voiceState == VoiceState.ERROR
                    TextButton(onClick = { confirmDelete = true }, enabled = idle && !uiState.deleting) {
                        Text(tr(UiString.COMMON_DELETE), color = MaterialTheme.colorScheme.error)
                    }
                }
            }
            // With Back the title gets its own line, hidden while typing so the messages keep the room.
            if (onBack != null && !keyboardOpen) {
                GoldText(
                    text = tr(UiString.CHAT_TITLE),
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.ExtraBold),
                    modifier = Modifier.padding(horizontal = ZarvisSpacing.lg).semantics { heading() },
                )
            }
            uiState.deleteOutcome?.let { outcome ->
                ZarvisCard(modifier = Modifier.fillMaxWidth().padding(horizontal = ZarvisSpacing.md)) {
                    Text(
                        tr(if (outcome == ChatDeleteOutcome.DELETED) UiString.CHAT_DELETED else UiString.CHAT_DELETE_FAILED),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    TextButton(onClick = viewModel::dismissDeleteOutcome) { Text(tr(UiString.COMMON_OK)) }
                }
            }
            uiState.interrupted?.let { action ->
                // Board A22: a gold-edged card. Nothing was done; Continue runs the request through access and confirmation again.
                GlassSurface(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = ZarvisSpacing.md),
                    shape = RoundedCornerShape(22.dp),
                    borderColor = ZarvisAccents.gold.copy(alpha = 0.6f),
                    tint = ZarvisGold.copy(alpha = 0.10f),
                ) {
                    Text(tr(UiString.CHAT_INTERRUPTED_TITLE), style = MaterialTheme.typography.titleSmall, color = ZarvisAccents.gold)
                    Text("\"${action.utterance}\"", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = ZarvisSpacing.sm))
                    Text(tr(UiString.CHAT_INTERRUPTED_BODY), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = ZarvisSpacing.sm))
                    Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm), modifier = Modifier.padding(top = 14.dp)) {
                        ZarvisPrimaryButton(text = tr(UiString.CHAT_CONTINUE), onClick = viewModel::resumeInterrupted)
                        ZarvisSecondaryButton(text = tr(UiString.CHAT_DISMISS), onClick = viewModel::dismissInterrupted)
                    }
                }
            }
            uiState.notice?.let { notice ->
                ZarvisCard(modifier = Modifier.fillMaxWidth().padding(horizontal = ZarvisSpacing.md)) {
                    Text(notice, style = MaterialTheme.typography.bodyMedium)
                    TextButton(onClick = viewModel::dismissNotice) { Text(tr(UiString.COMMON_OK)) }
                }
            }
            LazyColumn(
                modifier = Modifier.fillMaxSize().weight(1f),
                state = listState,
                contentPadding = PaddingValues(ZarvisSpacing.md),
                verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
            ) {
                if (uiState.turns.isEmpty()) {
                    item {
                        EmptyChat(onSuggestion = viewModel::submitInitialText)
                    }
                }
                itemsIndexed(uiState.turns) { index, turn ->
                    // The newest request's reply, while it is on its way, shows what the turn is really doing.
                    val pending = if (index == uiState.turns.lastIndex && turn.assistantText == null) uiState.progress else null
                    // Only the newest exchange, only after a failure that sending it again can fix, and not while anything is on its way.
                    val canRetry = index == uiState.turns.lastIndex && turn.retryable && turn.assistantText != null && uiState.progress == null
                    TurnBubble(turn, pending, onRetry = if (canRetry) viewModel::retry else null)
                }
            }

            Column(
                modifier = Modifier.fillMaxWidth().padding(ZarvisSpacing.md),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
            ) {
                AnimatedVisibility(visible = uiState.voiceState != VoiceState.IDLE) {
                    StatusPulseBadge(
                        label = uiState.progress?.let { progressText(it) } ?: statusText(uiState.voiceState),
                        glowColor = GlowColorsFor(uiState.voiceState),
                    )
                }
                uiState.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                // Not an error (the microphone heard nothing): said quietly, and read out once.
                uiState.hint?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
                // While the keyboard is up the orb is only dead space between the messages and the keys (on a 640dp phone it left the messages
                // under two lines); it comes back when the keyboard closes, and stays whenever it is showing a live state.
                if (!keyboardOpen || uiState.voiceState != VoiceState.IDLE) {
                    Box(contentAlignment = Alignment.Center) {
                        AiOrb(
                            state = uiState.voiceState,
                            size = 72.dp,
                            onClick = {
                                if (uiState.voiceState == VoiceState.LISTENING) viewModel.cancelListening() else viewModel.startListening()
                            },
                        )
                    }
                }
                ZarvisComposer(
                    value = uiState.composerText,
                    onValueChange = viewModel::onComposerChange,
                    onSubmit = viewModel::submitComposerText,
                    onMicClick = { if (uiState.voiceState == VoiceState.LISTENING) viewModel.cancelListening() else viewModel.startListening() },
                    placeholder = tr(UiString.CHAT_COMPOSER_HINT),
                    enabled = uiState.voiceState == VoiceState.IDLE || uiState.voiceState == VoiceState.LISTENING || uiState.voiceState == VoiceState.ERROR,
                )
            }
        }
    }
}

@Composable
private fun TurnBubble(turn: ConversationTurn, pending: ChatProgress?, onRetry: (() -> Unit)? = null) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.xs)) {
        // An answer with no question (a conversation that began with one) shows no empty bubble.
        if (turn.userText.isNotEmpty()) {
            // The sent message: white on the action gradient (at least 4.5:1 at every stop), its tail at the bottom right.
            Box(
                modifier = Modifier
                    .align(Alignment.End)
                    .fillMaxWidth(0.88f)
                    .wrapContentWidth(Alignment.End)
                    .background(zarvisActionBrush(), RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 6.dp, bottomStart = 22.dp))
                    .padding(horizontal = 15.dp, vertical = 11.dp),
            ) {
                Text(text = turn.userText, style = MaterialTheme.typography.bodyLarge, color = Color.White)
            }
        }
        if (turn.assistantText != null) {
            Column(modifier = Modifier.fillMaxWidth(0.92f).align(Alignment.Start), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm), verticalAlignment = Alignment.CenterVertically) {
                    // A still gold label: a long chat should not run one shine animation per reply.
                    Text(text = "ZARVIS", style = ZarvisDisplayStyles.kicker, color = ZarvisAccents.gold)
                    // Blueprint §10 structured status, as a jewel badge (the words are always there).
                    turn.status?.let { status -> StatusBadge(label = statusChip(status), tone = statusTone(status)) }
                }
                // The reply as the website draws it: headings, lists, links and code are formatted, not shown as raw symbols.
                GlassSurface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(topStart = 6.dp, topEnd = 22.dp, bottomEnd = 22.dp, bottomStart = 22.dp),
                    contentPadding = 14.dp,
                ) {
                    MarkdownText(text = turn.assistantText, style = MaterialTheme.typography.bodyLarge)
                }
                // Sends the same message again under the same id: a turn the server already finished is shown from its stored result.
                if (onRetry != null) {
                    val described = trf(UiString.CHAT_RETRY_NAMED, turn.userText.take(60))
                    TextButton(onClick = onRetry, modifier = Modifier.semantics { contentDescription = described }) {
                        Text(tr(UiString.COMMON_TRY_AGAIN), color = ZarvisAccents.gold, fontWeight = FontWeight.Bold)
                    }
                }
            }
        } else if (pending != null) {
            PendingReply(pending, Modifier.align(Alignment.Start))
        } else if (turn.stopped) {
            Text(
                text = tr(UiString.CHAT_STOPPED),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.End).padding(end = ZarvisSpacing.sm),
            )
        }
    }
}

/** A chat with nothing in it yet: the crown, what ZARVIS can do, and three requests to start with (each sends itself). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EmptyChat(onSuggestion: (String) -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = ZarvisSpacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
    ) {
        QueenCrown(width = 72.dp)
        GoldText(
            text = tr(UiString.CHAT_EMPTY_TITLE),
            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.ExtraBold),
            textAlign = TextAlign.Center,
        )
        Text(
            text = tr(UiString.CHAT_EMPTY_BODY),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = ZarvisSpacing.md),
        )
        FlowRow(
            modifier = Modifier.padding(top = ZarvisSpacing.sm),
            horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm, Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
        ) {
            listOf(
                UiString.CHAT_SUGGEST_CAMERA to ZarvisIcons.Camera,
                UiString.CHAT_SUGGEST_REMINDER to ZarvisIcons.Bell,
                UiString.CHAT_SUGGEST_WRITE to ZarvisIcons.Pen,
            ).forEach { (suggestion, icon) ->
                val text = tr(suggestion)
                ZarvisChip(label = text, onClick = { onSuggestion(text) }, icon = icon)
            }
        }
    }
}

/** The reply on its way: three gold dots and the stage the turn has really reached, read out as it changes. */
@Composable
private fun PendingReply(progress: ChatProgress, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth(0.92f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(text = "ZARVIS", style = ZarvisDisplayStyles.kicker, color = ZarvisAccents.gold)
        GlassSurface(
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            shape = RoundedCornerShape(topStart = 6.dp, topEnd = 22.dp, bottomEnd = 22.dp, bottomStart = 22.dp),
            borderColor = ZarvisAccents.gold.copy(alpha = 0.45f),
            contentPadding = 14.dp,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                TypingDots(color = ZarvisAccents.gold)
                Text(
                    text = progressText(progress),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** Three dots that brighten one after another (alpha only, in the draw layer); still when Android's animations are off. */
@Composable
private fun TypingDots(color: Color) {
    val phase: State<Float>? = if (zarvisReduceMotion()) {
        null
    } else {
        rememberInfiniteTransition(label = "typing").animateFloat(
            initialValue = 0f,
            targetValue = 3f,
            animationSpec = infiniteRepeatable(tween(durationMillis = 1_200, easing = LinearEasing), RepeatMode.Restart),
            label = "typing-phase",
        )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        repeat(3) { dot ->
            Box(
                modifier = Modifier
                    .size(7.dp)
                    .graphicsLayer {
                        alpha = phase?.value?.let { if (it.toInt() == dot) 1f else 0.3f } ?: 1f
                    }
                    .background(color, CircleShape),
            )
        }
    }
}

@Composable
private fun progressText(progress: ChatProgress): String = when (progress) {
    ChatProgress.Sending -> tr(UiString.CHAT_PROGRESS_SENDING)
    ChatProgress.SlowServer -> tr(UiString.CHAT_PROGRESS_SLOW)
    ChatProgress.Thinking -> tr(UiString.CHAT_PROGRESS_THINKING)
    is ChatProgress.Working -> progress.name?.let { trf(UiString.CHAT_PROGRESS_WORKING, it) } ?: tr(UiString.CHAT_PROGRESS_WORKING_PLAIN)
    ChatProgress.OnPhone -> tr(UiString.CHAT_PROGRESS_ON_PHONE)
}

/** The tone of a reply's status badge: done is emerald, a step waiting on the person is gold, a failure is ruby. */
private fun statusTone(status: ToolResultStatus): StatusTone = when (status) {
    ToolResultStatus.COMPLETED -> StatusTone.SUCCESS
    ToolResultStatus.PERMISSION_REQUIRED, ToolResultStatus.USER_ACTION_REQUIRED, ToolResultStatus.CONFIRMATION_REQUIRED -> StatusTone.WAITING
    ToolResultStatus.FAILED -> StatusTone.PROBLEM
    ToolResultStatus.DENIED, ToolResultStatus.UNSUPPORTED -> StatusTone.NEUTRAL
}

/** Blueprint §10 structured status, shown on the reply it belongs to. */
@Composable
private fun statusChip(status: ToolResultStatus): String = tr(
    when (status) {
        ToolResultStatus.COMPLETED -> UiString.CHAT_STATUS_COMPLETED
        ToolResultStatus.DENIED -> UiString.CHAT_STATUS_DECLINED
        ToolResultStatus.PERMISSION_REQUIRED -> UiString.CHAT_STATUS_PERMISSION
        ToolResultStatus.USER_ACTION_REQUIRED -> UiString.CHAT_STATUS_USER_ACTION
        ToolResultStatus.CONFIRMATION_REQUIRED -> UiString.CHAT_STATUS_CONFIRMATION
        ToolResultStatus.UNSUPPORTED -> UiString.CHAT_STATUS_UNSUPPORTED
        ToolResultStatus.FAILED -> UiString.CHAT_STATUS_FAILED
    },
)

@Composable
private fun statusText(state: VoiceState): String = tr(
    when (state) {
        VoiceState.IDLE -> UiString.CHAT_STATE_IDLE
        VoiceState.LISTENING -> UiString.CHAT_STATE_LISTENING
        // Only UNDERSTANDING is used while a request is in flight — no simulated planning steps.
        VoiceState.UNDERSTANDING, VoiceState.PLANNING, VoiceState.EXECUTING -> UiString.CHAT_STATE_WORKING
        VoiceState.SUCCESS -> UiString.CHAT_STATE_DONE
        VoiceState.SPEAKING -> UiString.CHAT_STATE_SPEAKING
        VoiceState.ERROR -> UiString.CHAT_STATE_ERROR
    },
)
