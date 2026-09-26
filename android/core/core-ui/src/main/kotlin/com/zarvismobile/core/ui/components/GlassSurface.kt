package com.zarvismobile.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisSpacing

/** Bright translucent surface used for cards, panels, nav and dialogs. */
@Composable
fun GlassSurface(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(24.dp),
    borderColor: Color = GlassColors.border,
    tint: Color = GlassColors.surfaceTint,
    contentPadding: Dp = ZarvisSpacing.md,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .background(color = tint, shape = shape)
            .border(width = 1.dp, color = borderColor, shape = shape)
            .padding(contentPadding),
        content = content,
    )
}
