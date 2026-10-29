package com.zarvismobile.feature.settings

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.viewModelScope
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.QueenChoiceRow
import com.zarvismobile.core.ui.components.QueenDialog
import com.zarvismobile.core.ui.components.QueenIconTile
import com.zarvismobile.core.ui.components.QueenNote
import com.zarvismobile.core.ui.components.QueenNoticeCard
import com.zarvismobile.core.ui.components.QueenOutlineAction
import com.zarvismobile.core.ui.components.QueenSwitchRow
import com.zarvismobile.core.ui.components.SkeletonList
import com.zarvismobile.core.ui.components.ZarvisGhostButton
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisProStyles
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.data.local.access.DataStoreNotificationSettings
import com.zarvismobile.domain.access.AccessCoordinator
import com.zarvismobile.domain.access.AccessResult
import com.zarvismobile.domain.access.AccessState
import com.zarvismobile.domain.access.DeviceAccessPort
import com.zarvismobile.domain.capability.CapabilityId
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.notification.LockScreenBehavior
import com.zarvismobile.domain.notification.NotificationMode
import com.zarvismobile.domain.notification.NotificationPrivacy
import com.zarvismobile.domain.notification.NotificationPrivacySettings
import com.zarvismobile.domain.notification.NotificationSpeechPreview
import com.zarvismobile.domain.notification.QuietHours
import com.zarvismobile.domain.presentation.UiString
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyColumn

data class InstalledApp(val packageName: String, val label: String)

/**
 * Settings > Notifications (blueprint §8 "Notifications" and §12 "Notification privacy"):
 * notification mode, spoken notifications, quiet hours, headphones, lock screen, preview
 * policy (sensitive alerts) and per-app exclusions — plus the live Notification access state.
 */
@HiltViewModel
class NotificationSettingsViewModel @Inject constructor(
    private val store: DataStoreNotificationSettings,
    private val device: DeviceAccessPort,
    private val coordinator: AccessCoordinator,
    private val registry: CapabilityRegistry,
    private val preview: NotificationSpeechPreview,
    @ApplicationContext private val context: Context,
) : ViewModel() {
    val settings: StateFlow<NotificationPrivacySettings> =
        store.settings.stateIn(viewModelScope, SharingStarted.Eagerly, NotificationPrivacySettings())

    private val _access = MutableStateFlow<AccessState?>(null)
    val access: StateFlow<AccessState?> = _access.asStateFlow()

    /** The phone's launchable apps by name, or `null` until they have been read (the list then says it is loading, not empty). */
    private val _apps = MutableStateFlow<List<InstalledApp>?>(null)
    val apps: StateFlow<List<InstalledApp>?> = _apps.asStateFlow()
    private var appsJob: Job? = null

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    fun refresh() {
        viewModelScope.launch { _access.value = device.state(PermissionType.NOTIFICATION_LISTENER) }
    }

    fun loadApps() {
        if (_apps.value != null || appsJob?.isActive == true) return
        appsJob = viewModelScope.launch {
            _apps.value = withContext(Dispatchers.IO) {
                val pm = context.packageManager
                pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
                    .map { InstalledApp(it.activityInfo.packageName, it.loadLabel(pm).toString()) }
                    .filter { it.packageName != context.packageName }
                    .distinctBy { it.packageName }
                    .sortedBy { it.label.lowercase() }
            }
        }
    }

    fun turnOnAccess() {
        viewModelScope.launch {
            _message.value = when (val result = coordinator.ensure(registry.get(CapabilityId.NOTIFICATION_READ))) {
                AccessResult.Granted -> "Notification access is on. ZARVIS still only reads notifications when you ask."
                is AccessResult.Declined -> "Nothing changed."
                is AccessResult.Denied -> "Android reports notification access is still off."
                is AccessResult.Unsupported -> result.reason ?: "Not available on this phone."
            }
            refresh()
        }
    }

    fun update(transform: (NotificationPrivacySettings) -> NotificationPrivacySettings) {
        viewModelScope.launch { store.update(transform) }
    }

    fun speakSample() {
        viewModelScope.launch { _message.value = preview.speakSample() }
    }

    fun dismissMessage() {
        _message.value = null
    }
}

@Composable
fun ColumnScope.NotificationSettingsContent(viewModel: NotificationSettingsViewModel = hiltViewModel()) {
    val settings by viewModel.settings.collectAsState()
    val access by viewModel.access.collectAsState()
    val apps by viewModel.apps.collectAsState()
    val message by viewModel.message.collectAsState()
    var showApps by rememberSaveable { mutableStateOf(false) }
    LifecycleResumeEffect(Unit) {
        viewModel.refresh()
        onPauseOrDispose { }
    }

    message?.let {
        QueenNoticeCard(text = it, dismissLabel = "OK", onDismiss = viewModel::dismissMessage)
    }

    // Each card's title is its own words (the emulator tests find them as written), with an icon tile in the card's colour.
    SettingCard {
        Title("Notification access", ZarvisIcons.Bell, ZarvisAccents.pink)
        val on = access == AccessState.GRANTED
        Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm), verticalAlignment = Alignment.Top) {
            if (access != null) {
                Icon(
                    imageVector = if (on) ZarvisIcons.Check else ZarvisIcons.Lock,
                    contentDescription = null,
                    tint = if (on) ZarvisAccents.success else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp).size(16.dp),
                )
            }
            Text(
                when (access) {
                    AccessState.GRANTED -> "On — Android reports ZARVIS can see notifications. It reads them only when you ask, or speaks them if you turn that on below."
                    null -> "Checking…"
                    else -> "Off — ZARVIS can't see other apps' notifications. Only you can turn this on, in Android Settings."
                },
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
        }
        if (access != null && access != AccessState.GRANTED) ZarvisPrimaryButton("Turn on notification access", onClick = viewModel::turnOnAccess)
    }

    SettingCard {
        Title("Notification mode", ZarvisIcons.Eye, ZarvisAccents.primary)
        Text("What ZARVIS may show or say about a notification.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.selectableGroup()) {
            NotificationMode.entries.forEach { mode ->
                Choice(mode.label, modeExample(mode), settings.mode == mode) { viewModel.update { it.copy(mode = mode) } }
            }
        }
    }

    SettingCard {
        Toggle(
            "Spoken notifications",
            if (settings.speakEnabled) "On — ${NotificationPrivacy.describeSpeakRules(settings)}" else "Off — nothing is spoken",
            settings.speakEnabled,
        ) { on -> viewModel.update { it.copy(speakEnabled = on) } }
        QueenNote(text = "Speech is generated on this phone; notification content is never sent to ZARVIS servers.", icon = ZarvisIcons.Phone, tint = ZarvisAccents.cyan)
        ZarvisSecondaryButton("Play a sample", onClick = viewModel::speakSample, icon = ZarvisIcons.Wave)
    }

    SettingCard {
        Toggle(
            "Quiet hours",
            if (settings.quietHours.enabled) "Silent ${NotificationPrivacy.formatMinute(settings.quietHours.startMinute)} – ${NotificationPrivacy.formatMinute(settings.quietHours.endMinute)}" else "Off",
            settings.quietHours.enabled,
        ) { on -> viewModel.update { it.copy(quietHours = it.quietHours.copy(enabled = on)) } }
        if (settings.quietHours.enabled) {
            Stepper("Starts", settings.quietHours.startMinute) { minute -> viewModel.update { it.copy(quietHours = it.quietHours.copy(startMinute = minute)) } }
            Stepper("Ends", settings.quietHours.endMinute) { minute -> viewModel.update { it.copy(quietHours = it.quietHours.copy(endMinute = minute)) } }
        }
    }

    SettingCard {
        Toggle("Only with headphones", "Speak only when wired or Bluetooth headphones are connected", settings.headphonesOnly) { on ->
            viewModel.update { it.copy(headphonesOnly = on) }
        }
    }

    SettingCard {
        Title("While the phone is locked", ZarvisIcons.Lock, ZarvisAccents.violet)
        Column(Modifier.selectableGroup()) {
            LockScreenBehavior.entries.forEach { behavior ->
                Choice(behavior.label, null, settings.lockScreen == behavior) { viewModel.update { it.copy(lockScreen = behavior) } }
            }
        }
    }

    SettingCard(borderColor = if (settings.includeSensitive) ZarvisAccents.warning.copy(alpha = 0.45f) else null) {
        Toggle(
            "Include security & banking alerts",
            if (settings.includeSensitive) "On — OTPs, bank and sign-in alerts can be shown or spoken. Anyone nearby may hear them." else "Off — OTP, banking and authentication alerts are hidden and never spoken",
            settings.includeSensitive,
        ) { on -> viewModel.update { it.copy(includeSensitive = on) } }
    }

    SettingCard {
        Title("Excluded apps", ZarvisIcons.X, ZarvisAccents.blue)
        Text(
            if (settings.excludedPackages.isEmpty()) "None — every app follows the mode above." else "${settings.excludedPackages.size} app(s) are never read or spoken.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        QueenOutlineAction(label = "Choose apps", onClick = { showApps = true; viewModel.loadApps() }, icon = ZarvisIcons.List)
    }

    if (showApps) {
        QueenDialog(
            title = "Excluded apps",
            onDismiss = { showApps = false },
            confirmLabel = "Done",
            onConfirm = { showApps = false },
            icon = ZarvisIcons.Bell,
        ) {
            val installed = apps
            if (installed == null) {
                // Reading the apps can take a moment on a phone with hundreds: until then the list says it is loading, never looks empty.
                SkeletonList(loadingLabel = tr(UiString.COMMON_LOADING), rows = 3)
            } else {
                // Lazy, in its own window: a phone can have hundreds of apps, and composing every row inside the settings page made
                // each change there stutter on a low-end phone. One row per app even when it has several launcher entries.
                LazyColumn(Modifier.heightIn(max = 420.dp)) {
                    items(installed.distinctBy { it.packageName }, key = { it.packageName }) { app ->
                        val excluded = app.packageName in settings.excludedPackages
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = ZarvisSpacing.touchTarget).toggleable(value = excluded, role = Role.Checkbox) { on ->
                                viewModel.update { current ->
                                    current.copy(excludedPackages = if (on) current.excludedPackages + app.packageName else current.excludedPackages - app.packageName)
                                }
                            }.padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(checked = excluded, onCheckedChange = null)
                            Text(app.label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 8.dp))
                        }
                    }
                }
            }
        }
    }
}

/** One group of notification settings: a glass card with its rows spaced evenly. [borderColor] edges a card that needs care. */
@Composable
private fun SettingCard(borderColor: Color? = null, content: @Composable ColumnScope.() -> Unit) {
    GlassSurface(Modifier.fillMaxWidth(), borderColor = borderColor ?: GlassColors.border) {
        Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm), content = content)
    }
}

private fun modeExample(mode: NotificationMode): String = when (mode) {
    NotificationMode.OFF -> "ZARVIS never reads or speaks notifications"
    NotificationMode.APP_AND_TYPE -> "\"Message from WhatsApp\""
    NotificationMode.CONTACT_AND_APP -> "\"Message from Asha on WhatsApp\" (only names Android provides)"
    NotificationMode.CONTACT_APP_PREVIEW -> "Adds the first few words of the text"
    NotificationMode.FULL_CONTENT -> "Everything the notification shows"
}

/** A card's title (as written, not in capitals) with its icon tile. */
@Composable
private fun Title(text: String, icon: ImageVector, tint: Color) {
    Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.gap), verticalAlignment = Alignment.CenterVertically) {
        QueenIconTile(icon = icon, tint = tint, size = 32.dp)
        Text(text, style = ZarvisProStyles.rowTitle, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun Choice(title: String, subtitle: String?, selected: Boolean, onSelect: () -> Unit) {
    QueenChoiceRow(title = title, detail = subtitle, selected = selected, onClick = onSelect, contentPadding = PaddingValues(vertical = 8.dp))
}

@Composable
private fun Toggle(title: String, subtitle: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    QueenSwitchRow(title = title, detail = subtitle, checked = checked, onCheckedChange = onChange)
}

@Composable
private fun Stepper(label: String, minute: Int, onChange: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text("$label ${NotificationPrivacy.formatMinute(minute)}", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Row {
            ZarvisGhostButton(text = "−30 min", onClick = { onChange(Math.floorMod(minute - 30, QuietHours.MINUTES_PER_DAY)) })
            ZarvisGhostButton(text = "+30 min", onClick = { onChange(Math.floorMod(minute + 30, QuietHours.MINUTES_PER_DAY)) })
        }
    }
}
