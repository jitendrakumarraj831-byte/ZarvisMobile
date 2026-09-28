package com.zarvismobile.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.app.navigation.ZarvisNavGraph
import com.zarvismobile.core.tooling.PendingConfirmation
import com.zarvismobile.core.tooling.PendingRationale
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.RiskBadge
import com.zarvismobile.core.ui.components.RiskBadgeLevel
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.theme.ZarvisTheme
import com.zarvismobile.domain.access.RationaleChoice
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.feature.settings.CredentialsForm
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ActivityBridge.attach(this)
        enableEdgeToEdge()
        setContent { ZarvisRoot() }
    }

    override fun onDestroy() {
        ActivityBridge.detach(this)
        super.onDestroy()
    }
}

@Composable
private fun ZarvisRoot(
    startupViewModel: AppStartupViewModel = hiltViewModel(),
    confirmationViewModel: ConfirmationViewModel = hiltViewModel(),
    permissionViewModel: PermissionMonitorViewModel = hiltViewModel(),
) {
    val startupState by startupViewModel.state.collectAsState()
    val darkTheme by startupViewModel.darkTheme.collectAsState(initial = false)
    LifecycleResumeEffect(Unit) {
        permissionViewModel.onResume()
        onPauseOrDispose { }
    }

    ZarvisTheme(darkTheme = darkTheme) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            when (val current = startupState) {
                is AppStartupState.Loading -> StartupLoading()
                is AppStartupState.Failed -> StartupError(message = current.message, onRetry = startupViewModel::retry)
                is AppStartupState.SessionExpired -> SessionExpiredScreen(
                    state = current,
                    onSignIn = startupViewModel::signIn,
                    onNewGuest = startupViewModel::startNewGuest,
                )
                is AppStartupState.Ready -> Box(Modifier.fillMaxSize()) {
                    ZarvisNavGraph(startAtOnboarding = !current.onboardingComplete)
                    val notice by permissionViewModel.revokedNotice.collectAsState()
                    notice?.let { RevokedBanner(it, permissionViewModel::dismissNotice) }
                }
            }
        }

        val rationale by permissionViewModel.pendingRationale.collectAsState()
        rationale?.let { RationaleDialog(it, permissionViewModel.registry) }

        val pending by confirmationViewModel.pending.collectAsState()
        pending?.let { RiskConfirmationDialog(it) }
    }
}

/**
 * Blueprint §8/§10 permission explanation, shown BEFORE any Android system dialog:
 * why · what data · what won't happen automatically · how to revoke, with
 * Allow (or Open settings) · Not now · Learn more.
 */
@Composable
private fun RationaleDialog(pending: PendingRationale, registry: CapabilityRegistry) {
    val capability = registry.find(pending.request.capabilityId)
    if (capability == null) {
        // Unknown capability: never show a system dialog without an explanation.
        LaunchedEffect(pending) { pending.respond(RationaleChoice.NOT_NOW) }
        return
    }
    var learnMore by rememberSaveable(pending.request.capabilityId) { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { pending.respond(RationaleChoice.NOT_NOW) },
        title = { Text("Allow ${capability.name.lowercase()} access?") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                RiskBadge(level = RiskBadgeLevel.valueOf(capability.risk.name))
                Section("Why", capability.rationale.why)
                Section("What data", capability.rationale.data)
                Section("What ZARVIS won't do automatically", capability.rationale.notAutomatic)
                Section("How to turn it off", capability.rationale.revoke)
                if (pending.request.requiresSettings) {
                    Text(
                        "Android is no longer showing the permission prompt for this, so it can only be turned on in Android Settings. " +
                            "ZARVIS will check again when you come back.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                if (learnMore) {
                    Section("Data exposure", capability.dataExposure)
                    Section("Supported", capability.supportedActions.joinToString("; ").ifBlank { "—" })
                    Section("Not supported", capability.unsupportedActions.joinToString("; "))
                    Section("If you choose Not now", "${capability.denialBehavior} ${capability.fallback}")
                    Section("Where to change it later", capability.settingsDestination)
                }
                TextButton(onClick = { learnMore = !learnMore }) { Text(if (learnMore) "Show less" else "Learn more") }
            }
        },
        confirmButton = {
            TextButton(onClick = { pending.respond(RationaleChoice.ALLOW) }) {
                Text(if (pending.request.requiresSettings) "Open settings" else "Allow")
            }
        },
        dismissButton = { TextButton(onClick = { pending.respond(RationaleChoice.NOT_NOW) }) { Text("Not now") } },
    )
}

@Composable
private fun Section(title: String, body: String) {
    Column {
        Text(title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        Text(body, style = MaterialTheme.typography.bodyMedium)
    }
}

/** Shows the exact action (e.g. "Call Mom at +91 …"), never a generic description. */
@Composable
private fun RiskConfirmationDialog(pending: PendingConfirmation) {
    AlertDialog(
        onDismissRequest = { pending.respond(false) },
        title = { Text("Confirm this action") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                RiskBadge(level = RiskBadgeLevel.valueOf(pending.request.riskLevel.name))
                Text(pending.request.summary, style = MaterialTheme.typography.bodyLarge)
                Text(
                    when (pending.request.actionClass) {
                        ActionClass.EXTERNAL_COMMUNICATION -> "This contacts someone or changes something outside this phone."
                        ActionClass.FINANCIAL -> "This involves money."
                        ActionClass.DESTRUCTIVE -> "This can't be undone."
                        ActionClass.SECURITY_SENSITIVE -> "This affects your security or privacy."
                        else -> "Nothing happens unless you confirm."
                    } + " Your answer applies to this one action only.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { TextButton(onClick = { pending.respond(true) }) { Text("Confirm") } },
        dismissButton = { TextButton(onClick = { pending.respond(false) }) { Text("Cancel") } },
    )
}

@Composable
private fun RevokedBanner(message: String, onDismiss: () -> Unit) {
    GlassSurface(Modifier.fillMaxWidth().statusBarsPadding().padding(12.dp)) {
        Text(message, style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = onDismiss) { Text("OK") }
    }
}

@Composable
private fun SessionExpiredScreen(
    state: AppStartupState.SessionExpired,
    onSignIn: (String, String) -> Unit,
    onNewGuest: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Your session has ended", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(
            "You were signed out on the server (for example from another device, or for your security). " +
                "ZARVIS did not create a new account for you.",
            style = MaterialTheme.typography.bodyMedium,
        )
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        CredentialsForm(
            title = "Sign in",
            action = "Sign in",
            busy = state.busy,
            initialEmail = state.lastEmail.orEmpty(),
            onSubmit = onSignIn,
        )
        Text(
            if (state.wasGuest) {
                "This device was using a guest account without a sign-in email, so it can't be signed back into. You can start a new, empty guest account."
            } else {
                "Or start a new, empty guest account instead."
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        ZarvisSecondaryButton(text = if (state.busy) "Please wait…" else "Start a new guest account", enabled = !state.busy, onClick = onNewGuest)
    }
}

@Composable
private fun StartupLoading() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
private fun StartupError(message: String, onRetry: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(text = message, style = MaterialTheme.typography.bodyLarge)
            ZarvisPrimaryButton(text = "Retry", onClick = onRetry)
        }
    }
}
