package com.zarvismobile.feature.developer

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.DeveloperAnalyzeRequest
import com.zarvismobile.data.remote.dto.RepoStructureDto
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class DeveloperUiState(
    val repoUrl: String = "",
    val isAnalyzing: Boolean = false,
    val result: RepoStructureDto? = null,
    val summary: String? = null,
    val error: String? = null,
)

/**
 * Developer Mode entry point — the read-only Repository Agent analysis from
 * DEVELOPER_AGENT.md. Write-capable stages (plan/code/PR) are not implemented in this pass;
 * this screen only ever calls the LOW-risk, no-confirmation `developer.analyze_repo` skill.
 */
@HiltViewModel
class DeveloperViewModel @Inject constructor(
    private val api: ZarvisApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(DeveloperUiState())
    val uiState: StateFlow<DeveloperUiState> = _uiState.asStateFlow()

    fun onRepoUrlChange(url: String) {
        _uiState.value = _uiState.value.copy(repoUrl = url)
    }

    fun analyze() {
        val repoUrl = _uiState.value.repoUrl.trim()
        if (repoUrl.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "Enter a repository URL first.")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isAnalyzing = true, error = null, result = null, summary = null)
            try {
                val response = api.analyzeRepo(DeveloperAnalyzeRequest(repoUrl))
                if (response.kind == "success" && response.result != null) {
                    _uiState.value = _uiState.value.copy(
                        isAnalyzing = false,
                        result = response.result.output.structure,
                        summary = response.result.summary,
                    )
                } else {
                    // Never fake success — the pipeline reported a non-success outcome (e.g. an
                    // entitlement or permission denial). See MASTER_SPEC.md Product Principle #4.
                    _uiState.value = _uiState.value.copy(isAnalyzing = false, error = "Analysis was not completed (${response.kind}).")
                }
            } catch (t: Throwable) {
                _uiState.value = _uiState.value.copy(isAnalyzing = false, error = t.message ?: "Couldn't analyze that repository.")
            }
        }
    }
}
