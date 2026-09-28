package com.zarvismobile.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.core.tooling.ComposeRationalePort
import com.zarvismobile.core.tooling.PendingRationale
import com.zarvismobile.domain.access.RevocationDetector
import com.zarvismobile.domain.capability.CapabilityRegistry
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Root-level permission intelligence: exposes the pending rationale (explanation screen) and
 * detects permissions revoked in Android Settings every time the app returns to the
 * foreground, so the user is told immediately instead of discovering it mid-action.
 */
@HiltViewModel
class PermissionMonitorViewModel @Inject constructor(
    private val detector: RevocationDetector,
    val registry: CapabilityRegistry,
    rationalePort: ComposeRationalePort,
) : ViewModel() {
    val pendingRationale: StateFlow<PendingRationale?> = rationalePort.pending

    private val _revokedNotice = MutableStateFlow<String?>(null)
    val revokedNotice: StateFlow<String?> = _revokedNotice.asStateFlow()

    fun onResume() {
        viewModelScope.launch {
            val permissions = registry.capabilities.filter { it.implementedOnAndroid }.flatMap { it.permissionTypes }.distinct()
            val report = detector.check(permissions)
            if (report.revoked.isNotEmpty()) {
                val names = report.revoked.flatMap { registry.usingPermission(it) }.map { it.name }.distinct()
                _revokedNotice.value = "${names.joinToString(", ")} access was turned off in Android settings. " +
                    "ZARVIS won't use it until you allow it again."
            }
        }
    }

    fun dismissNotice() {
        _revokedNotice.value = null
    }
}
