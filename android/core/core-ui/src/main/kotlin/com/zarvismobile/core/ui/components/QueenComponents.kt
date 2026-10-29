@file:OptIn(ExperimentalTextApi::class, ExperimentalLayoutApi::class)

package com.zarvismobile.core.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.LocalZarvisExtras
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisAccentViolet
import com.zarvismobile.core.ui.theme.ZarvisActionEnd
import com.zarvismobile.core.ui.theme.ZarvisActionMid
import com.zarvismobile.core.ui.theme.ZarvisActionStart
import com.zarvismobile.core.ui.theme.ZarvisFontFamily
import com.zarvismobile.core.ui.theme.ZarvisProStyles
import com.zarvismobile.core.ui.theme.ZarvisGold
import com.zarvismobile.core.ui.theme.ZarvisGoldPale
import com.zarvismobile.core.ui.theme.ZarvisNightLavender
import com.zarvismobile.core.ui.theme.ZarvisOrchid
import com.zarvismobile.core.ui.theme.ZarvisRose
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.core.ui.theme.zarvisAuroraBrush
import com.zarvismobile.core.ui.theme.zarvisReduceMotion

/*
 * The Queen theme's shared pieces (ANDROID_QUEEN_DESIGN.md): the crown, gold lettering, the small section label, jewel icon
 * tiles, the loading skeleton, and the empty and error states. Everything that moves reads its animation while drawing (or in its
 * layer), never while composing, and holds still when animations are off or Lightweight mode is on.
 */

// ---- The crown ----------------------------------------------------------------------------------

/**
 * The gold crown with three jewels (ruby, amethyst, emerald) and pearl tips, drawn from the design's 80×54 drawing. It bobs and
 * sways gently unless motion is off. Decoration only: it has no words for TalkBack.
 */
@Composable
fun QueenCrown(modifier: Modifier = Modifier, width: Dp = 70.dp) {
    val still = zarvisReduceMotion()
    val bob: State<Float>? = if (still) {
        null
    } else {
        rememberInfiniteTransition(label = "crown").animateFloat(
            initialValue = -1f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(durationMillis = 1800, easing = FastOutSlowInEasing), RepeatMode.Reverse),
            label = "crown-bob",
        )
    }
    val outline = remember {
        Path().apply {
            moveTo(7f, 44f); lineTo(3f, 14f); lineTo(22f, 29f); lineTo(40f, 6f)
            lineTo(58f, 29f); lineTo(77f, 14f); lineTo(73f, 44f); close()
        }
    }
    val height = width * (54f / 80f)
    Canvas(
        modifier = modifier
            .size(width = width, height = height)
            .graphicsLayer {
                val b = bob?.value ?: 0f
                translationY = -3.dp.toPx() * (b + 1f)
                rotationZ = 3f * b
            },
    ) {
        // A soft gold glow behind the crown.
        drawCircle(
            brush = Brush.radialGradient(listOf(ZarvisGold.copy(alpha = 0.45f), Color.Transparent), center = center, radius = size.width * 0.62f),
            radius = size.width * 0.62f,
        )
        scale(size.width / 80f, size.width / 80f, pivot = Offset.Zero) {
            drawPath(outline, Brush.verticalGradient(0f to Color(0xFFFFF3C4), 0.45f to ZarvisGold, 1f to Color(0xFFB45309), startY = 6f, endY = 51f))
            drawPath(outline, CrownLine, style = Stroke(width = 1.2f))
            drawRoundRect(Color(0xFFD97706), topLeft = Offset(6f, 42f), size = Size(68f, 9f), cornerRadius = CornerRadius(3f))
            drawRoundRect(CrownLine, topLeft = Offset(6f, 42f), size = Size(68f, 9f), cornerRadius = CornerRadius(3f), style = Stroke(width = 1f))
            drawCircle(CrownLine, radius = 3.4f, center = Offset(3f, 13f))
            drawCircle(CrownLine, radius = 4f, center = Offset(40f, 5f))
            drawCircle(CrownLine, radius = 3.4f, center = Offset(77f, 13f))
            drawCircle(ZarvisRose, radius = 3.2f, center = Offset(22f, 34f))
            drawCircle(Color(0xFFC084FC), radius = 4.4f, center = Offset(40f, 27f))
            drawCircle(Color(0xFF34D399), radius = 3.2f, center = Offset(58f, 34f))
        }
    }
}

private val CrownLine = Color(0xFFFFF7D6)

// ---- Gold lettering -----------------------------------------------------------------------------

/**
 * Text filled with gold (Queen Night) or with the violet → indigo → blue ink (Queen Light, where gold would be unreadable), with
 * a soft shine passing over it every few seconds. Every colour in both fills is at least 4.5:1 on its page.
 */
@Composable
fun GoldText(text: String, style: TextStyle, modifier: Modifier = Modifier, textAlign: TextAlign? = null) {
    val dark = LocalZarvisExtras.current.isDark
    val fill = if (dark) {
        listOf(ZarvisGoldPale, ZarvisGold, Color(0xFFFFF7D6), ZarvisOrchid, ZarvisGoldPale)
    } else {
        listOf(ZarvisActionStart, ZarvisActionMid, ZarvisActionEnd)
    }
    val still = zarvisReduceMotion()
    val shine: State<Float>? = if (still) {
        null
    } else {
        rememberInfiniteTransition(label = "gold-text").animateFloat(
            initialValue = -0.6f,
            targetValue = 2.4f,
            animationSpec = infiniteRepeatable(tween(durationMillis = 5200, easing = LinearEasing)),
            label = "gold-text-shine",
        )
    }
    val glint = Color.White.copy(alpha = if (dark) 0.6f else 0.35f)
    Text(
        text = text,
        style = style.merge(TextStyle(brush = Brush.linearGradient(fill))),
        textAlign = textAlign,
        modifier = modifier
            .graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)
            .drawWithContent {
                drawContent()
                val at = shine?.value ?: return@drawWithContent
                val x = at * size.width
                drawRect(
                    brush = Brush.linearGradient(
                        listOf(Color.Transparent, glint, Color.Transparent),
                        start = Offset(x - size.width * 0.25f, 0f),
                        end = Offset(x, size.height),
                    ),
                    blendMode = BlendMode.SrcAtop,
                )
            },
    )
}

// ---- Section label ------------------------------------------------------------------------------

/**
 * The small label over a section ("RECENT TASKS"): Sora 12/16, uppercase, spaced, in the theme's primary (periwinkle at night, royal
 * purple by day), and (unless [isHeading] is false, for a tagline) a heading for TalkBack. Hindi has no capitals and must not be letter-spaced (it breaks the joined letters), so Hindi
 * text stays unspaced at a readable size.
 */
@Composable
fun SectionKicker(text: String, modifier: Modifier = Modifier, isHeading: Boolean = true) {
    val latin = text.all { it.code < 0x0900 }
    val style = if (latin) ZarvisProStyles.sectionLabel else TextStyle(fontFamily = ZarvisFontFamily, fontWeight = FontWeight.Bold, fontSize = 13.sp, lineHeight = 18.sp)
    Text(
        text = if (latin) text.uppercase() else text,
        style = style,
        color = ZarvisAccents.primary,
        modifier = if (isHeading) modifier.semantics { heading() } else modifier,
    )
}

// ---- Jewel icon tiles ---------------------------------------------------------------------------

/** The jewel colours for icon tiles: a pale top, the jewel below, and a dark ink for the icon that is over 4.5:1 on both. */
enum class Jewel(val top: Color, val bottom: Color, val ink: Color) {
    AMETHYST(Color(0xFFF3E8FF), Color(0xFFC084FC), Color(0xFF2E1065)),
    RUBY(Color(0xFFFFE4E6), Color(0xFFFB7185), Color(0xFF4C0519)),
    EMERALD(Color(0xFFD1FAE5), Color(0xFF34D399), Color(0xFF022C22)),
    GOLD(Color(0xFFFEF9C3), Color(0xFFFBBF24), Color(0xFF422006)),
    SAPPHIRE(Color(0xFFCFFAFE), Color(0xFF22D3EE), Color(0xFF083344)),
    ORCHID(Color(0xFFFCE7F3), Color(0xFFF472B6), Color(0xFF500724)),
}

/** A rounded jewel tile with an icon on it. Decoration next to a label, so the icon has no words of its own. */
@Composable
fun JewelIcon(icon: ImageVector, jewel: Jewel, modifier: Modifier = Modifier, size: Dp = 40.dp) {
    Box(
        modifier = modifier
            .size(size)
            .background(Brush.verticalGradient(listOf(jewel.top, jewel.bottom)), RoundedCornerShape(size * 0.3f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(imageVector = icon, contentDescription = null, tint = jewel.ink, modifier = Modifier.size(size * 0.5f))
    }
}

// ---- Loading skeleton ---------------------------------------------------------------------------

/** One placeholder block with a soft lavender shimmer sweeping across it while content loads. */
@Composable
fun SkeletonBlock(modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(12.dp)) {
    val dark = LocalZarvisExtras.current.isDark
    val base = if (dark) Color.White.copy(alpha = 0.07f) else ZarvisActionStart.copy(alpha = 0.07f)
    val band = if (dark) ZarvisNightLavender.copy(alpha = 0.2f) else ZarvisAccentViolet.copy(alpha = 0.16f)
    val still = zarvisReduceMotion()
    val sweep: State<Float>? = if (still) {
        null
    } else {
        rememberInfiniteTransition(label = "skeleton").animateFloat(
            initialValue = -1f,
            targetValue = 2f,
            animationSpec = infiniteRepeatable(tween(durationMillis = 1300, easing = LinearEasing)),
            label = "skeleton-sweep",
        )
    }
    Box(
        modifier = modifier
            .background(base, shape)
            .drawBehind {
                val at = sweep?.value ?: return@drawBehind
                val x = at * size.width
                drawRect(
                    Brush.horizontalGradient(listOf(Color.Transparent, band, Color.Transparent), startX = x - size.width * 0.4f, endX = x + size.width * 0.4f),
                )
            },
    )
}

/**
 * The loading state of a list: [rows] glass cards of skeleton lines in the shape of the content, announced once as "Loading…"
 * ([loadingLabel]). Never an empty spinner.
 */
@Composable
fun SkeletonList(loadingLabel: String, modifier: Modifier = Modifier, rows: Int = 3) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
    ) {
        repeat(rows) { index ->
            GlassSurface(Modifier.fillMaxWidth()) {
                SkeletonBlock(Modifier.fillMaxWidth(if (index % 2 == 0) 0.6f else 0.5f).height(18.dp))
                SkeletonBlock(Modifier.padding(top = 10.dp).fillMaxWidth(if (index % 2 == 0) 0.4f else 0.7f).height(12.dp))
                if (index == 0) {
                    SkeletonBlock(Modifier.padding(top = 14.dp).fillMaxWidth().height(6.dp), RoundedCornerShape(3.dp))
                }
            }
        }
    }
}

// ---- Empty and error states ---------------------------------------------------------------------

/** An empty list: the still ZARVIS orb, what is missing, and (when there is one) the one thing to do about it. */
@Composable
fun QueenEmptyState(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = ZarvisSpacing.lg, vertical = ZarvisSpacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
    ) {
        AiOrb(state = VoiceState.IDLE, onClick = null, size = 88.dp)
        Text(
            text = title,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.ExtraBold,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = ZarvisSpacing.sm),
        )
        Text(text = body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (actionLabel != null && onAction != null) {
            ZarvisPrimaryButton(text = actionLabel, onClick = onAction, modifier = Modifier.padding(top = ZarvisSpacing.sm))
        }
    }
}

/**
 * Something failed to load: a card with a rose edge that says what failed in plain words, with Try again right there. A polite live
 * region, so TalkBack reads the failure when the card appears instead of leaving it to be found.
 */
@Composable
fun QueenErrorCard(message: String, retryLabel: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .semantics { liveRegion = LiveRegionMode.Polite }
            .background(GlassColors.surfaceTint, shape)
            .border(1.dp, ZarvisAccents.danger.copy(alpha = 0.45f), shape)
            .padding(ZarvisSpacing.md),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Icon(imageVector = ZarvisIcons.Alert, contentDescription = null, tint = ZarvisAccents.danger, modifier = Modifier.padding(top = 1.dp).size(20.dp))
            Text(message, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        }
        QueenOutlineAction(label = retryLabel, icon = ZarvisIcons.Refresh, onClick = onRetry)
    }
}

/** A small outlined pill in the theme's primary, with an icon: Try again, Choose apps, Read aloud, Stop. */
@Composable
fun QueenOutlineAction(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null) {
    val shape = RoundedCornerShape(50)
    Row(
        modifier = modifier
            .heightIn(min = 48.dp)
            .clip(shape)
            .border(1.dp, ZarvisAccents.primary.copy(alpha = 0.55f), shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (icon != null) Icon(imageVector = icon, contentDescription = null, tint = ZarvisAccents.primary, modifier = Modifier.size(16.dp))
        Text(text = label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = ZarvisAccents.primary)
    }
}

/** A thin gold divider between rows inside a glass card, indented past the row's icon. */
@Composable
fun GoldDivider(modifier: Modifier = Modifier, indent: Dp = 66.dp) {
    Box(
        modifier = modifier
            .padding(start = indent)
            .fillMaxWidth()
            .height(1.dp)
            .background(ZarvisAccents.gold.copy(alpha = 0.16f)),
    )
}

// ---- Page header --------------------------------------------------------------------------------

/** Back: a 48dp round button with an arrow. TalkBack reads [label] ("Back"). */
@Composable
fun QueenBackButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(48.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.06f), CircleShape)
            .clickable(role = Role.Button, onClickLabel = null, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(imageVector = ZarvisIcons.Left, contentDescription = null, tint = MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(22.dp))
    }
}

/**
 * The top of every page (Queen Pro): Back (when there is somewhere to go back to) next to the title, one line on what the page is
 * for, then the page's [actions] (chips, small buttons) wrapping under it. A tab's own page has no Back and a larger title (28/34);
 * a page opened from somewhere has Back and the app-bar title (22/28). The title is the page's heading for TalkBack.
 */
@Composable
fun QueenPageHeader(
    title: String,
    subtitle: String?,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    backLabel: String = "Back",
    actions: (@Composable () -> Unit)? = null,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm), verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) QueenBackButton(label = backLabel, onClick = onBack, modifier = Modifier.padding(end = ZarvisSpacing.xs))
            Text(
                text = title,
                style = if (onBack != null) ZarvisProStyles.barTitle else ZarvisProStyles.pageTitle,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
        }
        if (subtitle != null) {
            Text(text = subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (actions != null) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
                verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
            ) { actions() }
        }
    }
}

// ---- Sections, cards and rows (Queen Pro) --------------------------------------------------------

/**
 * A group on a page: the [title] label (a heading), an optional one-line [hint] under it, then [content] (usually a [QueenListCard]).
 */
@Composable
fun QueenSection(title: String, modifier: Modifier = Modifier, hint: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
        SectionKicker(text = title, modifier = Modifier.padding(top = ZarvisSpacing.sm))
        if (hint != null) {
            Text(text = hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        content()
    }
}

/** One card holding a list of [QueenRow]s, separated by hairlines ([QueenRowDivider]). No inner padding: the rows bring their own. */
@Composable
fun QueenListCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .glassFill(GlassColors.surfaceTint, GlassColors.highlight, shape)
            .border(1.dp, GlassColors.border, shape),
        content = content,
    )
}

/** The hairline between two rows of a [QueenListCard]. */
@Composable
fun QueenRowDivider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(GlassColors.border.copy(alpha = 0.7f)))
}

/** A 36dp rounded tile with an icon in [tint] on a 12% wash of it. Decoration next to a label, so it has no words of its own. */
@Composable
fun QueenIconTile(icon: ImageVector, tint: Color, modifier: Modifier = Modifier, size: Dp = 36.dp) {
    Box(
        modifier = modifier.size(size).background(tint.copy(alpha = 0.12f), RoundedCornerShape(size * 0.28f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(imageVector = icon, contentDescription = null, tint = tint, modifier = Modifier.size(size * 0.56f))
    }
}

/**
 * One row (Queen Pro): an optional icon tile, the [title] and one line of [detail], then [trailing] on the right (a switch, a chip,
 * a button). At least 64dp tall. With [onClick] the whole row is one button and shows a chevron after [trailing].
 */
@Composable
fun QueenRow(
    title: String,
    modifier: Modifier = Modifier,
    detail: String? = null,
    icon: ImageVector? = null,
    iconTint: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    below: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val tap = if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier
    Row(
        modifier = modifier.fillMaxWidth().heightIn(min = 64.dp).then(tap).padding(horizontal = ZarvisSpacing.md, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) QueenIconTile(icon = icon, tint = iconTint)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(text = title, style = ZarvisProStyles.rowTitle, color = MaterialTheme.colorScheme.onSurface)
            if (detail != null) {
                Text(text = detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (below != null) below()
        }
        if (trailing != null) trailing()
        if (onClick != null) {
            Icon(imageVector = ZarvisIcons.Right, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        }
    }
}

/** A short note in a soft wash of the theme's primary (or [tint]) with an icon: what a setting means, a safety promise. */
@Composable
fun QueenNote(text: String, modifier: Modifier = Modifier, icon: ImageVector = ZarvisIcons.Shield, tint: Color = ZarvisAccents.primary, title: String? = null) {
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier = modifier.fillMaxWidth().background(tint.copy(alpha = 0.08f), shape).padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(imageVector = icon, contentDescription = null, tint = tint, modifier = Modifier.padding(top = 1.dp).size(18.dp))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (title != null) Text(text = title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
            Text(text = text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Small print under a section (12/17 in the secondary text colour). */
@Composable
fun QueenFootnote(text: String, modifier: Modifier = Modifier) {
    Text(text = text, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp, lineHeight = 17.sp), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier)
}

// ---- Numbers ------------------------------------------------------------------------------------

/** One number on a card (Queen Pro): the value large (one line, so "1.2 s" never wraps) in [valueColor], and what it counts. */
@Composable
fun QueenStatTile(value: String, label: String, modifier: Modifier = Modifier, valueColor: Color = Color.Unspecified) {
    GlassSurface(modifier = modifier, contentPadding = 12.dp) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
            color = valueColor,
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Ellipsis,
        )
        Text(text = label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
    }
}

/** A thin meter filled with the night's lights up to [fraction] (0..1). Decoration: the number it shows is always written next to it. */
@Composable
fun GoldMeter(fraction: Float, modifier: Modifier = Modifier, height: Dp = 8.dp) {
    val filled = fraction.coerceIn(0f, 1f)
    val shape = RoundedCornerShape(50)
    Box(modifier = modifier.fillMaxWidth().height(height).background(ZarvisAccents.primary.copy(alpha = 0.16f), shape)) {
        if (filled > 0f) Box(Modifier.fillMaxWidth(filled).fillMaxHeight().background(zarvisAuroraBrush(), shape))
    }
}
