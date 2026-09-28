package com.zarvismobile.app

import android.content.Context
import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.tooling.PendingConfirmation
import com.zarvismobile.core.tooling.PendingRationale
import com.zarvismobile.core.ui.components.RiskBadge
import com.zarvismobile.core.ui.components.RiskBadgeLevel
import com.zarvismobile.domain.access.RationaleChoice
import com.zarvismobile.domain.access.SettingsReason
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.domain.entity.PermissionType

/** The permission explanation and exact-action confirmation, shown by every ZARVIS activity. */
@Composable
fun ZarvisSystemDialogs(permissionViewModel: PermissionMonitorViewModel, confirmationViewModel: ConfirmationViewModel) {
    val rationale by permissionViewModel.pendingRationale.collectAsState()
    rationale?.let { RationaleDialog(it, permissionViewModel.registry) }

    val pending by confirmationViewModel.pending.collectAsState()
    pending?.let { RiskConfirmationDialog(it) }
}

/**
 * Blueprint §8/§10 permission explanation, shown BEFORE any Android system dialog or Settings
 * page: why · what data · what won't happen automatically · how to revoke, with
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
    val context = LocalContext.current
    var learnMore by rememberSaveable(pending.request.capabilityId) { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { pending.respond(RationaleChoice.NOT_NOW) },
        title = { Text("Allow ${capability.name.lowercase()}?") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                RiskBadge(level = RiskBadgeLevel.valueOf(capability.risk.name))
                Section("Why", capability.rationale.why)
                Section("What data", capability.rationale.data)
                Section("What ZARVIS won't do automatically", capability.rationale.notAutomatic)
                Section("How to turn it off", capability.rationale.revoke)
                settingsNote(pending, capability.settingsDestination, context)?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                }
                if (learnMore) {
                    Section("Data exposure", capability.dataExposure)
                    Section("Supported", capability.supportedActions.joinToString("; ").ifBlank { "—" })
                    Section("Not supported", capability.unsupportedActions.joinToString("; "))
                    Section("If you choose Not now", "${capability.denialBehavior} ${capability.fallback}")
                    Section("Where to change it later", capability.settingsDestination)
                    Section("Android requirements", capability.androidRequirements)
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

private fun settingsNote(pending: PendingRationale, destination: String, context: Context): String? = when (pending.request.settingsReason) {
    null -> null
    SettingsReason.SPECIAL_ACCESS -> buildString {
        append("Android only lets you turn this on in its own settings. ZARVIS will open $destination — switch ZARVIS on there, then come back. ZARVIS checks again when you return.")
        if (restrictedSettingsMayApply(pending, context)) {
            append(" If Android says \"Restricted setting\", open App info for ZARVIS, tap ⋮ > Allow restricted settings, then try again.")
        }
    }
    SettingsReason.PERMANENTLY_DENIED ->
        "Android is no longer showing the permission prompt for this, so it can only be turned on in Android Settings. ZARVIS will check again when you come back."
    SettingsReason.SYSTEM_SWITCH_OFF ->
        "This is switched off in Android Settings (for example the app's notification switch). ZARVIS will open it and check again when you come back."
}

/** Android 13+ blocks notification access and accessibility for apps installed outside an app store until allowed in App info. */
private fun restrictedSettingsMayApply(pending: PendingRationale, context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
    if (pending.request.permissions.none { it == PermissionType.NOTIFICATION_LISTENER || it == PermissionType.ACCESSIBILITY_SERVICE }) return false
    val installer = runCatching { context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName }.getOrNull()
    return installer != "com.android.vending"
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
