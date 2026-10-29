package com.zarvismobile.core.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisCorners
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.core.ui.theme.zarvisReduceMotion

/**
 * A compact glass-pill category chip — used for the Workspace screen's category rail
 * (MASTER_SPEC.md §22: Web, Documents, Developer, Business, Creative, Automation, Research).
 * 44dp tall (the website's chip height) so it is an easy thumb target, and announced as a button. Queen Pro look: a glass pill
 * with a hairline and an icon in the theme's primary (periwinkle at night, royal purple by day). Pass `onClick = null` for a chip that only
 * shows information (a count, a status): it is then not clickable and not announced as a button.
 */
@Composable
fun ZarvisChip(
    label: String,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
) {
    val shape = ZarvisCorners.pill
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .heightIn(min = 44.dp)
            .clip(shape)
            .background(GlassColors.surfaceTint.copy(alpha = 0.6f), shape)
            .border(width = 1.dp, color = ZarvisAccents.primary.copy(alpha = if (onClick != null) 0.35f else 0.2f), shape = shape)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = ZarvisSpacing.md, vertical = 8.dp),
    ) {
        if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = ZarvisAccents.primary,
                modifier = Modifier.size(18.dp),
            )
            Spacer(modifier = Modifier.size(ZarvisSpacing.sm))
        }
        Text(text = label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurface)
    }
}

/**
 * One choice of a set (a filter): a pill that is filled with the theme's primary while chosen (its ink is 4.5:1 or more on it) and
 * outlined otherwise, 44dp tall. One choice at a time, so TalkBack reads it as a radio button and whether it is selected; put the
 * chips in a [Modifier.selectableGroup].
 */
@Composable
fun ZarvisFilterChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
) {
    val shape = ZarvisCorners.pill
    val ink = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .heightIn(min = 44.dp)
            .clip(shape)
            .then(
                if (selected) {
                    Modifier.background(MaterialTheme.colorScheme.primary, shape)
                } else {
                    Modifier.background(GlassColors.surfaceTint.copy(alpha = 0.6f), shape).border(1.dp, MaterialTheme.colorScheme.outline, shape)
                },
            )
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = ZarvisSpacing.md, vertical = 10.dp),
    ) {
        if (icon != null) {
            Icon(imageVector = icon, contentDescription = null, tint = ink, modifier = Modifier.size(16.dp))
            Spacer(modifier = Modifier.size(6.dp))
        }
        Text(text = label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = ink)
    }
}

/**
 * Two or three choices across the page (Monthly / Yearly): a glass track with the chosen segment filled with the theme's primary.
 * Each segment is a tab that says whether it is selected, and an equal share of the track, at least 44dp tall.
 */
@Composable
fun ZarvisSegmentedControl(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = ZarvisCorners.pill
    val still = zarvisReduceMotion()
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(GlassColors.surfaceTint, shape)
            .border(1.dp, GlassColors.border, shape)
            .padding(4.dp)
            .selectableGroup(),
    ) {
        options.forEachIndexed { index, label ->
            val selected = index == selectedIndex
            val fill by animateColorAsState(
                if (selected) MaterialTheme.colorScheme.primary else Color.Transparent,
                animationSpec = if (still) snap() else spring(),
                label = "segment-fill",
            )
            Box(
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 44.dp)
                    .clip(shape)
                    .background(fill, shape)
                    .selectable(selected = selected, role = Role.Tab, onClick = { onSelect(index) })
                    .padding(horizontal = ZarvisSpacing.sm, vertical = 11.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
