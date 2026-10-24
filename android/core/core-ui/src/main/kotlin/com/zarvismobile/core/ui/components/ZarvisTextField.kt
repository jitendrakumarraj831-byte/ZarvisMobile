package com.zarvismobile.core.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
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
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.zarvisActionBrush
import com.zarvismobile.domain.presentation.UiString

/**
 * The Home/Conversation composer — text input with an inline mic toggle, per
 * MASTER_SPEC.md §11 "text input must also remain available" and the Home screen concept in
 * §22 (`[ 🎙 Speak ]` next to `[ Type your task ]`). Gains a soft glow in the theme's primary colour the
 * instant it's focused (§22 "Floating Command Bar with glowing neon border on focus") — driven purely by
 * [collectIsFocusedAsState], so it reacts the same frame as the keyboard opens with no perceptible delay.
 *
 * The focus ring is the theme's primary (4.4:1 or better on both pages; the old cyan was 1.7:1 on the light one), the field sits on the
 * raised card colour, and the mic and send buttons are named in the app's language for TalkBack.
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
    showMic: Boolean = true,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isFocused by interactionSource.collectIsFocusedAsState()
    val glowAlpha by animateFloatAsState(targetValue = if (isFocused) 0.32f else 0f, label = "composer-glow")
    val cornerRadius = 28.dp
    val accent = MaterialTheme.colorScheme.primary
    val fill = GlassColors.surfaceTintElevated

    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier
            .fillMaxWidth()
            .drawBehind {
                if (glowAlpha > 0f) {
                    drawRoundRect(
                        brush = Brush.radialGradient(
                            colors = listOf(accent.copy(alpha = glowAlpha), Color.Transparent),
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
            focusedContainerColor = fill,
            unfocusedContainerColor = fill,
            disabledContainerColor = fill,
            focusedBorderColor = accent,
            // A quiet edge (Queen Pro), still 3:1 or more against the page in both themes, so the field is findable.
            unfocusedBorderColor = MaterialTheme.colorScheme.outline,
            unfocusedLeadingIconColor = ZarvisAccents.gold,
            cursorColor = accent,
            focusedLeadingIconColor = accent,
            focusedTrailingIconColor = accent,
            focusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant,
            unfocusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant,
        ),
        placeholder = { Text(placeholder) },
        // Chat shows its own orb next to the field as the microphone, so the field drops its mic there ([showMic] false).
        leadingIcon = if (showMic) {
            {
                IconButton(onClick = onMicClick, enabled = enabled) {
                    Icon(imageVector = Icons.Filled.Mic, contentDescription = tr(UiString.A11Y_SPEAK))
                }
            }
        } else {
            null
        },
        trailingIcon = {
            val canSend = enabled && value.isNotBlank()
            // Ready to send, the button wears the action gradient with a white arrow (at least 4.5:1 at every stop).
            IconButton(
                onClick = onSubmit,
                enabled = canSend,
                modifier = if (canSend) Modifier.background(zarvisActionBrush(), CircleShape) else Modifier,
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.Send,
                    contentDescription = tr(UiString.A11Y_SEND),
                    tint = if (canSend) Color.White else LocalContentColor.current,
                )
            }
        },
        singleLine = false,
        maxLines = 4,
    )
}
