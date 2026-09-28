package com.zarvismobile.core.tooling

import com.zarvismobile.domain.access.RationaleChoice
import com.zarvismobile.domain.access.RationalePort
import com.zarvismobile.domain.access.RationaleRequest
import kotlin.coroutines.resume
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Bridges [RationalePort] to the root composable: the explanation screen (why / what data /
 * what won't happen automatically / how to revoke, with Allow · Not Now · Learn More) is shown
 * BEFORE any Android system dialog. Dismissing it counts as Not Now.
 */
class ComposeRationalePort : RationalePort {
    private val _pending = MutableStateFlow<PendingRationale?>(null)
    val pending: StateFlow<PendingRationale?> = _pending.asStateFlow()

    override suspend fun explain(request: RationaleRequest): RationaleChoice = suspendCancellableCoroutine { continuation ->
        _pending.value = PendingRationale(request) { choice ->
            _pending.value = null
            if (continuation.isActive) continuation.resume(choice)
        }
        continuation.invokeOnCancellation { _pending.value = null }
    }
}

data class PendingRationale(
    val request: RationaleRequest,
    val respond: (RationaleChoice) -> Unit,
)
