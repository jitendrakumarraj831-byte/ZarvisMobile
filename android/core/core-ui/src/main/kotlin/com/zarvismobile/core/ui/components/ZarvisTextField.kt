package com.zarvismobile.core.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.ZarvisAccentCyan

/**
 * The Home/Conversation composer — text input with an inline mic toggle, per
 * MASTER_SPEC.md §11 "text input must also remain available" and the Home screen concept in
 * §22 (`[ 🎙 Speak ]` next to `[ Type your task ]`). Gains an electric-cyan neon glow the
 * instant it's focused (§22 "Floating Command Bar with glowing electric neon border on
 * focus") — driven purely by [collectIsFocusedAsState], so it reacts the same frame as the
 * keyboard opens with no perceptible delay.
 */
@Composable
fun ZarvisComposer(
    value: String,
    onValueChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onMicClick: () -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Type your task",
    enabled: Boolean = true,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isFocused by interactionSource.collectIsFocusedAsState()
    val glowAlpha by animateFloatAsState(targetValue = if (isFocused) 0.4f else 0f, label = "composer-glow")
    val cornerRadius = 28.dp

    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier
            .fillMaxWidth()
            .drawBehind {
                if (glowAlpha > 0f) {
                    drawRoundRect(
                        brush = Brush.radialGradient(
                            colors = listOf(ZarvisAccentCyan.copy(alpha = glowAlpha), Color.Transparent),
                            radius = size.maxDimension * 0.75f,
                        ),
                        cornerRadius = CornerRadius(cornerRadius.toPx()),
                    )
                }
            },
        interactionSource = interactionSource,
        enabled = enabled,
        shape = RoundedCornerShape(cornerRadius),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = ZarvisAccentCyan,
            cursorColor = ZarvisAccentCyan,
            focusedLeadingIconColor = ZarvisAccentCyan,
            focusedTrailingIconColor = ZarvisAccentCyan,
        ),
        placeholder = { Text(placeholder) },
        leadingIcon = {
            IconButton(onClick = onMicClick, enabled = enabled) {
                Icon(imageVector = Icons.Filled.Mic, contentDescription = "Speak")
            }
        },
        trailingIcon = {
            IconButton(onClick = onSubmit, enabled = enabled && value.isNotBlank()) {
                Icon(imageVector = Icons.Filled.Send, contentDescription = "Send")
            }
        },
        singleLine = true,
    )
}
