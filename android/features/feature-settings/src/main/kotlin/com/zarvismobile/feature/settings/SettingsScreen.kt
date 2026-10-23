package com.zarvismobile.feature.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.selection.selectable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.ZarvisDestructiveButton
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.components.Jewel
import com.zarvismobile.core.ui.components.JewelIcon
import com.zarvismobile.core.ui.components.QueenPageHeader
import com.zarvismobile.core.ui.components.ZarvisChip
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.i18n.trf
import com.zarvismobile.core.ui.theme.ZarvisAccentCyan
import com.zarvismobile.core.ui.theme.ZarvisAccentPink
import com.zarvismobile.core.ui.theme.ZarvisAccentViolet
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.domain.presentation.UiString

private enum class SettingsPage(val title: UiString, val subtitle: UiString, val icon: ImageVector) {
    Account(UiString.SETTINGS_PAGE_ACCOUNT, UiString.SETTINGS_SUB_ACCOUNT, Icons.Filled.AccountCircle),
    Permissions(UiString.SETTINGS_PAGE_PERMISSIONS, UiString.SETTINGS_SUB_PERMISSIONS, Icons.Filled.AdminPanelSettings),
    Voice(UiString.SETTINGS_PAGE_VOICE, UiString.SETTINGS_SUB_VOICE, Icons.AutoMirrored.Filled.VolumeUp),
    Language(UiString.SETTINGS_PAGE_LANGUAGE, UiString.SETTINGS_SUB_LANGUAGE, Icons.Filled.Language),
    Appearance(UiString.SETTINGS_PAGE_APPEARANCE, UiString.SETTINGS_SUB_APPEARANCE, Icons.Filled.DarkMode),
    Ai(UiString.SETTINGS_PAGE_AI, UiString.SETTINGS_SUB_AI, Icons.Filled.Psychology),
    Notifications(UiString.SETTINGS_PAGE_NOTIFICATIONS, UiString.SETTINGS_SUB_NOTIFICATIONS, Icons.Filled.Notifications),
    Privacy(UiString.SETTINGS_PAGE_PRIVACY, UiString.SETTINGS_SUB_PRIVACY, Icons.Filled.Lock),
    Security(UiString.SETTINGS_PAGE_SECURITY, UiString.SETTINGS_SUB_SECURITY, Icons.Filled.Security),
    Data(UiString.SETTINGS_PAGE_DATA, UiString.SETTINGS_SUB_DATA, Icons.Filled.DataObject),
    Memory(UiString.SETTINGS_PAGE_MEMORY, UiString.SETTINGS_SUB_MEMORY, Icons.Filled.Memory),
    Protection(UiString.SETTINGS_PAGE_PROTECTION, UiString.SETTINGS_SUB_PROTECTION, Icons.Filled.Shield),
    Developer(UiString.SETTINGS_PAGE_DEVELOPER, UiString.SETTINGS_SUB_DEVELOPER, Icons.Filled.Code),
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
    // Saveable, so turning the phone keeps the page and an open "Delete your account?" question.
    var page by rememberSaveable { mutableStateOf<SettingsPage?>(null) }
    var showDeleteConfirmation by rememberSaveable { mutableStateOf(false) }
    var showClearConfirmation by rememberSaveable { mutableStateOf(false) }

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
            ReadOnlyCard(tr(UiString.VOICE_INPUT_TITLE), tr(UiString.VOICE_INPUT_BODY), ZarvisAccentCyan)
            GlassSurface(Modifier.fillMaxWidth()) {
                SettingSwitchRow(
                    tr(UiString.VOICE_SPEAK_TITLE),
                    tr(if (uiState.autoSpeak) UiString.VOICE_SPEAK_ON else UiString.VOICE_SPEAK_OFF),
                    uiState.autoSpeak,
                    viewModel::setAutoSpeak,
                )
            }
            ReadOnlyCard(tr(UiString.VOICE_OUTPUT_TITLE), tr(UiString.VOICE_OUTPUT_BODY), ZarvisAccentViolet)
            Text(tr(UiString.VOICE_STYLE), style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
            GlassSurface(Modifier.fillMaxWidth()) {
                listOf("Kore", "Puck", "Charon", "Aoede", "Fenrir").forEach { voice ->
                    SettingRow(voice, if (uiState.ttsVoice == voice) tr(UiString.COMMON_SELECTED) else tr(UiString.VOICE_TAP_TO_USE), uiState.ttsVoice == voice) {
                        viewModel.setTtsVoice(voice)
                    }
                }
            }
        }
        SettingsPage.Language -> SettingsSubPage(selected, goBack) {
            GlassSurface(Modifier.fillMaxWidth()) {
                SettingRow("English", tr(UiString.LANGUAGE_ENGLISH_SUB), uiState.locale == "en") { viewModel.setLocale("en") }
                SettingRow("हिंदी", tr(UiString.LANGUAGE_HINDI_SUB), uiState.locale == "hi") { viewModel.setLocale("hi") }
            }
            // Say plainly what Hindi changes today, so choosing it never suggests the whole app is translated.
            ReadOnlyCard(tr(UiString.LANGUAGE_SCOPE_TITLE), tr(UiString.LANGUAGE_SCOPE_BODY), ZarvisAccentViolet)
        }
        SettingsPage.Appearance -> SettingsSubPage(selected, goBack) {
            GlassSurface(Modifier.fillMaxWidth()) {
                SettingSwitchRow(
                    tr(UiString.APPEARANCE_DARK_TITLE),
                    tr(if (uiState.darkTheme) UiString.APPEARANCE_DARK_ON else UiString.APPEARANCE_DARK_OFF),
                    uiState.darkTheme,
                    viewModel::setDarkTheme,
                )
                Text(tr(UiString.APPEARANCE_DEFAULT_NOTE), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            GlassSurface(Modifier.fillMaxWidth()) {
                SettingSwitchRow(
                    tr(UiString.APPEARANCE_LITE_TITLE),
                    tr(if (uiState.lightweight) UiString.APPEARANCE_LITE_ON else UiString.APPEARANCE_LITE_OFF),
                    uiState.lightweight,
                    viewModel::setLightweight,
                )
            }
            ReadOnlyCard(tr(UiString.APPEARANCE_MOTION_TITLE), tr(UiString.APPEARANCE_MOTION_BODY), ZarvisAccentCyan)
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
                Text(tr(UiString.SIGN_OUT), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(tr(UiString.SIGN_OUT_CARD_BODY), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                ZarvisSecondaryButton(tr(UiString.SIGN_OUT), onClick = { showClearConfirmation = true })
            }
        }
        SettingsPage.Data -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard("Available data controls", "What ZARVIS saved about you can be viewed and deleted in Settings › Memory, and your account with its server data can be deleted here. There is no data export in this build.", ZarvisAccentViolet)
            AccountDeleteCard(deleteStatus) { showDeleteConfirmation = true }
        }
        SettingsPage.Protection -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard("Explain before asking", "Before any Android permission dialog, ZARVIS shows why it needs the access, what data is involved, what it won't do automatically, and how to revoke it. You can choose Not now.", ZarvisAccentCyan)
            ReadOnlyCard("Permission is not authorization", "Calls always show the exact name and number and wait for your confirmation. Server actions such as opening a pull request use a one-time confirmation for that exact action.", ZarvisAccentViolet)
            ReadOnlyCard("Android is the authority", "Access is re-checked with Android right before every action and again after you confirm. Revoking in Android Settings takes effect immediately.", ZarvisAccentPink)
            ReadOnlyCard("Voice stays user-controlled", "Listening starts from a tap. There is no wake word and no continuous listening.", ZarvisAccentCyan)
        }
        SettingsPage.Memory -> SettingsSubPage(selected, goBack) {
            MemoryContent()
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
            title = { Text(tr(UiString.DELETE_ACCOUNT_TITLE)) },
            text = { Text(tr(UiString.DELETE_ACCOUNT_BODY)) },
            confirmButton = {
                TextButton(onClick = { showDeleteConfirmation = false; viewModel.deleteAccount(onDeleted = onSessionCleared) }) {
                    Text(tr(UiString.COMMON_DELETE), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { showDeleteConfirmation = false }) { Text(tr(UiString.COMMON_CANCEL)) } },
        )
    }

    if (showClearConfirmation) {
        AlertDialog(
            onDismissRequest = { showClearConfirmation = false },
            title = { Text(tr(UiString.SIGN_OUT_TITLE)) },
            text = {
                Text(
                    tr(
                        if ((session as? com.zarvismobile.data.repository.SessionState.Active)?.isGuest != false) {
                            UiString.SIGN_OUT_GUEST_BODY
                        } else {
                            UiString.SIGN_OUT_BODY
                        },
                    ),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showClearConfirmation = false
                    viewModel.signOut(onSessionCleared)
                }) { Text(tr(UiString.SIGN_OUT)) }
            },
            dismissButton = { TextButton(onClick = { showClearConfirmation = false }) { Text(tr(UiString.COMMON_CANCEL)) } },
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
                // The current language and look sit in the header as chips that open their pages.
                QueenPageHeader(
                    title = tr(UiString.COMMON_SETTINGS),
                    subtitle = tr(UiString.SETTINGS_INTRO),
                    icon = ZarvisIcons.Settings,
                    jewel = Jewel.AMETHYST,
                    kicker = "ZARVIS",
                    onBack = onBack,
                    backLabel = tr(UiString.COMMON_BACK),
                    actions = {
                        ZarvisChip(
                            label = trf(UiString.SETTINGS_LANGUAGE_LINE, if (locale == "hi") "हिंदी" else "English"),
                            onClick = { onOpen(SettingsPage.Language) },
                            icon = ZarvisIcons.Lang,
                        )
                        ZarvisChip(
                            label = trf(UiString.SETTINGS_APPEARANCE_LINE, tr(if (darkTheme) UiString.SETTINGS_DARK else UiString.SETTINGS_QUEEN_LIGHT)),
                            onClick = { onOpen(SettingsPage.Appearance) },
                            icon = ZarvisIcons.Palette,
                        )
                    },
                )
            }
            items(SettingsPage.values().toList(), key = { it.name }) { entry ->
                GlassSurface(Modifier.fillMaxWidth(), onClick = { onOpen(entry) }) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        JewelIcon(entry.icon, jewelFor(entry), size = 44.dp)
                        Column(Modifier.weight(1f)) {
                            Text(tr(entry.title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text(
                                tr(entry.subtitle),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = ZarvisAccents.gold)
                    }
                }
            }
            item { Box(Modifier.padding(bottom = 36.dp)) }
        }
    }
}

/** Each Settings page wears its own jewel (board A15), so the long list is easy to scan. */
private fun jewelFor(page: SettingsPage): Jewel = when (page) {
    SettingsPage.Account, SettingsPage.Ai -> Jewel.AMETHYST
    SettingsPage.Permissions, SettingsPage.Security -> Jewel.SAPPHIRE
    SettingsPage.Voice, SettingsPage.Memory -> Jewel.ORCHID
    SettingsPage.Language, SettingsPage.Data, SettingsPage.Developer -> Jewel.EMERALD
    SettingsPage.Appearance, SettingsPage.Notifications -> Jewel.GOLD
    SettingsPage.Privacy, SettingsPage.Protection -> Jewel.RUBY
}

@Composable
private fun SettingsSubPage(page: SettingsPage, onBack: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    com.zarvismobile.core.ui.components.ZarvisBackground {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            QueenPageHeader(
                title = tr(page.title),
                subtitle = tr(page.subtitle),
                icon = page.icon,
                jewel = jewelFor(page),
                kicker = tr(UiString.SETTINGS_SUBPAGE_KICKER),
                onBack = onBack,
                backLabel = tr(UiString.COMMON_BACK),
            )
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
        }
    }
}

@Composable
private fun SettingRow(title: String, subtitle: String, selected: Boolean, onClick: () -> Unit) {
    // One radio-style choice: TalkBack reads "title, selected, radio button", and the whole row is the 56dp target.
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).selectable(selected = selected, role = Role.RadioButton, onClick = onClick).padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (selected) Text(tr(UiString.COMMON_SELECTED), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun AccountDeleteCard(status: DeleteAccountStatus, onDelete: () -> Unit) {
    GlassSurface(Modifier.fillMaxWidth()) {
        Text(tr(UiString.DELETE_ACCOUNT), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(tr(UiString.DELETE_ACCOUNT_CARD_BODY), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (status == DeleteAccountStatus.FAILED) {
            Text(tr(UiString.DELETE_ACCOUNT_FAILED), color = MaterialTheme.colorScheme.error)
        }
        ZarvisDestructiveButton(
            text = tr(if (status == DeleteAccountStatus.IN_PROGRESS) UiString.DELETE_ACCOUNT_BUSY else UiString.DELETE_ACCOUNT),
            enabled = status != DeleteAccountStatus.IN_PROGRESS,
            onClick = onDelete,
        )
    }
}
