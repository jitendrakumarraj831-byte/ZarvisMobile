package com.zarvismobile.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisSpacing

/**
 * The card every feature page is built from (Queen Pro): a solid surface with a hairline edge and 16dp corners (white with a purple
 * hairline in light, navy with a periwinkle hairline in dark; see [GlassColors]) and a faint top-lit sheen ([glassFill]). No blur
 * and no shadow.
 *
 * With [onClick] the whole surface is one button: the press ripple is clipped to its rounded corners and it announces itself as a button.
 */
@Composable
fun GlassSurface(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(16.dp),
    borderColor: Color = GlassColors.border,
    tint: Color = GlassColors.surfaceTint,
    contentPadding: Dp = ZarvisSpacing.md,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val tap = if (onClick != null) Modifier.clip(shape).clickable(role = Role.Button, onClick = onClick) else Modifier
    Column(
        modifier = modifier
            .glassFill(tint, GlassColors.highlight, shape)
            .border(1.dp, borderColor, shape)
            .then(tap)
            .padding(contentPadding),
        content = content,
    )
}

/**
 * A card's fill: the solid [tint] with [highlight] (the theme's sheen) fading out over its upper half, so a card reads as glass lit
 * from above while its text sits on a solid colour (PaletteContrastTest checks text on the sheen too).
 */
fun Modifier.glassFill(tint: Color, highlight: Color, shape: Shape): Modifier =
    background(tint, shape).background(Brush.verticalGradient(0f to highlight, 0.55f to Color.Transparent), shape)
