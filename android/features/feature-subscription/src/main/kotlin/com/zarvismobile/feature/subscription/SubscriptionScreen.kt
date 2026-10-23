package com.zarvismobile.feature.subscription

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.GoldText
import com.zarvismobile.core.ui.components.Jewel
import com.zarvismobile.core.ui.components.JewelIcon
import com.zarvismobile.core.ui.components.QueenCrown
import com.zarvismobile.core.ui.components.QueenErrorCard
import com.zarvismobile.core.ui.components.QueenPageHeader
import com.zarvismobile.core.ui.components.SectionKicker
import com.zarvismobile.core.ui.components.SkeletonList
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.i18n.LocalAppLocale
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.i18n.trf
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisGold
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.core.ui.theme.zarvisActionBrush
import com.zarvismobile.core.ui.theme.zarvisAuroraBrush
import com.zarvismobile.data.remote.dto.EntitlementSnapshotResponse
import com.zarvismobile.domain.presentation.StatusLabels
import com.zarvismobile.domain.presentation.StatusTone
import com.zarvismobile.domain.presentation.UiString
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private data class PlanTier(
    val code: String,
    val tagline: UiString,
    val features: List<UiString>,
    val icon: ImageVector,
    val jewel: Jewel,
    val highlighted: Boolean,
)

private val FREE_TIER = PlanTier(
    code = "FREE",
    tagline = UiString.PLANS_FREE_TAGLINE,
    features = listOf(UiString.PLANS_FREE_1, UiString.PLANS_FREE_2, UiString.PLANS_FREE_3),
    icon = ZarvisIcons.Bolt,
    jewel = Jewel.AMETHYST,
    highlighted = false,
)

private val PRO_TIER = PlanTier(
    code = "PRO",
    tagline = UiString.PLANS_PRO_TAGLINE,
    features = listOf(UiString.PLANS_PRO_1, UiString.PLANS_PRO_2, UiString.PLANS_PRO_3),
    icon = ZarvisIcons.Sparkle,
    jewel = Jewel.GOLD,
    highlighted = true,
)

/**
 * Plans & Quotas — MASTER_SPEC.md §19-21 (Subscription/Trial/Usage), in the Queen layout: the crowned current-plan card with the
 * credits left, then Free and Pro side by side in words. Nothing can be bought here yet, and the page says so.
 */
@Composable
fun SubscriptionScreen(onBack: (() -> Unit)? = null, viewModel: SubscriptionViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    var billedYearly by rememberSaveable { mutableStateOf(false) }
    // Read each time the page is shown, so credits spent in Chat (or a plan changed on the website) show up on return.
    LifecycleResumeEffect(Unit) {
        viewModel.refresh()
        onPauseOrDispose { }
    }

    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(ZarvisSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                QueenPageHeader(
                    title = tr(UiString.COMMON_PLANS_QUOTAS),
                    subtitle = tr(UiString.PLANS_SUBTITLE),
                    icon = ZarvisIcons.Plan,
                    jewel = Jewel.GOLD,
                    kicker = "ZARVIS",
                    onBack = onBack,
                    backLabel = tr(UiString.COMMON_BACK),
                )
            }

            val entitlement = uiState.entitlement
            when {
                entitlement != null -> item { CurrentPlanCard(entitlement) }
                uiState.failed -> item {
                    QueenErrorCard(message = tr(UiString.PLANS_ERROR), retryLabel = tr(UiString.COMMON_TRY_AGAIN), onRetry = viewModel::refresh)
                }
                uiState.isLoading -> item { SkeletonList(loadingLabel = tr(UiString.COMMON_LOADING), rows = 1) }
            }

            item {
                Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    BillingToggle(yearly = billedYearly, onToggle = { billedYearly = it })
                }
            }

            item { PlanCard(plan = FREE_TIER, isCurrent = entitlement?.plan == FREE_TIER.code) }
            item {
                PlanCard(
                    plan = PRO_TIER,
                    isCurrent = entitlement?.plan == PRO_TIER.code,
                    billingNote = tr(if (billedYearly) UiString.PLANS_BILLED_YEARLY else UiString.PLANS_BILLED_MONTHLY),
                )
            }

            item {
                GlassSurface(modifier = Modifier.fillMaxWidth(), contentPadding = 18.dp) {
                    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        JewelIcon(ZarvisIcons.Card, Jewel.SAPPHIRE)
                        Text(tr(UiString.PLANS_UPGRADE_TITLE), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                    }
                    Text(
                        text = tr(UiString.PLANS_UPGRADE_BODY),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = ZarvisSpacing.sm),
                    )
                    ZarvisSecondaryButton(
                        text = tr(UiString.PLANS_UPGRADE_BUTTON),
                        onClick = {},
                        enabled = false,
                        modifier = Modifier.fillMaxWidth().padding(top = ZarvisSpacing.sm),
                    )
                }
            }

            item { Spacer(modifier = Modifier.size(ZarvisSpacing.xxl)) }
        }
    }
}

/** The plan the account is on: the crown, the plan in gold lettering, the credits left large, and when a trial ends. */
@Composable
private fun CurrentPlanCard(entitlement: EntitlementSnapshotResponse) {
    val locale = LocalAppLocale.current
    val shape = RoundedCornerShape(26.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(GlassColors.surfaceTintElevated, shape)
            .background(Brush.linearGradient(listOf(ZarvisGold.copy(alpha = 0.18f), Color.Transparent)), shape)
            .border(1.5.dp, zarvisAuroraBrush(), shape)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            QueenCrown(width = 60.dp)
            Column(modifier = Modifier.weight(1f)) {
                SectionKicker(text = tr(UiString.PLANS_CURRENT))
                GoldText(
                    text = StatusLabels.humanize(entitlement.plan),
                    style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
                )
            }
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
            Text(
                text = entitlement.creditBalance.toString(),
                style = MaterialTheme.typography.displaySmall.copy(fontWeight = FontWeight.ExtraBold),
            )
            Text(
                text = tr(UiString.PLANS_CREDITS_LEFT),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 6.dp),
            )
        }
        entitlement.trialExpiresAt?.let { ends ->
            StatusBadge(label = trf(UiString.PLANS_TRIAL_ENDS, readableDate(ends, locale)), tone = StatusTone.WAITING)
        }
    }
}

/** Monthly / Yearly as two tabs; the chosen one wears the action gradient (white on it is at least 4.5:1). */
@Composable
private fun BillingToggle(yearly: Boolean, onToggle: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .background(color = GlassColors.surfaceTintElevated, shape = RoundedCornerShape(50))
            .border(width = 1.dp, color = ZarvisAccents.gold.copy(alpha = 0.35f), shape = RoundedCornerShape(50))
            .padding(4.dp)
            .selectableGroup(),
    ) {
        BillingToggleOption(label = tr(UiString.PLANS_MONTHLY), selected = !yearly, onClick = { onToggle(false) })
        BillingToggleOption(label = tr(UiString.PLANS_YEARLY), selected = yearly, onClick = { onToggle(true) })
    }
}

@Composable
private fun BillingToggleOption(label: String, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Box(
        modifier = Modifier
            .heightIn(min = 44.dp)
            .clip(shape)
            .then(if (selected) Modifier.background(zarvisActionBrush(), shape) else Modifier)
            .selectable(selected = selected, role = Role.Tab, onClick = onClick)
            .padding(horizontal = 22.dp, vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            color = if (selected) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** One plan: its jewel and name, what it is for, a jewel tick before each thing it includes. Pro is edged with the jewels. */
@Composable
private fun PlanCard(plan: PlanTier, isCurrent: Boolean, billingNote: String? = null) {
    val shape = RoundedCornerShape(24.dp)
    val edge = if (plan.highlighted) {
        Modifier.border(width = 1.5.dp, brush = zarvisAuroraBrush(), shape = shape)
    } else {
        Modifier.border(width = 1.dp, color = GlassColors.border, shape = shape)
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(color = GlassColors.surfaceTint, shape = shape)
            .then(edge)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            JewelIcon(plan.icon, plan.jewel, size = 48.dp)
            Column(modifier = Modifier.weight(1f)) {
                Text(text = StatusLabels.humanize(plan.code), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                Text(text = tr(plan.tagline), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        when {
            isCurrent -> StatusBadge(label = tr(UiString.PLANS_YOUR_PLAN), tone = StatusTone.SUCCESS)
            plan.highlighted -> StatusBadge(label = tr(UiString.PLANS_RECOMMENDED), tone = StatusTone.WAITING)
        }
        billingNote?.let {
            Text(text = it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        plan.features.forEach { feature ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                JewelIcon(ZarvisIcons.Check, Jewel.EMERALD, size = 24.dp)
                Text(text = tr(feature), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/** The server's ISO time as a date in the app's language ("29 Oct 2026"); the raw text if it cannot be read. */
private fun readableDate(iso: String, locale: String): String = runCatching {
    val tag = if (locale.startsWith("hi")) "hi-IN" else "en-IN"
    DateTimeFormatter.ofPattern("d MMM yyyy", Locale.forLanguageTag(tag))
        .format(OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()))
}.getOrDefault(iso)
