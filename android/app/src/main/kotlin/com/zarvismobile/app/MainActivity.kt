package com.zarvismobile.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.app.navigation.ZarvisNavGraph
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.GoldText
import com.zarvismobile.core.ui.components.QueenCrown
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.i18n.LocalAppLocale
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisDisplayStyles
import com.zarvismobile.core.ui.theme.ZarvisTheme
import com.zarvismobile.domain.presentation.UiString
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
    val darkTheme by startupViewModel.darkTheme.collectAsState(initial = true)
    val lightweight by startupViewModel.lightweight.collectAsState()
    val locale by startupViewModel.locale.collectAsState()
    SystemBarsFollowTheme(darkTheme)
    LifecycleResumeEffect(Unit) {
        permissionViewModel.onResume()
        onPauseOrDispose { }
    }

    // Choosing Hindi in Settings redraws every screen that uses tr(...) right away, with no restart.
    CompositionLocalProvider(LocalAppLocale provides (locale ?: "en")) {
        ZarvisTheme(darkTheme = darkTheme, lightweight = lightweight) {
            Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                // Until the saved language has been read only the spinner is drawn, so a Hindi user never sees English flash first.
                when (val current = if (locale == null) AppStartupState.Loading else startupState) {
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

/**
 * Status and navigation bar icons follow the app's own light/dark choice (Settings > Appearance), not the phone's: the app can be dark on a
 * light phone, and dark icons on a dark page are invisible. The bars stay transparent (edge to edge), only their icon shade changes.
 */
@Composable
private fun SystemBarsFollowTheme(darkTheme: Boolean) {
    val activity = LocalContext.current as? ComponentActivity ?: return
    DisposableEffect(darkTheme) {
        val bars = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT) { darkTheme }
        activity.enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
        onDispose { }
    }
}

@Composable
private fun RevokedBanner(message: String, onDismiss: () -> Unit) {
    GlassSurface(Modifier.fillMaxWidth().statusBarsPadding().padding(12.dp)) {
        Text(message, style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = onDismiss) { Text(tr(UiString.COMMON_OK)) }
    }
}

@Composable
private fun SessionExpiredScreen(
    state: AppStartupState.SessionExpired,
    onSignIn: (String, String) -> Unit,
    onNewGuest: () -> Unit,
) = ZarvisBackground {
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

/** The launch screen (board A01): the crown over the gold ZARVIS wordmark and a thin gold progress line, on the Queen page. */
@Composable
private fun StartupLoading() {
    ZarvisBackground {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterVertically),
        ) {
            QueenCrown(width = 96.dp)
            GoldText(text = "ZARVIS", style = ZarvisDisplayStyles.brand.copy(fontSize = 32.sp, lineHeight = 38.sp, letterSpacing = 8.sp))
            LinearProgressIndicator(
                modifier = Modifier.width(120.dp),
                color = ZarvisAccents.gold,
                trackColor = ZarvisAccents.gold.copy(alpha = 0.2f),
            )
        }
    }
}

@Composable
private fun StartupError(message: String, onRetry: () -> Unit) {
    ZarvisBackground {
        Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                QueenCrown(width = 72.dp)
                Text(text = message, style = MaterialTheme.typography.bodyLarge)
                ZarvisPrimaryButton(text = "Retry", onClick = onRetry)
            }
        }
    }
}
