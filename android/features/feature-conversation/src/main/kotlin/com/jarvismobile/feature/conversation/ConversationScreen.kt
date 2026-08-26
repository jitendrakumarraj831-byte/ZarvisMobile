package com.jarvismobile.feature.conversation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
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
import com.jarvismobile.core.ui.components.AiOrb
import com.jarvismobile.core.ui.components.JarvisCard
import com.jarvismobile.core.ui.components.JarvisComposer
import com.jarvismobile.core.ui.components.VoiceState
import com.jarvismobile.core.ui.theme.JarvisSpacing

/**
 * The full voice/text conversation surface — MASTER_SPEC.md §11, §23. Reached from Home's
 * orb/composer/quick-categories; every [VoiceState] is rendered distinctly via [AiOrb] and
 * a status line so the user always knows what JARVIS is doing.
 */
@Composable
fun ConversationScreen(
    initialText: String?,
    viewModel: ConversationViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()

    LaunchedEffect(initialText) {
        initialText?.let { viewModel.submitInitialText(it) }
    }

    LaunchedEffect(uiState.turns.size) {
        if (uiState.turns.isNotEmpty()) listState.animateScrollToItem(uiState.turns.size - 1)
    }

    Column(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().weight(1f),
            state = listState,
            contentPadding = androidx.compose.foundation.layout.PaddingValues(JarvisSpacing.md),
            verticalArrangement = Arrangement.spacedBy(JarvisSpacing.md),
        ) {
            items(uiState.turns) { turn ->
                TurnBubble(turn)
            }
        }

        Column(
            modifier = Modifier.fillMaxWidth().padding(JarvisSpacing.md),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(JarvisSpacing.sm),
        ) {
            Text(text = statusText(uiState.voiceState), style = MaterialTheme.typography.labelMedium)
            Box(contentAlignment = Alignment.Center) {
                AiOrb(
                    state = uiState.voiceState,
                    size = 72.dp,
                    onClick = {
                        if (uiState.voiceState == VoiceState.LISTENING) viewModel.cancelListening() else viewModel.startListening()
                    },
                )
            }
            JarvisComposer(
                value = uiState.composerText,
                onValueChange = viewModel::onComposerChange,
                onSubmit = viewModel::submitComposerText,
                onMicClick = { if (uiState.voiceState == VoiceState.LISTENING) viewModel.cancelListening() else viewModel.startListening() },
                enabled = uiState.voiceState == VoiceState.IDLE || uiState.voiceState == VoiceState.LISTENING || uiState.voiceState == VoiceState.ERROR,
            )
        }
    }
}

@Composable
private fun TurnBubble(turn: ConversationTurn) {
    Column(verticalArrangement = Arrangement.spacedBy(JarvisSpacing.xs)) {
        JarvisCard(modifier = Modifier.fillMaxWidth()) {
            Text(text = turn.userText, style = MaterialTheme.typography.bodyLarge)
        }
        if (turn.assistantText != null) {
            JarvisCard(modifier = Modifier.fillMaxWidth()) {
                Text(text = turn.assistantText, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

private fun statusText(state: VoiceState): String = when (state) {
    VoiceState.IDLE -> "Tap the orb or type to start"
    VoiceState.LISTENING -> "Listening…"
    VoiceState.UNDERSTANDING -> "Understanding…"
    VoiceState.PLANNING -> "Planning…"
    VoiceState.EXECUTING -> "Working on it…"
    VoiceState.SPEAKING -> "Speaking…"
    VoiceState.ERROR -> "Something went wrong — try again"
}
