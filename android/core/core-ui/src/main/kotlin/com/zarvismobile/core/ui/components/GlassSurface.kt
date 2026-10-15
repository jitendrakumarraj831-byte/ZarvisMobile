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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisSpacing

/**
 * Premium glass surface shared by every feature page: a translucent tint and a hairline edge over the aurora page (white-ish in
 * light, periwinkle-ish in dark; see [GlassColors]). No blur and no shadow, so it draws as cheaply as a flat card.
 *
 * With [onClick] the whole surface is one button: the press ripple is clipped to its rounded corners and it announces itself as a button.
 */
@Composable
fun GlassSurface(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(20.dp),
    borderColor: Color = GlassColors.border,
    tint: Color = GlassColors.surfaceTint,
    contentPadding: Dp = ZarvisSpacing.md,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val tap = if (onClick != null) Modifier.clip(shape).clickable(role = Role.Button, onClick = onClick) else Modifier
    Column(
        modifier = modifier
            .background(tint, shape)
            .border(1.dp, borderColor, shape)
            .then(tap)
            .padding(contentPadding),
        content = content,
    )
}
