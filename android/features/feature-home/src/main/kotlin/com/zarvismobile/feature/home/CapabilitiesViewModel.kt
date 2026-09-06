package com.zarvismobile.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.SkillDto
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class CapabilitiesUiState(
    val skills: List<SkillDto> = emptyList(),
    val isLoading: Boolean = true,
    val error: String? = null,
)

/** Loads the live skill catalogue for the Capabilities Hub (MASTER_SPEC.md §22 "Feature Showcase Hub by Category"). */
@HiltViewModel
class CapabilitiesViewModel @Inject constructor(
    private val api: ZarvisApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(CapabilitiesUiState())
    val uiState: StateFlow<CapabilitiesUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            try {
                _uiState.value = CapabilitiesUiState(skills = api.getSkills().skills, isLoading = false)
            } catch (t: Throwable) {
                // Never fake success — surface the real failure (MASTER_SPEC.md Product Principle #4).
                _uiState.value = _uiState.value.copy(isLoading = false, error = t.message ?: "Couldn't load capabilities right now.")
            }
        }
    }
}
