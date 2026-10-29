package com.zarvismobile.core.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisCorners
import com.zarvismobile.core.ui.theme.zarvisActionBrush
import com.zarvismobile.domain.presentation.UiString

/**
 * The colours every ZARVIS field shares: the raised card colour inside, a quiet outline (3:1 or more against the page in both themes,
 * so the field is findable) that turns the theme's primary on focus, and icons in the primary.
 */
@Composable
fun zarvisFieldColors(): TextFieldColors {
    val fill = GlassColors.surfaceTintElevated
    val accent = MaterialTheme.colorScheme.primary
    return OutlinedTextFieldDefaults.colors(
        focusedContainerColor = fill,
        unfocusedContainerColor = fill,
        disabledContainerColor = fill,
        errorContainerColor = fill,
        focusedBorderColor = accent,
        unfocusedBorderColor = MaterialTheme.colorScheme.outline,
        cursorColor = accent,
        focusedLeadingIconColor = accent,
        unfocusedLeadingIconColor = ZarvisAccents.primary,
        focusedTrailingIconColor = accent,
        focusedLabelColor = accent,
        focusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant,
        unfocusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/**
 * A text field (Queen Night): the raised card colour, 14dp corners and [zarvisFieldColors]. [label] floats above the text; [supportingText]
 * sits under the field (a hint, a count, or with [isError] what is wrong). [trailing] is a small control at the end, such as Show
 * password.
 */
@Composable
fun ZarvisTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    leadingIcon: ImageVector? = null,
    trailing: (@Composable () -> Unit)? = null,
    supportingText: String? = null,
    isError: Boolean = false,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    minLines: Int = 1,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        label = label?.let { { Text(it) } },
        placeholder = placeholder?.let { { Text(it) } },
        leadingIcon = leadingIcon?.let { { Icon(imageVector = it, contentDescription = null) } },
        trailingIcon = trailing,
        supportingText = supportingText?.let { { Text(it) } },
        isError = isError,
        singleLine = singleLine,
        minLines = minLines,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        visualTransformation = visualTransformation,
        shape = ZarvisCorners.field,
        colors = zarvisFieldColors(),
    )
}

/**
 * A search field: a pill with the search icon, and (while there is something to clear) a Clear button that empties it, named for
 * TalkBack. The search runs as you type, so the keyboard's action only closes the keyboard.
 */
@Composable
fun ZarvisSearchField(query: String, onQueryChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    val keyboard = LocalSoftwareKeyboardController.current
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = modifier.fillMaxWidth(),
        singleLine = true,
        shape = ZarvisCorners.pill,
        placeholder = { Text(placeholder) },
        leadingIcon = { Icon(imageVector = ZarvisIcons.Search, contentDescription = null) },
        trailingIcon = if (query.isNotEmpty()) {
            {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(imageVector = ZarvisIcons.X, contentDescription = tr(UiString.COMMON_CLEAR_SEARCH))
                }
            }
        } else {
            null
        },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
        colors = zarvisFieldColors(),
    )
}

/**
 * The Home/Conversation composer — text input with an inline mic toggle, per
 * MASTER_SPEC.md §11 "text input must also remain available" and the Home screen concept in
 * §22 (`[ 🎙 Speak ]` next to `[ Type your task ]`). Gains a soft glow in the theme's primary colour the
 * instant it's focused (§22 "Floating Command Bar with glowing neon border on focus") — driven purely by
 * [collectIsFocusedAsState], so it reacts the same frame as the keyboard opens with no perceptible delay.
 *
 * The focus ring is the theme's primary (4.4:1 or better on both pages; the old cyan was 1.7:1 on the light one), the field sits on the
 * raised card colour, and the mic and send buttons are named in the app's language for TalkBack. Where the screen shows its own
 * microphone ([showMic] false, Chat's orb), [leading] can put another small control at the start of the field instead.
 */
@Composable
fun ZarvisComposer(
    value: String,
    onValueChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onMicClick: () -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Ask ZARVIS anything…",
    enabled: Boolean = true,
    showMic: Boolean = true,
    leading: (@Composable () -> Unit)? = null,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isFocused by interactionSource.collectIsFocusedAsState()
    val glowAlpha by animateFloatAsState(targetValue = if (isFocused) 0.32f else 0f, label = "composer-glow")
    val cornerRadius = 28.dp
    val accent = MaterialTheme.colorScheme.primary

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
        colors = zarvisFieldColors(),
        placeholder = { Text(placeholder) },
        // Chat shows its own orb next to the field as the microphone, so the field drops its mic there ([showMic] false).
        leadingIcon = if (showMic) {
            {
                IconButton(onClick = onMicClick, enabled = enabled) {
                    Icon(imageVector = Icons.Filled.Mic, contentDescription = tr(UiString.A11Y_SPEAK))
                }
            }
        } else {
            leading
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
