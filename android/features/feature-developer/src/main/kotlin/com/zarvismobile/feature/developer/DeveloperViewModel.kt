package com.zarvismobile.feature.developer

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.remote.ApiErrorBodies
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.DeveloperAnalyzeRequest
import com.zarvismobile.data.remote.dto.RepoStructureDto
import dagger.hilt.android.lifecycle.HiltViewModel
import java.io.IOException
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import retrofit2.HttpException

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
                val structure = response.result?.output?.structure
                if (response.kind == "success" && structure != null) {
                    _uiState.value = _uiState.value.copy(
                        isAnalyzing = false,
                        result = structure,
                        summary = response.result?.summary ?: response.structured?.userSafeMessage,
                    )
                } else {
                    // Never fake success — the pipeline reported a non-success outcome (a missing or private repository, a denial). Its own
                    // plain-language words are shown; the outcome name only when the server sent none. See MASTER_SPEC.md Product Principle #4.
                    val said = response.structured?.userSafeMessage ?: response.result?.userMessage
                    _uiState.value = _uiState.value.copy(
                        isAnalyzing = false,
                        error = said?.let { "Analysis was not completed: $it" } ?: "Analysis was not completed (${response.kind}).",
                    )
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (e: HttpException) {
                // The server's reason (`{error}`), never the exception's own text ("HTTP 400 ").
                val said = ApiErrorBodies.codeOf(runCatching { e.response()?.errorBody()?.string() }.getOrNull())
                _uiState.value = _uiState.value.copy(isAnalyzing = false, error = said ?: "ZARVIS couldn't analyze that repository (the server answered ${e.code()}).")
            } catch (e: IOException) {
                _uiState.value = _uiState.value.copy(isAnalyzing = false, error = "Couldn't reach ZARVIS, so nothing was analyzed. Check your connection and try again.")
            } catch (t: Throwable) {
                _uiState.value = _uiState.value.copy(isAnalyzing = false, error = "Couldn't read ZARVIS's answer, so nothing is shown. Please try again.")
            }
        }
    }
}
