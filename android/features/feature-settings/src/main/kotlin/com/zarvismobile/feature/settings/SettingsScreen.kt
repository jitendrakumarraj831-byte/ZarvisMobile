package com.zarvismobile.feature.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.DataObject
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.ZarvisDestructiveButton
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisAccentCyan
import com.zarvismobile.core.ui.theme.ZarvisAccentPink
import com.zarvismobile.core.ui.theme.ZarvisAccentViolet

private enum class SettingsPage(val title: String, val icon: ImageVector) {
    Account("Account", Icons.Filled.AccountCircle),
    Permissions("Permissions & Device Access", Icons.Filled.AdminPanelSettings),
    Voice("Voice", Icons.AutoMirrored.Filled.VolumeUp),
    Language("Language", Icons.Filled.Language),
    Appearance("Appearance", Icons.Filled.DarkMode),
    Ai("AI", Icons.Filled.Psychology),
    Notifications("Notifications", Icons.Filled.Notifications),
    Privacy("Privacy", Icons.Filled.Lock),
    Security("Security", Icons.Filled.Security),
    Data("Data", Icons.Filled.DataObject),
    Memory("Memory", Icons.Filled.Memory),
    Protection("Rules & Protection", Icons.Filled.Shield),
    Developer("Developer Agent", Icons.Filled.Code),
}

@Composable
fun SettingsScreen(
    onBack: () -> Unit = {},
    onSessionCleared: () -> Unit,
    onDeveloper: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val deleteStatus by viewModel.deleteAccountStatus.collectAsState()
    val session by viewModel.session.collectAsState()
    val accountForm by viewModel.accountForm.collectAsState()
    var page by remember { mutableStateOf<SettingsPage?>(null) }
    var showDeleteConfirmation by remember { mutableStateOf(false) }
    var showClearConfirmation by remember { mutableStateOf(false) }

    val goBack: () -> Unit = { page = null }
    // System Back on a settings page returns to the settings list, like the on-screen back arrow.
    BackHandler(enabled = page != null, onBack = goBack)

    when (val selected = page) {
        null -> SettingsHub(uiState.locale, uiState.darkTheme, onBack) { page = it }
        SettingsPage.Account -> SettingsSubPage(selected, goBack) {
            AccountSection(
                session = session,
                form = accountForm,
                onLink = viewModel::linkEmail,
                onSignIn = { email, password -> viewModel.signIn(email, password, onSessionCleared) },
                onSignOut = { showClearConfirmation = true },
            )
        }
        SettingsPage.Permissions -> PermissionCenterScreen(onBack = goBack)
        SettingsPage.Voice -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard("Voice input", "Android speech recognition, started only when you tap the microphone. No wake word.", ZarvisAccentCyan)
            GlassSurface(Modifier.fillMaxWidth()) {
                SettingSwitchRow(
                    "Speak replies aloud",
                    if (uiState.autoSpeak) "Replies are spoken with a neural voice" else "Off — replies are shown as text only",
                    uiState.autoSpeak,
                    viewModel::setAutoSpeak,
                )
            }
            ReadOnlyCard("Voice output", "Spoken replies are made on ZARVIS's server with a neural voice. If voice fails, the reply stays on screen as text.", ZarvisAccentViolet)
            Text("Voice style", style = MaterialTheme.typography.titleSmall)
            listOf("Kore", "Puck", "Charon", "Aoede", "Fenrir").forEach { voice ->
                SettingRow(voice, if (uiState.ttsVoice == voice) "Selected" else "Tap to use this voice", uiState.ttsVoice == voice) {
                    viewModel.setTtsVoice(voice)
                }
            }
        }
        SettingsPage.Language -> SettingsSubPage(selected, goBack) {
            GlassSurface(Modifier.fillMaxWidth()) {
                SettingRow("English", "Replies and app copy", uiState.locale == "en") { viewModel.setLocale("en") }
                SettingRow("हिंदी", "Replies and app copy", uiState.locale == "hi") { viewModel.setLocale("hi") }
            }
        }
        SettingsPage.Appearance -> SettingsSubPage(selected, goBack) {
            GlassSurface(Modifier.fillMaxWidth()) {
                SettingSwitchRow(
                    "Dark theme",
                    if (uiState.darkTheme) "Dark mode is active" else "Bright aurora mode is active",
                    uiState.darkTheme,
                    viewModel::setDarkTheme,
                )
                Text("Aurora Light is the default appearance.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        SettingsPage.Ai -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard("AI orchestration", "The existing AndroidOrchestrator and backend API remain the source of AI behavior. There is no client-side model/provider selector in this build.", ZarvisAccentViolet)
            ReadOnlyCard("Turn state", "The orb shows Listening while the microphone is on, Working while ZARVIS processes a request, and Speaking only while audio is actually playing.", ZarvisAccentCyan)
        }
        SettingsPage.Notifications -> SettingsSubPage(selected, goBack) {
            NotificationSettingsContent()
            ReadOnlyCard("ZARVIS's own reminders", "Reminders post an Android notification at the time you set. Android 13+ asks for notification permission; on Android 8–12 the app's notification switch in Android Settings controls it.", ZarvisAccentPink)
            ZarvisSecondaryButton("Open Permissions & Device Access", onClick = { page = SettingsPage.Permissions })
        }
        SettingsPage.Privacy -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard("Privacy boundary", "Authenticated backend data and task/usage records stay behind the existing API. Provider credentials are not stored in the app.", ZarvisAccentViolet)
            AccountDeleteCard(deleteStatus) { showDeleteConfirmation = true }
        }
        SettingsPage.Security -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard("Secure storage", "Access and refresh tokens use Android Keystore-backed EncryptedSharedPreferences. Refresh tokens rotate on every use; a replayed token ends the session.", ZarvisAccentCyan)
            GlassSurface(Modifier.fillMaxWidth()) {
                Text("Sign out", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("Ends this device's session on the server. Your account and its data are not deleted.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                ZarvisSecondaryButton("Sign out", onClick = { showClearConfirmation = true })
            }
        }
        SettingsPage.Data -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard("Available data controls", "The current API exposes authenticated account deletion, tasks, usage and entitlements. There is no export endpoint in this build.", ZarvisAccentViolet)
            AccountDeleteCard(deleteStatus) { showDeleteConfirmation = true }
        }
        SettingsPage.Protection -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard("Explain before asking", "Before any Android permission dialog, ZARVIS shows why it needs the access, what data is involved, what it won't do automatically, and how to revoke it. You can choose Not now.", ZarvisAccentCyan)
            ReadOnlyCard("Permission is not authorization", "Calls always show the exact name and number and wait for your confirmation. Server actions such as opening a pull request use a one-time confirmation for that exact action.", ZarvisAccentViolet)
            ReadOnlyCard("Android is the authority", "Access is re-checked with Android right before every action and again after you confirm. Revoking in Android Settings takes effect immediately.", ZarvisAccentPink)
            ReadOnlyCard("Voice stays user-controlled", "Listening starts from a tap. There is no wake word and no continuous listening.", ZarvisAccentCyan)
        }
        SettingsPage.Memory -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard("Conversation context", "Conversation state is handled by the existing conversation/orchestrator path. The current API does not expose individual memory browsing or deletion endpoints.", ZarvisAccentCyan)
            ReadOnlyCard("Honest boundary", "No fake memory controls are added where the backend cannot perform the requested operation.", ZarvisAccentPink)
        }
        SettingsPage.Developer -> SettingsSubPage(selected, goBack) {
            GlassSurface(Modifier.fillMaxWidth()) {
                Text("Developer Agent", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("Open the existing Developer Agent repository-analysis flow.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                ZarvisSecondaryButton("Open Developer Agent", onClick = onDeveloper)
            }
        }
    }

    if (showDeleteConfirmation) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirmation = false },
            title = { Text("Delete your account?") },
            text = { Text("This permanently deletes your account, tasks, and usage history from the server. This cannot be undone.") },
            confirmButton = {
                TextButton(onClick = { showDeleteConfirmation = false; viewModel.deleteAccount(onDeleted = onSessionCleared) }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { showDeleteConfirmation = false }) { Text("Cancel") } },
        )
    }

    if (showClearConfirmation) {
        AlertDialog(
            onDismissRequest = { showClearConfirmation = false },
            title = { Text("Sign out?") },
            text = {
                Text(
                    if ((session as? com.zarvismobile.data.repository.SessionState.Active)?.isGuest != false) {
                        "This is a guest account with no sign-in email. After signing out you can't get back into it. Link an email first if you want to keep it."
                    } else {
                        "This ends the session on this device. Sign in again with your email to continue."
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showClearConfirmation = false
                    viewModel.signOut(onSessionCleared)
                }) { Text("Sign out") }
            },
            dismissButton = { TextButton(onClick = { showClearConfirmation = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun SettingsHub(locale: String, darkTheme: Boolean, onBack: () -> Unit, onOpen: (SettingsPage) -> Unit) {
    com.zarvismobile.core.ui.components.ZarvisBackground {
        LazyColumn(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(),
            contentPadding = PaddingValues(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                TextButton(onClick = onBack) { Text("Back") }
                Text("Settings", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text("Personalize the ZARVIS experience using real app, OS and backend capabilities.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            item {
                GlassSurface(Modifier.fillMaxWidth(), tint = GlassColors.surfaceTintElevated) {
                    Text("Current setup", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text("Language: " + if (locale == "hi") "हिंदी" else "English")
                    Text("Appearance: " + if (darkTheme) "Dark" else "Aurora Light")
                }
            }
            items(SettingsPage.values().toList()) { entry ->
                GlassSurface(Modifier.fillMaxWidth().clickable { onOpen(entry) }) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.background(ZarvisAccentCyan.copy(alpha = 0.12f), RoundedCornerShape(15.dp)).padding(11.dp)
                        ) {
                            Icon(entry.icon, contentDescription = null, tint = when (entry) {
                                SettingsPage.Developer, SettingsPage.Memory -> ZarvisAccentPink
                                SettingsPage.Ai, SettingsPage.Appearance -> ZarvisAccentViolet
                                else -> ZarvisAccentCyan
                            })
                        }
                        Column(Modifier.weight(1f)) {
                            Text(entry.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text(
                                when (entry) {
                                    SettingsPage.Account -> "Guest, linked email, sign in and out"
                                    SettingsPage.Permissions -> "What ZARVIS can access, live from Android"
                                    SettingsPage.Voice -> "Speech recognition and spoken replies"
                                    SettingsPage.Language -> "English or Hindi"
                                    SettingsPage.Appearance -> "Aurora light / dark theme"
                                    SettingsPage.Ai -> "Current orchestration behavior"
                                    SettingsPage.Notifications -> "Mode, spoken notifications, quiet hours, exclusions"
                                    SettingsPage.Privacy -> "Account and privacy controls"
                                    SettingsPage.Security -> "Secure tokens and local session"
                                    SettingsPage.Data -> "Server data and deletion"
                                    SettingsPage.Memory -> "Conversation context boundary"
                                    SettingsPage.Protection -> "What this build actually enforces"
                                    SettingsPage.Developer -> "Repository analysis"
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Text("›", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            item { Box(Modifier.padding(bottom = 36.dp)) }
        }
    }
}

@Composable
private fun SettingsSubPage(page: SettingsPage, onBack: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    com.zarvismobile.core.ui.components.ZarvisBackground {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onBack) { Text("‹ Back") }
                Column {
                    Text(page.title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text("ZARVIS settings", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
        }
    }
}

@Composable
private fun SettingRow(title: String, subtitle: String, selected: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Column {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (selected) Text("Selected", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun SettingSwitchRow(title: String, subtitle: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun ReadOnlyCard(title: String, body: String, accent: androidx.compose.ui.graphics.Color) {
    GlassSurface(Modifier.fillMaxWidth()) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = accent)
        Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun AccountDeleteCard(status: DeleteAccountStatus, onDelete: () -> Unit) {
    GlassSurface(Modifier.fillMaxWidth()) {
        Text("Delete account", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text("Permanently delete the authenticated account and its server-side task/usage data.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (status == DeleteAccountStatus.FAILED) {
            Text("Couldn't delete the account. Check the connection and try again.", color = MaterialTheme.colorScheme.error)
        }
        ZarvisDestructiveButton(
            text = if (status == DeleteAccountStatus.IN_PROGRESS) "Deleting…" else "Delete account",
            enabled = status != DeleteAccountStatus.IN_PROGRESS,
            onClick = onDelete,
        )
    }
}
