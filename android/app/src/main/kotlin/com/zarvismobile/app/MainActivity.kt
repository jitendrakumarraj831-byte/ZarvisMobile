package com.zarvismobile.app

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
import com.zarvismobile.app.navigation.ZarvisNavGraph
import com.zarvismobile.core.tooling.PendingConfirmation
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.RiskBadge
import com.zarvismobile.core.ui.components.RiskBadgeLevel
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.core.ui.theme.ZarvisTheme
import com.zarvismobile.domain.entity.RiskLevel
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ZarvisTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    ZarvisRoot()
                }
            }
        }
    }
}

@Composable
private fun ZarvisRoot(
    startupViewModel: AppStartupViewModel = hiltViewModel(),
    confirmationViewModel: ConfirmationViewModel = hiltViewModel(),
) {
    val state by startupViewModel.state.collectAsState()
    when (val current = state) {
        is AppStartupState.Loading -> StartupLoading()
        is AppStartupState.Failed -> StartupError(message = current.message, onRetry = startupViewModel::retry)
        is AppStartupState.Ready -> ZarvisNavGraph(startAtOnboarding = !current.onboardingComplete)
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
            Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
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
    Box(modifier = Modifier.fillMaxSize().padding(ZarvisSpacing.lg), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md)) {
            Text(text = message, style = MaterialTheme.typography.bodyLarge)
            ZarvisPrimaryButton(text = "Retry", onClick = onRetry)
        }
    }
}
