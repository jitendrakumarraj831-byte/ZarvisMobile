package com.zarvismobile.feature.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.selection.selectableGroup
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.material.icons.filled.PhonelinkLock
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
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
import com.zarvismobile.core.ui.components.QueenConfirmDialog
import com.zarvismobile.core.ui.components.QueenChoiceRow
import com.zarvismobile.core.ui.components.QueenFootnote
import com.zarvismobile.core.ui.components.QueenIconTile
import com.zarvismobile.core.ui.components.QueenInlineError
import com.zarvismobile.core.ui.components.QueenListCard
import com.zarvismobile.core.ui.components.QueenRow
import com.zarvismobile.core.ui.components.QueenRowDivider
import com.zarvismobile.core.ui.components.QueenSection
import com.zarvismobile.core.ui.theme.ZarvisProStyles
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.core.ui.theme.zarvisActionBrush
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.size
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
    PhoneSafety(UiString.SETTINGS_PAGE_PHONE_SAFETY, UiString.SETTINGS_SUB_PHONE_SAFETY, Icons.Filled.PhonelinkLock),
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

/**
 * Settings: the list of pages, and each page. With [openPhoneSafety] it opens straight on Phone action safety (Home's row), and
 * Back from that page leaves Settings instead of showing the list.
 */
@Composable
fun SettingsScreen(
    onBack: () -> Unit = {},
    onSessionCleared: () -> Unit,
    onDeveloper: () -> Unit,
    openPhoneSafety: Boolean = false,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val deleteStatus by viewModel.deleteAccountStatus.collectAsState()
    val session by viewModel.session.collectAsState()
    val accountForm by viewModel.accountForm.collectAsState()
    // Saveable, so turning the phone keeps the page and an open "Delete your account?" question.
    val startPage = if (openPhoneSafety) SettingsPage.PhoneSafety else null
    var page by rememberSaveable { mutableStateOf(startPage) }
    // A page opened from another page (Notifications › Open Permissions & Device Access): Back returns there, not to the list.
    var returnTo by rememberSaveable { mutableStateOf<SettingsPage?>(null) }
    var showDeleteConfirmation by rememberSaveable { mutableStateOf(false) }
    var showClearConfirmation by rememberSaveable { mutableStateOf(false) }

    val goBack: () -> Unit = {
        val previous = returnTo
        when {
            previous != null -> { page = previous; returnTo = null }
            startPage != null && page == startPage -> onBack()
            else -> page = null
        }
    }
    // System Back on a settings page returns to the settings list, like the on-screen back arrow (or out, from the page it opened on).
    BackHandler(enabled = page != null, onBack = goBack)

    when (val selected = page) {
        null -> SettingsHub(uiState.locale, uiState.darkTheme, session, onBack) { page = it }
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
        SettingsPage.PhoneSafety -> SettingsSubPage(selected, goBack) {
            PhoneSafetyContent()
        }
        SettingsPage.Voice -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard(tr(UiString.VOICE_INPUT_TITLE), tr(UiString.VOICE_INPUT_BODY), ZarvisAccentCyan, ZarvisIcons.Mic)
            GlassSurface(Modifier.fillMaxWidth()) {
                SettingSwitchRow(
                    tr(UiString.VOICE_SPEAK_TITLE),
                    tr(if (uiState.autoSpeak) UiString.VOICE_SPEAK_ON else UiString.VOICE_SPEAK_OFF),
                    uiState.autoSpeak,
                    viewModel::setAutoSpeak,
                )
            }
            ReadOnlyCard(tr(UiString.VOICE_OUTPUT_TITLE), tr(UiString.VOICE_OUTPUT_BODY), ZarvisAccentViolet, ZarvisIcons.Wave)
            QueenSection(title = tr(UiString.VOICE_STYLE)) {
                QueenListCard {
                    Column(Modifier.selectableGroup()) {
                        listOf("Kore", "Puck", "Charon", "Aoede", "Fenrir").forEachIndexed { index, voice ->
                            if (index > 0) QueenRowDivider()
                            val chosen = uiState.ttsVoice == voice
                            QueenChoiceRow(
                                title = voice,
                                detail = if (chosen) tr(UiString.COMMON_SELECTED) else tr(UiString.VOICE_TAP_TO_USE),
                                selected = chosen,
                                onClick = { viewModel.setTtsVoice(voice) },
                            )
                        }
                    }
                }
            }
        }
        SettingsPage.Language -> SettingsSubPage(selected, goBack) {
            QueenListCard {
                Column(Modifier.selectableGroup()) {
                    QueenChoiceRow(title = "English", detail = tr(UiString.LANGUAGE_ENGLISH_SUB), selected = uiState.locale == "en", onClick = { viewModel.setLocale("en") })
                    QueenRowDivider()
                    QueenChoiceRow(title = "हिंदी", detail = tr(UiString.LANGUAGE_HINDI_SUB), selected = uiState.locale == "hi", onClick = { viewModel.setLocale("hi") })
                }
            }
            // Say plainly what Hindi changes today, so choosing it never suggests the whole app is translated.
            ReadOnlyCard(tr(UiString.LANGUAGE_SCOPE_TITLE), tr(UiString.LANGUAGE_SCOPE_BODY), ZarvisAccentViolet, ZarvisIcons.Lang)
        }
        SettingsPage.Appearance -> SettingsSubPage(selected, goBack) {
            GlassSurface(Modifier.fillMaxWidth()) {
                SettingSwitchRow(
                    tr(UiString.APPEARANCE_DARK_TITLE),
                    tr(if (uiState.darkTheme) UiString.APPEARANCE_DARK_ON else UiString.APPEARANCE_DARK_OFF),
                    uiState.darkTheme,
                    viewModel::setDarkTheme,
                )
                QueenFootnote(tr(UiString.APPEARANCE_DEFAULT_NOTE))
            }
            GlassSurface(Modifier.fillMaxWidth()) {
                SettingSwitchRow(
                    tr(UiString.APPEARANCE_LITE_TITLE),
                    tr(if (uiState.lightweight) UiString.APPEARANCE_LITE_ON else UiString.APPEARANCE_LITE_OFF),
                    uiState.lightweight,
                    viewModel::setLightweight,
                )
            }
            ReadOnlyCard(tr(UiString.APPEARANCE_MOTION_TITLE), tr(UiString.APPEARANCE_MOTION_BODY), ZarvisAccentCyan, ZarvisIcons.Sparkle)
        }
        SettingsPage.Ai -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard("Where answers come from", "ZARVIS's server chooses the AI model for each request. There is no model or provider picker in the app.", ZarvisAccentViolet, ZarvisIcons.Brain)
            ReadOnlyCard("Turn state", "The orb shows Listening while the microphone is on, Working while ZARVIS processes a request, and Speaking only while audio is actually playing.", ZarvisAccentCyan, ZarvisIcons.Activity)
        }
        SettingsPage.Notifications -> SettingsSubPage(selected, goBack) {
            NotificationSettingsContent()
            ReadOnlyCard("ZARVIS's own reminders", "Reminders post an Android notification at the time you set. Android 13+ asks for notification permission; on Android 8–12 the app's notification switch in Android Settings controls it.", ZarvisAccentPink, ZarvisIcons.Bell)
            ZarvisSecondaryButton("Open Permissions & Device Access", onClick = { returnTo = SettingsPage.Notifications; page = SettingsPage.Permissions }, icon = ZarvisIcons.Shield)
        }
        SettingsPage.Privacy -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard("What stays private", "Your tasks, usage records and account data stay on ZARVIS's server, behind your sign-in. Keys for AI providers are never stored in the app.", ZarvisAccentViolet, ZarvisIcons.Lock)
            AccountDeleteCard(deleteStatus) { showDeleteConfirmation = true }
        }
        SettingsPage.Security -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard("Secure sign-in", "Your sign-in is kept encrypted by Android's secure keystore. It is renewed each time the app uses it, and if an old copy is ever used again, ZARVIS ends the session to protect you.", ZarvisAccentCyan, ZarvisIcons.Lock)
            GlassSurface(Modifier.fillMaxWidth()) {
                Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                    Text(tr(UiString.SIGN_OUT), style = ZarvisProStyles.rowTitle, fontWeight = FontWeight.Bold)
                    Text(tr(UiString.SIGN_OUT_CARD_BODY), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    ZarvisSecondaryButton(tr(UiString.SIGN_OUT), onClick = { showClearConfirmation = true }, icon = ZarvisIcons.User)
                }
            }
        }
        SettingsPage.Data -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard("Available data controls", "What ZARVIS saved about you can be viewed and deleted in Settings › Memory, and your account with its server data can be deleted here. There is no data export in this build.", ZarvisAccentViolet, ZarvisIcons.Database)
            AccountDeleteCard(deleteStatus) { showDeleteConfirmation = true }
        }
        SettingsPage.Protection -> SettingsSubPage(selected, goBack) {
            ReadOnlyCard("Explain before asking", "Before any Android permission dialog, ZARVIS shows why it needs the access, what data is involved, what it won't do automatically, and how to revoke it. You can choose Not now.", ZarvisAccentCyan, ZarvisIcons.Eye)
            ReadOnlyCard("Permission is not authorization", "Calls always show the exact name and number and wait for your confirmation. Server actions such as opening a pull request use a one-time confirmation for that exact action.", ZarvisAccentViolet, ZarvisIcons.Check)
            ReadOnlyCard("Android is the authority", "Access is re-checked with Android right before every action and again after you confirm. Revoking in Android Settings takes effect immediately.", ZarvisAccentPink, ZarvisIcons.Shield)
            ReadOnlyCard("Voice stays user-controlled", "Listening starts from a tap. There is no wake word and no continuous listening.", ZarvisAccentCyan, ZarvisIcons.Mic)
        }
        SettingsPage.Memory -> SettingsSubPage(selected, goBack) {
            MemoryContent()
        }
        SettingsPage.Developer -> SettingsSubPage(selected, goBack) {
            GlassSurface(Modifier.fillMaxWidth()) {
                Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.gap), verticalAlignment = Alignment.CenterVertically) {
                        QueenIconTile(icon = ZarvisIcons.Code, tint = ZarvisAccents.blue)
                        Text(tr(UiString.WORK_DEVELOPER_TITLE), style = ZarvisProStyles.rowTitle, fontWeight = FontWeight.Bold)
                    }
                    Text(tr(UiString.DEV_INTRO), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    ZarvisSecondaryButton(trf(UiString.COMMON_OPEN_NAMED, tr(UiString.WORK_DEVELOPER_TITLE)), onClick = onDeveloper, icon = ZarvisIcons.Code)
                }
            }
        }
    }

    if (showDeleteConfirmation) {
        QueenConfirmDialog(
            title = tr(UiString.DELETE_ACCOUNT_TITLE),
            body = tr(UiString.DELETE_ACCOUNT_BODY),
            confirmLabel = tr(UiString.COMMON_DELETE),
            dismissLabel = tr(UiString.COMMON_CANCEL),
            onConfirm = { showDeleteConfirmation = false; viewModel.deleteAccount(onDeleted = onSessionCleared) },
            onDismiss = { showDeleteConfirmation = false },
            destructive = true,
            icon = ZarvisIcons.Trash,
        )
    }

    if (showClearConfirmation) {
        QueenConfirmDialog(
            title = tr(UiString.SIGN_OUT_TITLE),
            body = tr(
                if ((session as? com.zarvismobile.data.repository.SessionState.Active)?.isGuest != false) {
                    UiString.SIGN_OUT_GUEST_BODY
                } else {
                    UiString.SIGN_OUT_BODY
                },
            ),
            confirmLabel = tr(UiString.SIGN_OUT),
            dismissLabel = tr(UiString.COMMON_CANCEL),
            onConfirm = {
                showClearConfirmation = false
                viewModel.signOut(onSessionCleared)
            },
            onDismiss = { showClearConfirmation = false },
            icon = ZarvisIcons.User,
        )
    }
}

/** The three groups of the Settings list (Queen Pro board 15), in order. */
private val SETTINGS_GROUPS: List<Pair<UiString, List<SettingsPage>>> = listOf(
    UiString.SETTINGS_GROUP_YOU to listOf(SettingsPage.Account, SettingsPage.Language, SettingsPage.Appearance, SettingsPage.Voice, SettingsPage.Notifications),
    UiString.SETTINGS_GROUP_SAFETY to listOf(
        SettingsPage.PhoneSafety, SettingsPage.Permissions, SettingsPage.Memory, SettingsPage.Privacy, SettingsPage.Security, SettingsPage.Data, SettingsPage.Protection,
    ),
    UiString.SETTINGS_GROUP_ADVANCED to listOf(SettingsPage.Ai, SettingsPage.Developer),
)

@Composable
private fun SettingsHub(
    locale: String,
    darkTheme: Boolean,
    session: com.zarvismobile.data.repository.SessionState,
    onBack: () -> Unit,
    onOpen: (SettingsPage) -> Unit,
) {
    com.zarvismobile.core.ui.components.ZarvisBackground {
        LazyColumn(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(),
            contentPadding = PaddingValues(ZarvisSpacing.md),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                // The current language and look sit in the header as chips that open their pages.
                QueenPageHeader(
                    title = tr(UiString.COMMON_SETTINGS),
                    subtitle = tr(UiString.SETTINGS_INTRO),
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
            item { AccountCard(session = session, onOpen = { onOpen(SettingsPage.Account) }) }
            SETTINGS_GROUPS.forEach { (title, pages) ->
                item(key = title.name) {
                    QueenSection(title = tr(title)) {
                        QueenListCard {
                            pages.forEachIndexed { index, entry ->
                                if (index > 0) QueenRowDivider()
                                QueenRow(
                                    title = tr(entry.title),
                                    detail = tr(entry.subtitle),
                                    icon = entry.icon,
                                    iconTint = entry.accent(),
                                    onClick = { onOpen(entry) },
                                )
                            }
                        }
                    }
                }
            }
            item { Box(Modifier.padding(bottom = 36.dp)) }
        }
    }
}

/** Who is signed in, on top of the list: a letter, the account line, and (for a guest) where to link an email. Opens Account. */
@Composable
private fun AccountCard(session: com.zarvismobile.data.repository.SessionState, onOpen: () -> Unit) {
    val active = session as? com.zarvismobile.data.repository.SessionState.Active
    val title = when (session) {
        is com.zarvismobile.data.repository.SessionState.Active ->
            if (session.isGuest) tr(UiString.ACCOUNT_GUEST) else trf(UiString.ACCOUNT_SIGNED_IN, session.email.orEmpty())
        is com.zarvismobile.data.repository.SessionState.Expired -> tr(UiString.ACCOUNT_ENDED)
        com.zarvismobile.data.repository.SessionState.None -> tr(UiString.ACCOUNT_NONE)
    }
    val initial = active?.email?.firstOrNull()?.uppercaseChar()?.toString() ?: "G"
    GlassSurface(Modifier.fillMaxWidth(), onClick = onOpen) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(48.dp).background(zarvisActionBrush(), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(initial, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Color.White)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = ZarvisProStyles.rowTitle)
                if (active?.isGuest == true) {
                    Text(tr(UiString.ACCOUNT_GUEST_HINT), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Icon(ZarvisIcons.Right, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun SettingsSubPage(page: SettingsPage, onBack: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    com.zarvismobile.core.ui.components.ZarvisBackground {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(ZarvisSpacing.md),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            QueenPageHeader(
                title = tr(page.title),
                subtitle = tr(page.subtitle),
                onBack = onBack,
                backLabel = tr(UiString.COMMON_BACK),
            )
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
        }
    }
}

/** Each page's colour on the Settings list (its icon tile), so the list reads at a glance; the title still says what it is. */
@Composable
private fun SettingsPage.accent(): Color = when (this) {
    SettingsPage.Account, SettingsPage.PhoneSafety, SettingsPage.Ai -> ZarvisAccents.primary
    SettingsPage.Language, SettingsPage.Security, SettingsPage.Developer -> ZarvisAccents.blue
    SettingsPage.Appearance, SettingsPage.Privacy -> ZarvisAccents.violet
    SettingsPage.Voice, SettingsPage.Permissions, SettingsPage.Data -> ZarvisAccents.cyan
    SettingsPage.Notifications, SettingsPage.Memory -> ZarvisAccents.pink
    SettingsPage.Protection -> ZarvisAccents.success
}

@Composable
private fun AccountDeleteCard(status: DeleteAccountStatus, onDelete: () -> Unit) {
    GlassSurface(Modifier.fillMaxWidth(), borderColor = ZarvisAccents.danger.copy(alpha = 0.3f)) {
        Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
            Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.gap), verticalAlignment = Alignment.CenterVertically) {
                QueenIconTile(icon = ZarvisIcons.Trash, tint = ZarvisAccents.danger)
                Text(tr(UiString.DELETE_ACCOUNT), style = ZarvisProStyles.rowTitle, fontWeight = FontWeight.Bold)
            }
            Text(tr(UiString.DELETE_ACCOUNT_CARD_BODY), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (status == DeleteAccountStatus.FAILED) {
                QueenInlineError(text = tr(UiString.DELETE_ACCOUNT_FAILED))
            }
            ZarvisDestructiveButton(
                text = tr(if (status == DeleteAccountStatus.IN_PROGRESS) UiString.DELETE_ACCOUNT_BUSY else UiString.DELETE_ACCOUNT),
                enabled = status != DeleteAccountStatus.IN_PROGRESS,
                onClick = onDelete,
                icon = ZarvisIcons.Trash,
            )
        }
    }
}
