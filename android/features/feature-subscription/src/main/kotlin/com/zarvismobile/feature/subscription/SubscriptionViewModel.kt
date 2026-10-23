package com.zarvismobile.feature.subscription

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.EntitlementSnapshotResponse
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** [failed] is shown as the screen's own plain message with Try again, never the exception's text ("Unable to resolve host …"). */
data class SubscriptionUiState(
    val entitlement: EntitlementSnapshotResponse? = null,
    val isLoading: Boolean = true,
    val failed: Boolean = false,
)

/** MASTER_SPEC.md §19-21 (Subscription/Trial/Usage) client view. Read again each time the screen is shown. */
@HiltViewModel
class SubscriptionViewModel @Inject constructor(
    private val api: ZarvisApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SubscriptionUiState())
    val uiState: StateFlow<SubscriptionUiState> = _uiState.asStateFlow()
    private var loading: Job? = null

    fun refresh() {
        if (loading?.isActive == true) return
        loading = viewModelScope.launch {
            // The plan already shown stays while it is read again.
            _uiState.update { it.copy(isLoading = true, failed = false) }
            try {
                val entitlement = api.getEntitlements()
                _uiState.update { SubscriptionUiState(entitlement = entitlement, isLoading = false) }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Throwable) {
                _uiState.update { it.copy(isLoading = false, failed = true) }
            }
        }
    }
}
