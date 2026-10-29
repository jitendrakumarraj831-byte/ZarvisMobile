package com.zarvismobile.core.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.ZarvisAccents

/** The Queen Pro dialog shape: 24dp corners and a hairline in the theme's primary (rose for one that deletes). */
val QueenDialogShape = RoundedCornerShape(24.dp)

/**
 * A question before something happens (Queen Pro board 20): an icon in a tinted tile, the question, what exactly will happen, and two
 * pill buttons. [destructive] makes the confirm a filled danger pill and the edge rose; otherwise the confirm is the main gradient.
 * Dismissing (outside tap, Back) is the same as [dismissLabel].
 */
@Composable
fun QueenConfirmDialog(
    title: String,
    body: String,
    confirmLabel: String,
    dismissLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    destructive: Boolean = false,
    icon: ImageVector? = null,
) {
    val accent = if (destructive) ZarvisAccents.danger else ZarvisAccents.primary
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = modifier.border(1.dp, accent.copy(alpha = 0.45f), QueenDialogShape),
        shape = QueenDialogShape,
        icon = icon?.let { { QueenIconTile(icon = it, tint = accent, size = 52.dp) } },
        title = { Text(title, fontWeight = FontWeight.Bold) },
        text = { Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) },
        confirmButton = {
            if (destructive) {
                ZarvisDangerButton(text = confirmLabel, onClick = onConfirm)
            } else {
                ZarvisPrimaryButton(text = confirmLabel, onClick = onConfirm)
            }
        },
        dismissButton = { ZarvisSecondaryButton(text = dismissLabel, onClick = onDismiss) },
    )
}
