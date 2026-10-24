package com.zarvismobile.core.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.zarvisActionBrush

/** Queen Pro buttons are pills. */
private val PillShape = RoundedCornerShape(50)

/**
 * The main action, one per screen: white text on the purple → rose → amber action gradient (at least 4.5:1 at every stop), in both
 * themes. Disabled, it falls back to Material's flat disabled colours, so it never looks pressable when it is not.
 * The ripple is clipped to the same shape as the gradient.
 */
@Composable
fun ZarvisPrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    // 48dp tall, so Material does not pad the button out to the touch target and the gradient covers exactly the pressable area.
    val sized = modifier.heightIn(min = 48.dp)
    Button(
        onClick = onClick,
        modifier = if (enabled) sized.background(zarvisActionBrush(), PillShape) else sized,
        enabled = enabled,
        contentPadding = PaddingValues(horizontal = 22.dp, vertical = 11.dp),
        shape = PillShape,
        colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent, contentColor = Color.White),
    ) { Text(text) }
}

/** A second choice next to the main one: an outlined pill in the theme's text colour. */
@Composable
fun ZarvisSecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    OutlinedButton(
        onClick = onClick, modifier = modifier.heightIn(min = 48.dp), enabled = enabled,
        shape = PillShape,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (enabled) 0.45f else 0.2f)),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurface),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 10.dp),
    ) { Text(text) }
}

@Composable
fun ZarvisGhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    androidx.compose.material3.TextButton(onClick = onClick, modifier = modifier.heightIn(min = 48.dp), enabled = enabled) { Text(text) }
}

/**
 * Something that deletes or cannot be undone, on a page: an outlined pill in the theme's danger colour. It never acts by itself;
 * the caller asks first (a dialog with [ZarvisDangerButton] as its confirm).
 */
@Composable
fun ZarvisDestructiveButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val danger = MaterialTheme.colorScheme.error
    OutlinedButton(
        onClick = onClick, modifier = modifier.heightIn(min = 48.dp), enabled = enabled,
        shape = PillShape,
        border = BorderStroke(1.dp, danger.copy(alpha = if (enabled) 0.6f else 0.25f)),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = danger),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 10.dp),
    ) { Text(text) }
}

/** The confirm button of a dialog that deletes something: a filled pill in the danger colour. */
@Composable
fun ZarvisDangerButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Button(
        onClick = onClick, modifier = modifier.heightIn(min = 48.dp), enabled = enabled,
        shape = PillShape,
        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
        contentPadding = PaddingValues(horizontal = 22.dp, vertical = 11.dp),
    ) { Text(text) }
}
