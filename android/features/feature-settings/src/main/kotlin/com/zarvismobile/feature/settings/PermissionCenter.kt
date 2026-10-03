package com.zarvismobile.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.viewModelScope
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.RiskBadge
import com.zarvismobile.core.ui.components.RiskBadgeLevel
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.domain.access.AccessCoordinator
import com.zarvismobile.domain.access.AccessResult
import com.zarvismobile.domain.access.AccessState
import com.zarvismobile.domain.access.AppSettingsPort
import com.zarvismobile.domain.access.DeviceAccessPort
import com.zarvismobile.domain.access.SettingsTarget
import com.zarvismobile.domain.access.settingsTargetFor
import com.zarvismobile.domain.access.satisfied
import com.zarvismobile.domain.capability.CapabilityDefinition
import com.zarvismobile.domain.capability.CapabilityId
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.capability.ConfirmationPolicy
import com.zarvismobile.domain.entity.CapabilityStatus
import com.zarvismobile.domain.entity.PermissionType
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** One capability with its live Android access state. */
data class CapabilityRow(
    val definition: CapabilityDefinition,
    val states: Map<PermissionType, AccessState>,
) {
    val accessSummary: String
        get() = when {
            !definition.implementedOnAndroid -> "Not available in this build"
            states.isEmpty() -> "No permission held — uses a system screen or picker you control each time"
            states.values.any { it == AccessState.UNAVAILABLE } -> "Not available on this phone's Android version"
            states.values.all { it.satisfied() } -> if (states.keys.any { it.specialAccess }) "On (Android reports it enabled)" else "Allowed"
            states.values.any { it == AccessState.SPECIAL_ACCESS_OFF } -> "Off — only you can turn it on, in Android Settings"
            states.values.any { it == AccessState.SYSTEM_DISABLED } -> "Turned off in Android settings"
            states.values.any { it == AccessState.PERMANENTLY_DENIED } -> "Blocked — can only be turned on in Android Settings"
            states.values.any { it == AccessState.DENIED } -> "Not allowed — Android can ask again"
            else -> "Not requested yet"
        }

    val needsAccess: Boolean
        get() = definition.implementedOnAndroid && states.isNotEmpty() && !states.values.all { it.satisfied() } &&
            states.values.none { it == AccessState.UNAVAILABLE }

    val granted: Boolean
        get() = definition.implementedOnAndroid && states.isNotEmpty() && states.values.all { it.satisfied() }
}

data class PermissionCenterState(
    val rows: List<CapabilityRow> = emptyList(),
    val message: String? = null,
)

/**
 * Permission Center (blueprint §8 "Permissions / Device Access"): every Phase 1 capability,
 * its truthful status, and its *live* Android state — re-read on every resume so a permission
 * revoked in Android Settings shows up immediately.
 */
@HiltViewModel
class PermissionCenterViewModel @Inject constructor(
    private val registry: CapabilityRegistry,
    private val device: DeviceAccessPort,
    private val coordinator: AccessCoordinator,
    private val appSettings: AppSettingsPort,
) : ViewModel() {
    private val _state = MutableStateFlow(PermissionCenterState())
    val state: StateFlow<PermissionCenterState> = _state.asStateFlow()

    fun refresh() {
        viewModelScope.launch {
            val rows = registry.capabilities.map { capability ->
                CapabilityRow(capability, capability.permissionTypes.associateWith { device.state(it) })
            }
            _state.value = _state.value.copy(rows = rows)
        }
    }

    fun allow(id: CapabilityId) {
        viewModelScope.launch {
            val capability = registry.get(id)
            val message = when (val result = coordinator.ensure(capability)) {
                AccessResult.Granted -> "${capability.name} is allowed. ZARVIS still asks before any action that needs your confirmation."
                is AccessResult.Declined -> "Nothing changed. ${capability.denialBehavior}"
                is AccessResult.Denied -> "Android reports ${capability.name.lowercase()} is still off. ${capability.fallback}"
                is AccessResult.Unsupported -> result.reason ?: "${capability.name} isn't available in this build."
            }
            _state.value = _state.value.copy(message = message)
            refresh()
        }
    }

    /**
     * Revoking is done in Android Settings — ZARVIS can't revoke its own access silently. Opens
     * the exact page for the capability (e.g. Notification access), not just the app page.
     */
    fun openAndroidSettings(id: CapabilityId) {
        viewModelScope.launch {
            val row = _state.value.rows.firstOrNull { it.definition.id == id }
            val target = row?.states?.entries?.firstOrNull()?.let { (permission, state) -> settingsTargetFor(permission, state) }
                ?: SettingsTarget.APP_DETAILS
            appSettings.openAndAwaitReturn(target)
            refresh()
        }
    }

    fun dismissMessage() {
        _state.value = _state.value.copy(message = null)
    }
}

@Composable
fun PermissionCenterScreen(onBack: () -> Unit, viewModel: PermissionCenterViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    LifecycleResumeEffect(Unit) {
        viewModel.refresh()
        onPauseOrDispose { }
    }
    ZarvisBackground {
        LazyColumn(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(),
            contentPadding = PaddingValues(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                TextButton(onClick = onBack) { Text("‹ Back") }
                Text("Permissions & Device Access", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text(
                    "Android decides what ZARVIS may access; this page shows what Android reports right now. " +
                        "Allowing access never authorizes an action on its own — calls and other sensitive actions still ask you each time.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            state.message?.let { message ->
                item {
                    GlassSurface(Modifier.fillMaxWidth()) {
                        Text(message, style = MaterialTheme.typography.bodyMedium)
                        TextButton(onClick = viewModel::dismissMessage) { Text("OK") }
                    }
                }
            }
            items(state.rows, key = { it.definition.id.wireId }) { row ->
                CapabilityCard(row, onAllow = { viewModel.allow(row.definition.id) }, onOpenSettings = { viewModel.openAndroidSettings(row.definition.id) })
            }
        }
    }
}

@Composable
private fun CapabilityCard(row: CapabilityRow, onAllow: () -> Unit, onOpenSettings: () -> Unit) {
    val capability = row.definition
    var expanded by rememberSaveable(capability.id.wireId) { mutableStateOf(false) }
    GlassSurface(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(capability.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            RiskBadge(level = RiskBadgeLevel.valueOf(capability.risk.name))
        }
        Text(
            "Android: ${statusLabel(capability.android.status)} · Web: ${statusLabel(capability.web.status)}",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
        )
        Text(
            row.accessSummary,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.semantics { contentDescription = "${capability.name}: ${row.accessSummary}" },
        )
        if (capability.confirmation == ConfirmationPolicy.PER_ACTION) {
            Text("Every action asks for your confirmation.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
            if (row.needsAccess) {
                ZarvisPrimaryButton(text = if (row.states.keys.any { it.specialAccess }) "Turn on" else "Allow", onClick = onAllow)
            }
            if (row.granted) ZarvisSecondaryButton(text = "Turn off in Android Settings", onClick = onOpenSettings)
            TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Less" else "Learn more") }
        }
        if (expanded) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
                Detail("Why", capability.rationale.why)
                Detail("What data", capability.rationale.data)
                Detail("What ZARVIS won't do automatically", capability.rationale.notAutomatic)
                Detail("How to revoke", capability.rationale.revoke)
                Detail("Data exposure", capability.dataExposure)
                if (capability.supportedActions.isNotEmpty()) Detail("Supported", capability.supportedActions.joinToString("; "))
                Detail("Not supported", capability.unsupportedActions.joinToString("; "))
                Detail("If you say no", capability.denialBehavior + " " + capability.fallback)
                Detail("Where to change it", capability.settingsDestination)
                Detail("Android requirements", capability.androidRequirements)
                Detail("Status on Android", capability.android.note)
            }
        }
    }
}

@Composable
private fun Detail(label: String, body: String) {
    Column {
        Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        Text(body, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

internal fun statusLabel(status: CapabilityStatus): String = when (status) {
    CapabilityStatus.WORKING -> "Working"
    CapabilityStatus.PARTIAL -> "Partial"
    CapabilityStatus.PLANNED -> "Planned"
    CapabilityStatus.UNSUPPORTED -> "Unsupported"
}
