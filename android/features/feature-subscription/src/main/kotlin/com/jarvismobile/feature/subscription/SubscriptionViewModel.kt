package com.jarvismobile.feature.subscription

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jarvismobile.data.remote.JarvisApi
import com.jarvismobile.data.remote.dto.EntitlementSnapshotResponse
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SubscriptionUiState(
    val entitlement: EntitlementSnapshotResponse? = null,
    val isLoading: Boolean = true,
    val error: String? = null,
)

/** MASTER_SPEC.md §19-21 (Subscription/Trial/Usage) client view. */
@HiltViewModel
class SubscriptionViewModel @Inject constructor(
    private val api: JarvisApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SubscriptionUiState())
    val uiState: StateFlow<SubscriptionUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                _uiState.value = SubscriptionUiState(entitlement = api.getEntitlements(), isLoading = false)
            } catch (t: Throwable) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = t.message ?: "Couldn't load your subscription.")
            }
        }
    }
}
