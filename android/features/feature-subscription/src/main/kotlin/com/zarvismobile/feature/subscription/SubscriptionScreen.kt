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
import androidx.compose.material3.Icon
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.QueenErrorCard
import com.zarvismobile.core.ui.components.QueenNote
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
import com.zarvismobile.core.ui.theme.ZarvisGoldPale
import com.zarvismobile.core.ui.theme.ZarvisInkOnGold
import com.zarvismobile.core.ui.theme.ZarvisSpacing
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
    val highlighted: Boolean,
)

private val FREE_TIER = PlanTier(
    code = "FREE",
    tagline = UiString.PLANS_FREE_TAGLINE,
    features = listOf(UiString.PLANS_FREE_1, UiString.PLANS_FREE_2, UiString.PLANS_FREE_3),
    highlighted = false,
)

private val PRO_TIER = PlanTier(
    code = "PRO",
    tagline = UiString.PLANS_PRO_TAGLINE,
    features = listOf(UiString.PLANS_PRO_1, UiString.PLANS_PRO_2, UiString.PLANS_PRO_3),
    highlighted = true,
)

/**
 * Plans & credits — MASTER_SPEC.md §19-21 (Subscription/Trial/Usage), Queen Pro board 12: the current plan with the credits left,
 * Monthly / Yearly, then Free and Pro in words. Nothing can be bought here yet: the Pro card's button says "coming soon" and is off,
 * and a note says why.
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
            contentPadding = PaddingValues(ZarvisSpacing.md),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                QueenPageHeader(
                    title = tr(UiString.WORK_PLANS_TITLE),
                    subtitle = tr(UiString.PLANS_SUBTITLE),
                    onBack = onBack,
                    backLabel = tr(UiString.COMMON_BACK),
                )
            }

            val entitlement = uiState.entitlement
            // Also above a plan shown before: the credits under it are the last ones read, not presented as current.
            if (uiState.failed) {
                item { QueenErrorCard(message = tr(UiString.PLANS_ERROR), retryLabel = tr(UiString.COMMON_TRY_AGAIN), onRetry = viewModel::refresh) }
            }
            when {
                entitlement != null -> item { CurrentPlanCard(entitlement) }
                uiState.isLoading -> item { SkeletonList(loadingLabel = tr(UiString.COMMON_LOADING), rows = 1) }
            }

            item { BillingToggle(yearly = billedYearly, onToggle = { billedYearly = it }) }

            item { PlanCard(plan = FREE_TIER, isCurrent = entitlement?.plan == FREE_TIER.code) }
            item {
                PlanCard(
                    plan = PRO_TIER,
                    isCurrent = entitlement?.plan == PRO_TIER.code,
                    billingNote = tr(if (billedYearly) UiString.PLANS_BILLED_YEARLY else UiString.PLANS_BILLED_MONTHLY),
                )
            }

            item { QueenNote(title = tr(UiString.PLANS_UPGRADE_TITLE), text = tr(UiString.PLANS_UPGRADE_BODY), icon = ZarvisIcons.Card) }

            item { Spacer(modifier = Modifier.size(ZarvisSpacing.xxl)) }
        }
    }
}

/** The plan the account is on: its name, the credits left large in gold, and when a trial ends. */
@Composable
private fun CurrentPlanCard(entitlement: EntitlementSnapshotResponse) {
    val locale = LocalAppLocale.current
    GlassSurface(
        modifier = Modifier.fillMaxWidth(),
        tint = GlassColors.surfaceTintElevated,
        borderColor = ZarvisAccents.gold.copy(alpha = 0.30f),
    ) {
        SectionKicker(text = tr(UiString.PLANS_CURRENT))
        Row(modifier = Modifier.fillMaxWidth().padding(top = ZarvisSpacing.xs), verticalAlignment = Alignment.Bottom) {
            Text(
                text = StatusLabels.humanize(entitlement.plan),
                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
                modifier = Modifier.weight(1f),
            )
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = entitlement.creditBalance.toString(),
                    style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
                    color = ZarvisAccents.gold,
                )
                Text(text = tr(UiString.PLANS_CREDITS_LEFT), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        entitlement.trialExpiresAt?.let { ends ->
            StatusBadge(
                label = trf(UiString.PLANS_TRIAL_ENDS, readableDate(ends, locale)),
                tone = StatusTone.WAITING,
                modifier = Modifier.padding(top = ZarvisSpacing.sm),
            )
        }
    }
}

/** Monthly / Yearly as two tabs across the page; the chosen one is gold with dark ink (over 8:1). */
@Composable
private fun BillingToggle(yearly: Boolean, onToggle: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(color = GlassColors.surfaceTint, shape = RoundedCornerShape(50))
            .border(width = 1.dp, color = GlassColors.border, shape = RoundedCornerShape(50))
            .padding(4.dp)
            .selectableGroup(),
    ) {
        BillingToggleOption(label = tr(UiString.PLANS_MONTHLY), selected = !yearly, onClick = { onToggle(false) }, modifier = Modifier.weight(1f))
        BillingToggleOption(label = tr(UiString.PLANS_YEARLY), selected = yearly, onClick = { onToggle(true) }, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun BillingToggleOption(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(50)
    Box(
        modifier = modifier
            .heightIn(min = 44.dp)
            .clip(shape)
            .then(if (selected) Modifier.background(ZarvisGoldPale, shape) else Modifier)
            .selectable(selected = selected, role = Role.Tab, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            color = if (selected) ZarvisInkOnGold else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * One plan: its name, what it is for, a green tick before each thing it includes. Pro is edged in gold and carries the Upgrade button,
 * which is off until purchases are switched on.
 */
@Composable
private fun PlanCard(plan: PlanTier, isCurrent: Boolean, billingNote: String? = null) {
    GlassSurface(
        modifier = Modifier.fillMaxWidth(),
        borderColor = if (plan.highlighted) ZarvisAccents.gold.copy(alpha = 0.40f) else GlassColors.border,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                Text(text = StatusLabels.humanize(plan.code), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                when {
                    isCurrent -> StatusBadge(label = tr(UiString.PLANS_YOUR_PLAN), tone = StatusTone.SUCCESS)
                    plan.highlighted -> StatusBadge(label = tr(UiString.PLANS_RECOMMENDED), tone = StatusTone.WAITING)
                }
            }
            Text(text = tr(plan.tagline), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            plan.features.forEach { feature ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(imageVector = ZarvisIcons.Check, contentDescription = null, tint = ZarvisAccents.success, modifier = Modifier.size(18.dp))
                    Text(text = tr(feature), style = MaterialTheme.typography.bodyMedium)
                }
            }
            billingNote?.let {
                Text(text = it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (plan.highlighted) {
                ZarvisSecondaryButton(
                    text = tr(UiString.PLANS_UPGRADE_BUTTON),
                    onClick = {},
                    enabled = false,
                    modifier = Modifier.fillMaxWidth(),
                )
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
