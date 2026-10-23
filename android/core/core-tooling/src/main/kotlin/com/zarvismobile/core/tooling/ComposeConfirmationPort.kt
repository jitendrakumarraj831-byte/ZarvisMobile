package com.zarvismobile.core.tooling

import com.zarvismobile.domain.entity.ConfirmationRequest
import com.zarvismobile.domain.port.ConfirmationPort
import kotlin.coroutines.resume
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Bridges the pure-Kotlin [ConfirmationPort] suspend function to a Compose confirmation
 * dialog (MASTER_SPEC.md §7, §21: MEDIUM/HIGH risk skills must block on an explicit user
 * "yes"). The UI layer collects [pending] and renders an AlertDialog when non-null, calling
 * [PendingConfirmation.respond] when the user answers.
 *
 * One request at a time: the Chat tab, a chat opened from Home and the assistant overlay share
 * this port, so a second request waits until the first is answered instead of replacing it
 * (which left the first turn waiting forever), and a request only ever closes its own dialog.
 */
class ComposeConfirmationPort : ConfirmationPort {
    private val _pending = MutableStateFlow<PendingConfirmation?>(null)
    val pending: StateFlow<PendingConfirmation?> = _pending.asStateFlow()
    private val oneAtATime = Mutex()

    override suspend fun confirm(request: ConfirmationRequest): Boolean = oneAtATime.withLock {
        suspendCancellableCoroutine { continuation ->
            lateinit var mine: PendingConfirmation
            mine = PendingConfirmation(request) { approved ->
                _pending.compareAndSet(mine, null)
                if (continuation.isActive) continuation.resume(approved)
            }
            _pending.value = mine
            continuation.invokeOnCancellation { _pending.compareAndSet(mine, null) }
        }
    }
}

data class PendingConfirmation(
    val request: ConfirmationRequest,
    val respond: (Boolean) -> Unit,
)
