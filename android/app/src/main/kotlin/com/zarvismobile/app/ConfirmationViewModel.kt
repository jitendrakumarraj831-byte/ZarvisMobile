package com.zarvismobile.app

import androidx.lifecycle.ViewModel
import com.zarvismobile.core.tooling.ComposeConfirmationPort
import com.zarvismobile.core.tooling.PendingConfirmation
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.StateFlow

/**
 * Exposes [ComposeConfirmationPort.pending] to the root composable so a MEDIUM/HIGH risk
 * skill's confirmation request is never left unanswered — see MASTER_SPEC.md §7, §21: a
 * skill that requires confirmation must block until the user explicitly answers, and the
 * app must always be able to show that prompt regardless of which screen is on top.
 */
@HiltViewModel
class ConfirmationViewModel @Inject constructor(
    private val confirmationPort: ComposeConfirmationPort,
) : ViewModel() {
    val pending: StateFlow<PendingConfirmation?> = confirmationPort.pending
}
