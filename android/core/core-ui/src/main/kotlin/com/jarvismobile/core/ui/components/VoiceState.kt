package com.jarvismobile.core.ui.components

/**
 * Drives both the AI Orb's animation and the TTS/STT lifecycle — see MASTER_SPEC.md §11
 * (Voice Architecture). Every state must be rendered distinctly so the user always knows
 * what the system is doing.
 */
enum class VoiceState {
    IDLE,
    LISTENING,
    UNDERSTANDING,
    PLANNING,
    EXECUTING,
    SPEAKING,
    ERROR,
}
