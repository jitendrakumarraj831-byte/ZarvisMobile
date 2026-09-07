package com.zarvismobile.core.ui.components

/**
 * Drives both the AI Orb's animation and the TTS/STT lifecycle — see MASTER_SPEC.md §11
 * (Voice Architecture). Every state must be rendered distinctly so the user always knows
 * what the system is doing. [SUCCESS] is a brief, purely visual "done" flash (emerald glow)
 * shown right after a turn completes and before the assistant speaks — it never blocks
 * anything and is not persisted.
 */
enum class VoiceState {
    IDLE,
    LISTENING,
    UNDERSTANDING,
    PLANNING,
    EXECUTING,
    SUCCESS,
    SPEAKING,
    ERROR,
}
