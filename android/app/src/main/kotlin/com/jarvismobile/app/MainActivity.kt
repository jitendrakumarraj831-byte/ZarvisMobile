package com.jarvismobile.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import com.jarvismobile.app.navigation.JarvisNavGraph
import com.jarvismobile.core.tooling.PendingConfirmation
import com.jarvismobile.core.ui.components.JarvisPrimaryButton
import com.jarvismobile.core.ui.components.RiskBadge
import com.jarvismobile.core.ui.components.RiskBadgeLevel
import com.jarvismobile.core.ui.theme.JarvisSpacing
import com.jarvismobile.core.ui.theme.JarvisTheme
import com.jarvismobile.domain.entity.RiskLevel
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            JarvisTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    JarvisRoot()
                }
            }
        }
    }
}

@Composable
private fun JarvisRoot(
    startupViewModel: AppStartupViewModel = hiltViewModel(),
    confirmationViewModel: ConfirmationViewModel = hiltViewModel(),
) {
    val state by startupViewModel.state.collectAsState()
    when (val current = state) {
        is AppStartupState.Loading -> StartupLoading()
        is AppStartupState.Failed -> StartupError(message = current.message, onRetry = startupViewModel::retry)
        is AppStartupState.Ready -> JarvisNavGraph(
            startAtOnboarding = !current.onboardingComplete,
            // "Clear local session" in Settings must re-run the same bootstrap that runs on
            // first launch — otherwise the app is left holding no valid session and every API
            // call from Home/Tasks/Subscription/Developer would fail unauthenticated with no
            // way back short of force-quitting. Reusing retry() here (rather than only
            // navigating back to Home) is what actually fixes that.
            onSessionCleared = startupViewModel::retry,
        )
    }

    // Rendered on top of whatever screen is active — see MASTER_SPEC.md §7/§21: a
    // MEDIUM/HIGH risk skill must always be able to reach the user for confirmation.
    val pending by confirmationViewModel.pending.collectAsState()
    pending?.let { RiskConfirmationDialog(it) }
}

@Composable
private fun RiskConfirmationDialog(pending: PendingConfirmation) {
    AlertDialog(
        onDismissRequest = { pending.respond(false) },
        title = { Text("Confirm this action") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(JarvisSpacing.sm)) {
                RiskBadge(level = pending.request.riskLevel.toBadgeLevel())
                Text(pending.request.summary)
            }
        },
        confirmButton = {
            TextButton(onClick = { pending.respond(true) }) { Text("Confirm") }
        },
        dismissButton = {
            TextButton(onClick = { pending.respond(false) }) { Text("Cancel") }
        },
    )
}

private fun RiskLevel.toBadgeLevel(): RiskBadgeLevel = when (this) {
    RiskLevel.LOW -> RiskBadgeLevel.LOW
    RiskLevel.MEDIUM -> RiskBadgeLevel.MEDIUM
    RiskLevel.HIGH -> RiskBadgeLevel.HIGH
}

@Composable
private fun StartupLoading() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
private fun StartupError(message: String, onRetry: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize().padding(JarvisSpacing.lg), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(JarvisSpacing.md)) {
            Text(text = message, style = MaterialTheme.typography.bodyLarge)
            JarvisPrimaryButton(text = "Retry", onClick = onRetry)
        }
    }
}
