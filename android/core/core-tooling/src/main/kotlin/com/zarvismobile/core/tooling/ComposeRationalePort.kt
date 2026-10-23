package com.zarvismobile.core.tooling

import com.zarvismobile.domain.access.RationaleChoice
import com.zarvismobile.domain.access.RationalePort
import com.zarvismobile.domain.access.RationaleRequest
import kotlin.coroutines.resume
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Bridges [RationalePort] to the root composable: the explanation screen (why / what data /
 * what won't happen automatically / how to revoke, with Allow · Not Now · Learn More) is shown
 * BEFORE any Android system dialog. Dismissing it counts as Not Now.
 *
 * One request at a time, as in [ComposeConfirmationPort]: several screens share this port, so a
 * second request waits for the first instead of replacing it, and only closes its own screen.
 */
class ComposeRationalePort : RationalePort {
    private val _pending = MutableStateFlow<PendingRationale?>(null)
    val pending: StateFlow<PendingRationale?> = _pending.asStateFlow()
    private val oneAtATime = Mutex()

    override suspend fun explain(request: RationaleRequest): RationaleChoice = oneAtATime.withLock {
        suspendCancellableCoroutine { continuation ->
            lateinit var mine: PendingRationale
            mine = PendingRationale(request) { choice ->
                _pending.compareAndSet(mine, null)
                if (continuation.isActive) continuation.resume(choice)
            }
            _pending.value = mine
            continuation.invokeOnCancellation { _pending.compareAndSet(mine, null) }
        }
    }
}

data class PendingRationale(
    val request: RationaleRequest,
    val respond: (RationaleChoice) -> Unit,
)
