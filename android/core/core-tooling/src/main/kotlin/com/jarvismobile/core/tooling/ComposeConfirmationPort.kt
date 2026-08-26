package com.jarvismobile.core.tooling

import com.jarvismobile.domain.entity.ConfirmationRequest
import com.jarvismobile.domain.port.ConfirmationPort
import kotlin.coroutines.resume
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Bridges the pure-Kotlin [ConfirmationPort] suspend function to a Compose confirmation
 * dialog (MASTER_SPEC.md §7, §21: MEDIUM/HIGH risk skills must block on an explicit user
 * "yes"). The UI layer collects [pending] and renders an AlertDialog when non-null, calling
 * [PendingConfirmation.respond] when the user answers.
 */
class ComposeConfirmationPort : ConfirmationPort {
    private val _pending = MutableStateFlow<PendingConfirmation?>(null)
    val pending: StateFlow<PendingConfirmation?> = _pending.asStateFlow()

    override suspend fun confirm(request: ConfirmationRequest): Boolean = suspendCancellableCoroutine { continuation ->
        _pending.value = PendingConfirmation(request) { approved ->
            _pending.value = null
            if (continuation.isActive) continuation.resume(approved)
        }
        continuation.invokeOnCancellation { _pending.value = null }
    }
}

data class PendingConfirmation(
    val request: ConfirmationRequest,
    val respond: (Boolean) -> Unit,
)
