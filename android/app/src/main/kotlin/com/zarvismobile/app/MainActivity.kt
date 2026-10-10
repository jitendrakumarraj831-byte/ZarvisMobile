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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.app.navigation.ZarvisNavGraph
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.i18n.LocalAppLocale
import com.zarvismobile.core.ui.theme.ZarvisTheme
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
private fun ZarvisRoot(
    startupViewModel: AppStartupViewModel = hiltViewModel(),
    confirmationViewModel: ConfirmationViewModel = hiltViewModel(),
    permissionViewModel: PermissionMonitorViewModel = hiltViewModel(),
) {
    val startupState by startupViewModel.state.collectAsState()
    val darkTheme by startupViewModel.darkTheme.collectAsState(initial = false)
    val locale by startupViewModel.locale.collectAsState()
    LifecycleResumeEffect(Unit) {
        permissionViewModel.onResume()
        onPauseOrDispose { }
    }

    // Choosing Hindi in Settings redraws every screen that uses tr(...) right away, with no restart.
    CompositionLocalProvider(LocalAppLocale provides locale) {
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

            ZarvisSystemDialogs(permissionViewModel, confirmationViewModel)
        }
    }
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
