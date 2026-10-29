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
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.TextButton
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.core.ui.components.AiOrb
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.GlowColorsFor
import com.zarvismobile.core.ui.components.QueenBackButton
import com.zarvismobile.core.ui.components.QueenConfirmDialog
import com.zarvismobile.core.ui.components.QueenOutlineAction
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
import com.zarvismobile.core.ui.theme.GlassColors
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
        QueenConfirmDialog(
            title = tr(UiString.CHAT_DELETE_TITLE),
            body = tr(UiString.CHAT_DELETE_BODY),
            confirmLabel = tr(UiString.COMMON_DELETE),
            dismissLabel = tr(UiString.COMMON_CANCEL),
            onConfirm = { confirmDelete = false; viewModel.deleteConversation() },
            onDismiss = { confirmDelete = false },
            destructive = true,
            icon = ZarvisIcons.Trash,
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
                // The title has its own line below: beside New chat and Delete a 360dp phone left it about 95dp, and "Chat with ZARVIS"
                // broke inside the word ZARVIS.
                Spacer(Modifier.weight(1f))
                // Always enabled: after a failed restore the screen can look empty while the server still holds the conversation, and the user must be able to leave it.
                ZarvisChip(label = tr(UiString.CHAT_NEW), onClick = viewModel::startNewConversation, icon = ZarvisIcons.Plus)
                // Offered only once there is something to delete, and not while a reply is on its way or a delete is already out.
                // A 48dp trash button named "Delete" for TalkBack; it only asks first (the dialog says exactly what is deleted).
                if (uiState.turns.isNotEmpty()) {
                    val idle = uiState.voiceState == VoiceState.IDLE || uiState.voiceState == VoiceState.SUCCESS || uiState.voiceState == VoiceState.ERROR
                    val canDelete = idle && !uiState.deleting
                    IconButton(onClick = { confirmDelete = true }, enabled = canDelete) {
                        Icon(
                            imageVector = ZarvisIcons.Trash,
                            contentDescription = tr(UiString.COMMON_DELETE),
                            tint = MaterialTheme.colorScheme.error.copy(alpha = if (canDelete) 1f else 0.38f),
                        )
                    }
                }
            }
            // The title's own line, hidden while typing so the messages keep the room.
            if (!keyboardOpen) {
                ChatTitle(modifier = Modifier.fillMaxWidth().padding(horizontal = ZarvisSpacing.md))
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
                // Board A22: an edged card in the primary. Nothing was done; Continue runs the request through access and confirmation again.
                GlassSurface(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = ZarvisSpacing.md),
                    shape = RoundedCornerShape(22.dp),
                    borderColor = ZarvisAccents.primary.copy(alpha = 0.6f),
                    tint = GlassColors.surfaceTintElevated,
                ) {
                    Text(tr(UiString.CHAT_INTERRUPTED_TITLE), style = MaterialTheme.typography.titleSmall, color = ZarvisAccents.primary)
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
                    val hasReply = !turn.assistantText.isNullOrBlank()
                    // Only the reply being read aloud says Stop; any other reply's button reads that one instead (one voice at a time).
                    val readingThis = hasReply && uiState.readingReply == turn.assistantText
                    TurnBubble(
                        turn,
                        pending,
                        onRetry = if (canRetry) viewModel::retry else null,
                        onReadAloud = if (hasReply) {
                            { if (readingThis) viewModel.stopSpeaking() else viewModel.speakReply(turn.assistantText.orEmpty()) }
                        } else null,
                        isReadingReply = readingThis,
                    )
                }
            }

            Column(
                modifier = Modifier.fillMaxWidth().padding(ZarvisSpacing.md),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
            ) {
                when (uiState.voiceState) {
                    // Board 4: while the microphone is on, say so and offer a way out that sends nothing.
                    VoiceState.LISTENING -> ListeningCard(onCancel = viewModel::cancelListening)
                    // Only while audio really plays; Stop ends it and keeps the reply as text.
                    VoiceState.SPEAKING -> SpeakingCard(onStop = viewModel::stopSpeaking)
                    else -> AnimatedVisibility(visible = uiState.voiceState != VoiceState.IDLE) {
                        StatusPulseBadge(
                            label = uiState.progress?.let { progressText(it) } ?: statusText(uiState.voiceState),
                            glowColor = GlowColorsFor(uiState.voiceState),
                        )
                    }
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
                // The field and, next to it, the orb: it is the microphone, and it shows what ZARVIS is doing.
                val toggleMic = { if (uiState.voiceState == VoiceState.LISTENING) viewModel.cancelListening() else viewModel.startListening() }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                    ZarvisComposer(
                        value = uiState.composerText,
                        onValueChange = viewModel::onComposerChange,
                        onSubmit = viewModel::submitComposerText,
                        onMicClick = toggleMic,
                        placeholder = tr(UiString.CHAT_COMPOSER_HINT),
                        enabled = uiState.voiceState == VoiceState.IDLE || uiState.voiceState == VoiceState.LISTENING || uiState.voiceState == VoiceState.ERROR,
                        showMic = false,
                        modifier = Modifier.weight(1f),
                    )
                    AiOrb(state = uiState.voiceState, size = 64.dp, onClick = toggleMic)
                }
                // Hidden while typing, so the messages keep the room.
                if (!keyboardOpen) {
                    Text(
                        text = tr(UiString.CHAT_SAFETY_CAPTION),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

/**
 * "Chat with ZARVIS" next to ZARVIS's small avatar and, under it, that replies follow the language you write or speak in. The page's
 * heading for TalkBack (the avatar is decoration).
 */
@Composable
private fun ChatTitle(modifier: Modifier = Modifier) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        ZarvisAvatar(diameter = 32.dp)
        Column(modifier = Modifier.weight(1f).semantics(mergeDescendants = true) { heading() }) {
            Text(text = tr(UiString.CHAT_TITLE), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold))
            Text(text = tr(UiString.CHAT_LANGUAGE_CAPTION), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** ZARVIS's avatar: a small sphere on the action gradient, lit from the top left like the orb. Decoration only. */
@Composable
private fun ZarvisAvatar(diameter: Dp) {
    Spacer(
        modifier = Modifier.size(diameter).drawBehind {
            val radius = this.size.minDimension / 2f
            drawCircle(brush = zarvisActionBrush(), radius = radius)
            val light = Offset(this.size.width * 0.35f, this.size.height * 0.3f)
            drawCircle(
                brush = Brush.radialGradient(listOf(Color.White.copy(alpha = 0.6f), Color.Transparent), center = light, radius = radius * 0.8f),
                radius = radius,
            )
        },
    )
}

/** The microphone is on: "Speak now", which languages work, and Cancel that throws away what was heard. Read out once. */
@Composable
private fun ListeningCard(onCancel: () -> Unit) {
    GlassSurface(
        modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        shape = RoundedCornerShape(22.dp),
        borderColor = ZarvisAccents.cyan.copy(alpha = 0.55f),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
            Icon(imageVector = ZarvisIcons.Mic, contentDescription = null, tint = ZarvisAccents.cyan, modifier = Modifier.size(20.dp))
            Text(tr(UiString.VOICE_SPEAK_NOW), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        }
        Text(
            tr(UiString.VOICE_LISTENING_HINT),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 2.dp),
        )
        ZarvisSecondaryButton(text = tr(UiString.VOICE_CANCEL_SEND_NOTHING), onClick = onCancel, modifier = Modifier.padding(top = ZarvisSpacing.sm))
    }
}

/** A reply is being read aloud: say so, with Stop. */
@Composable
private fun SpeakingCard(onStop: () -> Unit) {
    GlassSurface(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(22.dp), borderColor = ZarvisAccents.primary.copy(alpha = 0.45f)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
            Icon(imageVector = ZarvisIcons.Wave, contentDescription = null, tint = ZarvisAccents.primary, modifier = Modifier.size(20.dp))
            Text(
                tr(UiString.CHAT_STATE_SPEAKING),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
            )
            QueenOutlineAction(label = tr(UiString.VOICE_STOP), onClick = onStop, icon = ZarvisIcons.Stop)
        }
    }
}

@Composable
private fun TurnBubble(
    turn: ConversationTurn,
    pending: ChatProgress?,
    onRetry: (() -> Unit)? = null,
    onReadAloud: (() -> Unit)? = null,
    isReadingReply: Boolean = false,
) {
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
                    ZarvisAvatar(diameter = 18.dp)
                    // A still gold label (the brand's colour): a long chat should not run one shine animation per reply.
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
                if (onReadAloud != null || onRetry != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm), verticalAlignment = Alignment.CenterVertically) {
                        if (onReadAloud != null) {
                            // The visible words, in the app's language, are what TalkBack reads (tr() is composable: read here, not in a
                            // semantics block).
                            val readAloudLabel = tr(if (isReadingReply) UiString.VOICE_STOP else UiString.VOICE_READ_ALOUD)
                            QueenOutlineAction(label = readAloudLabel, onClick = onReadAloud, icon = if (isReadingReply) ZarvisIcons.Stop else ZarvisIcons.Wave)
                        }
                        // Sends the same message again under the same id: a turn the server already finished is shown from its stored result.
                        if (onRetry != null) {
                            val described = trf(UiString.CHAT_RETRY_NAMED, turn.userText.take(60))
                            QueenOutlineAction(
                                label = tr(UiString.COMMON_TRY_AGAIN),
                                onClick = onRetry,
                                icon = ZarvisIcons.Refresh,
                                modifier = Modifier.semantics { contentDescription = described },
                            )
                        }
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

/** A chat with nothing in it yet: the still orb, what ZARVIS can do, and three requests to start with (each sends itself). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EmptyChat(onSuggestion: (String) -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = ZarvisSpacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
    ) {
        // Decoration: the working orb is the one next to the field.
        AiOrb(state = VoiceState.IDLE, onClick = null, size = 104.dp)
        Text(
            text = tr(UiString.CHAT_EMPTY_TITLE),
            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() },
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

/** The reply on its way: three dots in the primary and the stage the turn has really reached, read out as it changes. */
@Composable
private fun PendingReply(progress: ChatProgress, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth(0.92f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm), verticalAlignment = Alignment.CenterVertically) {
            ZarvisAvatar(diameter = 18.dp)
            Text(text = "ZARVIS", style = ZarvisDisplayStyles.kicker, color = ZarvisAccents.gold)
        }
        GlassSurface(
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            shape = RoundedCornerShape(topStart = 6.dp, topEnd = 22.dp, bottomEnd = 22.dp, bottomStart = 22.dp),
            borderColor = ZarvisAccents.primary.copy(alpha = 0.45f),
            contentPadding = 14.dp,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                TypingDots(color = ZarvisAccents.primary)
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
