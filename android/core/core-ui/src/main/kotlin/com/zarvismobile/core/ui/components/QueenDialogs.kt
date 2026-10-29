package com.zarvismobile.core.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
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
import com.zarvismobile.core.ui.theme.ZarvisCorners
import com.zarvismobile.core.ui.theme.ZarvisSpacing

/** The Queen Pro dialog shape: 24dp corners and a hairline in the theme's primary (rose for one that deletes). */
val QueenDialogShape: RoundedCornerShape = ZarvisCorners.dialog

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

/**
 * A dialog that shows or picks something rather than asking a question (Excluded apps): the same shape, edge and buttons as
 * [QueenConfirmDialog], with [content] as its body. [confirmLabel] is the main pill; [dismissLabel], when given, an outlined one next
 * to it. Dismissing (outside tap, Back) calls [onDismiss].
 */
@Composable
fun QueenDialog(
    title: String,
    onDismiss: () -> Unit,
    confirmLabel: String,
    onConfirm: () -> Unit,
    modifier: Modifier = Modifier,
    dismissLabel: String? = null,
    icon: ImageVector? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val accent = ZarvisAccents.primary
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = modifier.border(1.dp, accent.copy(alpha = 0.45f), QueenDialogShape),
        shape = QueenDialogShape,
        icon = icon?.let { { QueenIconTile(icon = it, tint = accent, size = 52.dp) } },
        title = { Text(title, fontWeight = FontWeight.Bold) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm), content = content) },
        confirmButton = { ZarvisPrimaryButton(text = confirmLabel, onClick = onConfirm) },
        dismissButton = dismissLabel?.let { { ZarvisSecondaryButton(text = it, onClick = onDismiss) } },
    )
}
