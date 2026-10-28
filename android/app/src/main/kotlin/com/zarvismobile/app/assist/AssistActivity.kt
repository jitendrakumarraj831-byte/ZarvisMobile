package com.zarvismobile.app.assist

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.app.ActivityBridge
import com.zarvismobile.app.ConfirmationViewModel
import com.zarvismobile.app.PermissionMonitorViewModel
import com.zarvismobile.app.ZarvisSystemDialogs
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import com.zarvismobile.core.ui.components.AiOrb
import com.zarvismobile.core.ui.components.QueenNote
import com.zarvismobile.core.ui.components.QueenOutlineAction
import com.zarvismobile.core.ui.components.ZarvisChip
import com.zarvismobile.core.ui.components.ZarvisComposer
import com.zarvismobile.core.ui.i18n.LocalAppLocale
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.domain.presentation.UiString
import com.zarvismobile.core.ui.components.MarkdownText
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.core.ui.theme.ZarvisTheme
import com.zarvismobile.data.local.prefs.AppPreferences
import com.zarvismobile.feature.conversation.ConversationViewModel
import dagger.hilt.android.AndroidEntryPoint

/**
 * The assistant overlay (capability default_assistant). Android starts it for
 * android.intent.action.ASSIST when the user has chosen ZARVIS as the digital assistant and
 * uses the assist gesture. It is translucent, so the app the user was in stays visible behind
 * it — which is the app screen_interaction reads or taps. Opening it via the gesture starts
 * listening immediately (the user explicitly invoked it); there is no wake word.
 */
@AndroidEntryPoint
class AssistActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ActivityBridge.attach(this)
        val viaAssistGesture = savedInstanceState == null && intent?.action == Intent.ACTION_ASSIST
        Log.i("ZarvisAssist", "ZARVIS_EVIDENCE default_assistant opened action=${intent?.action} autoListen=$viaAssistGesture")
        setContent {
            // The overlay wears the appearance and the language chosen in Settings: Queen Dark unless the person picked Queen Light.
            val preferences = remember { AppPreferences(applicationContext) }
            val darkTheme by preferences.darkTheme.collectAsState(initial = true)
            val locale by preferences.locale.collectAsState(initial = "en")
            CompositionLocalProvider(LocalAppLocale provides locale) {
                ZarvisTheme(darkTheme = darkTheme) {
                    AssistPanel(autoListen = viaAssistGesture, onClose = ::finish)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        ActivityBridge.activate(this)
    }

    override fun onDestroy() {
        ActivityBridge.detach(this)
        super.onDestroy()
    }
}

/**
 * The panel over the app in front (Queen Pro board 5): the orb and what ZARVIS is doing, the last exchange, three things to ask
 * about this screen, the field with its microphone, and the safety promise for reading and tapping.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AssistPanel(
    autoListen: Boolean,
    onClose: () -> Unit,
    viewModel: ConversationViewModel = hiltViewModel(),
    permissionViewModel: PermissionMonitorViewModel = hiltViewModel(),
    confirmationViewModel: ConfirmationViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    LaunchedEffect(Unit) { if (autoListen) viewModel.startListening() }
    val toggleMic = { if (state.voiceState == VoiceState.LISTENING) viewModel.cancelListening() else viewModel.startListening() }

    Box(
        Modifier.fillMaxSize().clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose),
        contentAlignment = Alignment.BottomCenter,
    ) {
        val sheet = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
        Surface(
            // Consume taps on the panel itself so they don't close it.
            modifier = Modifier.fillMaxWidth().imePadding().navigationBarsPadding()
                .border(1.dp, ZarvisAccents.primary.copy(alpha = 0.25f), sheet)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
            shape = sheet,
            color = MaterialTheme.colorScheme.background,
            shadowElevation = 12.dp,
        ) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(
                    Modifier.align(Alignment.CenterHorizontally).size(width = 40.dp, height = 4.dp)
                        .background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f), RoundedCornerShape(2.dp)),
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    AiOrb(state = state.voiceState, size = 48.dp, onClick = toggleMic)
                    Column(Modifier.weight(1f).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }) {
                        Text(statusLine(state.voiceState), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text(tr(UiString.ASSIST_HINT), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    // "Close" in words: the emulator tests find the overlay by it.
                    TextButton(onClick = onClose) { Text("Close") }
                }
                Column(Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.turns.takeLast(2).forEach { turn ->
                        Text(turn.userText, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                        // The reply as the Chat screen draws it (headings, lists, links and code formatted), not raw symbols.
                        val reply = turn.assistantText
                        // A request a newer one replaced says so, instead of "…" for good.
                        if (reply == null) {
                            Text(if (turn.stopped) tr(UiString.CHAT_STOPPED) else "…", style = MaterialTheme.typography.bodyMedium)
                        } else {
                            MarkdownText(text = reply, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                    // Not an error (the microphone heard nothing).
                    state.hint?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }
                }
                if (state.voiceState == VoiceState.SPEAKING) {
                    QueenOutlineAction(label = tr(UiString.VOICE_STOP), onClick = viewModel::stopSpeaking, icon = ZarvisIcons.Stop)
                }
                // Requests about the app in front, sent as written: reading and tapping still ask first.
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(
                        UiString.ASSIST_READ_SCREEN to ZarvisIcons.Eye,
                        UiString.ASSIST_GO_BACK to ZarvisIcons.Left,
                        UiString.ASSIST_GO_HOME to ZarvisIcons.Home,
                    ).forEach { (request, icon) ->
                        val text = tr(request)
                        ZarvisChip(label = text, icon = icon, onClick = { viewModel.submitInitialText(text) })
                    }
                }
                ZarvisComposer(
                    value = state.composerText,
                    onValueChange = viewModel::onComposerChange,
                    onSubmit = viewModel::submitComposerText,
                    onMicClick = toggleMic,
                    placeholder = tr(UiString.ASSIST_COMPOSER_HINT),
                )
                // The last request failed in a way sending it again can fix (same id: a finished turn is not run twice).
                val last = state.turns.lastOrNull()
                if (last != null && last.retryable && last.assistantText != null && state.progress == null) {
                    QueenOutlineAction(label = tr(UiString.COMMON_TRY_AGAIN), onClick = viewModel::retry, icon = ZarvisIcons.Refresh)
                }
                QueenNote(text = tr(UiString.ASSIST_SAFETY))
            }
        }
    }
    ZarvisSystemDialogs(permissionViewModel, confirmationViewModel)
}

@Composable
private fun statusLine(state: VoiceState): String = tr(
    when (state) {
        VoiceState.LISTENING -> UiString.CHAT_STATE_LISTENING
        VoiceState.UNDERSTANDING, VoiceState.PLANNING, VoiceState.EXECUTING -> UiString.CHAT_STATE_WORKING
        VoiceState.SPEAKING -> UiString.CHAT_STATE_SPEAKING
        VoiceState.SUCCESS -> UiString.CHAT_STATE_DONE
        VoiceState.ERROR -> UiString.CHAT_STATE_ERROR
        VoiceState.IDLE -> UiString.CHAT_STATE_IDLE
    },
)
