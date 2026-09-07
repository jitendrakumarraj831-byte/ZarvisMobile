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

/**
 * Glassmorphism surface — the Compose translation of `backdrop-blur-2xl bg-white/[0.03]
 * border border-white/10 shadow-2xl` (MASTER_SPEC.md §22 "Zarvis Cyber Luxury"). True
 * backdrop blur needs a render-effect library this repo doesn't depend on, so this uses a
 * tinted overlay + hairline border instead — the same layered, translucent look without a
 * new dependency.
 */
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
