package com.zarvismobile.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.heightIn
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

/**
 * The main action: white text on the blue → violet → pink action gradient (the website's `--grad`, at least 4.5:1 at every stop),
 * in both themes. Disabled, it falls back to Material's flat disabled colours, so it never looks pressable when it is not.
 * The ripple is clipped to the same shape as the gradient.
 */
@Composable
fun ZarvisPrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val shape = MaterialTheme.shapes.medium
    // 48dp tall, so Material does not pad the button out to the touch target and the gradient covers exactly the pressable area.
    val sized = modifier.heightIn(min = 48.dp)
    Button(
        onClick = onClick,
        modifier = if (enabled) sized.background(zarvisActionBrush(), shape) else sized,
        enabled = enabled,
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 11.dp),
        shape = shape,
        colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent, contentColor = Color.White),
    ) { Text(text) }
}

@Composable
fun ZarvisSecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    OutlinedButton(
        onClick = onClick, modifier = modifier, enabled = enabled,
        shape = MaterialTheme.shapes.medium,
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 10.dp),
    ) { Text(text) }
}

@Composable
fun ZarvisGhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    androidx.compose.material3.TextButton(onClick = onClick, modifier = modifier, enabled = enabled) { Text(text) }
}

@Composable
fun ZarvisDestructiveButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Button(
        onClick = onClick, modifier = modifier, enabled = enabled,
        shape = MaterialTheme.shapes.medium,
        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
    ) { Text(text) }
}
