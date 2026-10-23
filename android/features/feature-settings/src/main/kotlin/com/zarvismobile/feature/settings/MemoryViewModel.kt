package com.zarvismobile.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.CreateNoteRequest
import com.zarvismobile.data.remote.dto.MemoryOverviewResponse
import com.zarvismobile.data.remote.dto.MemorySettingsRequest
import com.zarvismobile.data.remote.dto.UpdateNoteRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class MemoryUiState(
    /** What the server holds, or `null` until the first load works. */
    val overview: MemoryOverviewResponse? = null,
    val isLoading: Boolean = true,
    /** The overview could not be read. */
    val loadFailed: Boolean = false,
    /** A change (pause, delete, forget) did not go through; the list shown is what the server still holds. */
    val actionFailed: Boolean = false,
    /** A change is on its way, so its buttons wait. */
    val busy: Boolean = false,
    /** How many items the last "forget all" removed, for one line of feedback. */
    val forgotten: Int? = null,
    /** The last "add to memory" was saved by the server: one line of feedback, and the screen clears what was typed. */
    val added: Boolean = false,
)

/**
 * Add, browse, pause and delete what ZARVIS remembers, through the same endpoints as the website's Memory page
 * (GET /memory, POST /notes, PATCH /notes/:id, PUT /memory/settings, DELETE /notes/:id, DELETE /memory/personal). Memory is only
 * what the user saves here or on the website; nothing is remembered automatically. Nothing is kept on the phone: every list shown
 * is what the server returned, and a change that fails says so and leaves the list as it was.
 */
@HiltViewModel
class MemoryViewModel @Inject constructor(
    private val api: ZarvisApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MemoryUiState())
    val uiState: StateFlow<MemoryUiState> = _uiState.asStateFlow()

    /** Reads the memory again. The screen calls this each time it is shown, so it never shows an old list. */
    fun refresh() {
        viewModelScope.launch { load() }
    }

    fun setEnabled(enabled: Boolean) = change { api.setMemoryEnabled(MemorySettingsRequest(enabled)) }

    /**
     * Saves [content] (trimmed) as one personal memory item. False, and nothing is sent, when it is empty or longer than the server keeps
     * ([MAX_MEMORY_CHARS]), or while another change is on its way.
     */
    fun add(content: String): Boolean {
        val text = content.trim()
        if (text.isEmpty() || text.length > MAX_MEMORY_CHARS) return false
        return change {
            api.createNote(CreateNoteRequest(kind = "memory", content = text))
            _uiState.update { it.copy(added = true) }
        }
    }

    /** Pauses ([enabled] false) or resumes one item. A paused item stays saved; ZARVIS just does not use it. */
    fun setItemEnabled(noteId: String, enabled: Boolean) = change { api.updateNote(noteId, UpdateNoteRequest(enabled)) }

    fun delete(noteId: String) = change { api.deleteNote(noteId) }

    fun forgetAllPersonal() = change {
        val removed = api.forgetPersonalMemory().removed
        _uiState.update { it.copy(forgotten = removed) }
    }

    /** Runs one write, then reads the memory back so the screen shows what the server now holds. False when another is on its way. */
    private fun change(write: suspend () -> Unit): Boolean {
        if (_uiState.value.busy) return false
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, actionFailed = false, forgotten = null, added = false) }
            try {
                write()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (t: Throwable) {
                _uiState.update { it.copy(busy = false, actionFailed = true) }
                return@launch
            }
            load()
            _uiState.update { it.copy(busy = false) }
        }
        return true
    }

    companion object {
        /** The longest item the server keeps (backend/src/workspace/limits.ts `LIMITS.noteContent`). */
        const val MAX_MEMORY_CHARS = 2_000
    }

    private suspend fun load() {
        _uiState.update { it.copy(isLoading = true, loadFailed = false) }
        try {
            val overview = api.getMemory()
            _uiState.update { it.copy(overview = overview, isLoading = false, loadFailed = false) }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (t: Throwable) {
            _uiState.update { it.copy(isLoading = false, loadFailed = true) }
        }
    }
}
