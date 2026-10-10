package com.zarvismobile.feature.conversation

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.core.ui.components.AiOrb
import com.zarvismobile.core.ui.components.GlowColorsFor
import com.zarvismobile.core.ui.components.MarkdownText
import com.zarvismobile.core.ui.components.ZarvisCard
import com.zarvismobile.core.ui.components.ZarvisComposer
import com.zarvismobile.core.ui.components.StatusPulseBadge
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.theme.ZarvisSpacing
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
                modifier = Modifier.fillMaxWidth().padding(horizontal = ZarvisSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (onBack != null) TextButton(onClick = onBack) { Text(tr(UiString.COMMON_BACK)) }
                Text(
                    tr(UiString.CHAT_TITLE),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f).padding(start = if (onBack == null) ZarvisSpacing.sm else 0.dp),
                )
                TextButton(onClick = viewModel::startNewConversation, enabled = uiState.turns.isNotEmpty()) { Text(tr(UiString.CHAT_NEW)) }
            }
            uiState.interrupted?.let { action ->
                ZarvisCard(modifier = Modifier.fillMaxWidth().padding(horizontal = ZarvisSpacing.md)) {
                    Text(tr(UiString.CHAT_INTERRUPTED_TITLE), style = MaterialTheme.typography.titleSmall)
                    Text("\"${action.utterance}\"", style = MaterialTheme.typography.bodyLarge)
                    Text(tr(UiString.CHAT_INTERRUPTED_BODY), style = MaterialTheme.typography.bodySmall)
                    Row {
                        TextButton(onClick = viewModel::resumeInterrupted) { Text(tr(UiString.CHAT_CONTINUE)) }
                        TextButton(onClick = viewModel::dismissInterrupted) { Text(tr(UiString.CHAT_DISMISS)) }
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
                items(uiState.turns) { turn ->
                    TurnBubble(turn)
                }
            }

            Column(
                modifier = Modifier.fillMaxWidth().padding(ZarvisSpacing.md),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
            ) {
                AnimatedVisibility(visible = uiState.voiceState != VoiceState.IDLE) {
                    StatusPulseBadge(label = statusText(uiState.voiceState), glowColor = GlowColorsFor(uiState.voiceState))
                }
                uiState.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                Box(contentAlignment = Alignment.Center) {
                    AiOrb(
                        state = uiState.voiceState,
                        size = 72.dp,
                        onClick = {
                            if (uiState.voiceState == VoiceState.LISTENING) viewModel.cancelListening() else viewModel.startListening()
                        },
                    )
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
private fun TurnBubble(turn: ConversationTurn) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.xs)) {
        Surface(
            modifier = Modifier.fillMaxWidth(0.88f).align(Alignment.End),
            shape = RoundedCornerShape(18.dp),
            color = MaterialTheme.colorScheme.primary,
        ) {
            Text(
                text = turn.userText,
                modifier = Modifier.padding(12.dp),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onPrimary,
            )
        }
        if (turn.assistantText != null) {
            ZarvisCard(modifier = Modifier.fillMaxWidth(0.88f).align(Alignment.Start)) {
                turn.status?.let { status ->
                    Text(
                        text = statusChip(status),
                        style = MaterialTheme.typography.labelMedium,
                        color = if (status == ToolResultStatus.COMPLETED) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.tertiary,
                    )
                }
                // The reply as the website draws it: headings, lists, links and code are formatted, not shown as raw symbols.
                MarkdownText(text = turn.assistantText, style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
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
