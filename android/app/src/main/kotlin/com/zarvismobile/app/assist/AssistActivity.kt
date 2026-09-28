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
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.app.ActivityBridge
import com.zarvismobile.app.ConfirmationViewModel
import com.zarvismobile.app.PermissionMonitorViewModel
import com.zarvismobile.app.ZarvisSystemDialogs
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.core.ui.theme.ZarvisTheme
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
            ZarvisTheme(darkTheme = false) {
                AssistPanel(autoListen = viaAssistGesture, onClose = ::finish)
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

    Box(
        Modifier.fillMaxSize().clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Surface(
            // Consume taps on the panel itself so they don't close it.
            modifier = Modifier.fillMaxWidth().imePadding().navigationBarsPadding()
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
            shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
            shadowElevation = 12.dp,
        ) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("ZARVIS", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    TextButton(onClick = onClose) { Text("Close") }
                }
                Text(
                    statusLine(state.voiceState),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.semantics { contentDescription = "Assistant status: ${statusLine(state.voiceState)}" },
                )
                Column(Modifier.heightIn(max = 260.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.turns.takeLast(2).forEach { turn ->
                        Text(turn.userText, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                        Text(turn.assistantText ?: "…", style = MaterialTheme.typography.bodyMedium)
                    }
                    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                }
                OutlinedTextField(
                    value = state.composerText,
                    onValueChange = viewModel::onComposerChange,
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Ask ZARVIS about this screen, or anything") },
                    singleLine = true,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = viewModel::startListening) { Text(if (state.voiceState == VoiceState.LISTENING) "Listening…" else "Speak") }
                    TextButton(onClick = viewModel::submitComposerText, enabled = state.composerText.isNotBlank()) { Text("Send") }
                }
            }
        }
    }
    ZarvisSystemDialogs(permissionViewModel, confirmationViewModel)
}

private fun statusLine(state: VoiceState): String = when (state) {
    VoiceState.LISTENING -> "Listening"
    VoiceState.UNDERSTANDING, VoiceState.PLANNING, VoiceState.EXECUTING -> "Working on it"
    VoiceState.SPEAKING -> "Speaking"
    VoiceState.SUCCESS -> "Done"
    VoiceState.ERROR -> "Something went wrong"
    VoiceState.IDLE -> "Ready"
}
