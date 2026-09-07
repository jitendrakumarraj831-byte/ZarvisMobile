package com.zarvismobile.core.ui.components

import androidx.compose.ui.graphics.Color
import com.zarvismobile.core.ui.theme.GlowColors
import com.zarvismobile.core.ui.theme.ZarvisAccentCyan
import com.zarvismobile.core.ui.theme.ZarvisAccentIndigo

/**
 * The status-pulse glow color for a given [VoiceState] — shared between [AiOrb]'s halo and
 * any [StatusPulseBadge] shown alongside it, so the orb and its label always agree visually.
 */
fun GlowColorsFor(state: VoiceState): Color = when (state) {
    VoiceState.IDLE -> ZarvisAccentCyan
    VoiceState.LISTENING -> GlowColors.active
    VoiceState.UNDERSTANDING, VoiceState.PLANNING -> ZarvisAccentIndigo
    VoiceState.EXECUTING -> GlowColors.active
    VoiceState.SUCCESS -> GlowColors.success
    VoiceState.SPEAKING -> ZarvisAccentIndigo
    VoiceState.ERROR -> GlowColors.error
}
