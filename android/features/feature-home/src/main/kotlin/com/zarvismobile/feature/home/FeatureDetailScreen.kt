package com.zarvismobile.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.QueenListCard
import com.zarvismobile.core.ui.components.QueenPageHeader
import com.zarvismobile.core.ui.components.QueenRow
import com.zarvismobile.core.ui.components.QueenRowDivider
import com.zarvismobile.core.ui.components.QueenSection
import com.zarvismobile.core.ui.components.SectionKicker
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisChip
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.domain.entity.CapabilityStatus
import com.zarvismobile.domain.presentation.StatusTone
import com.zarvismobile.domain.presentation.UiString

/**
 * A product page (Queen Pro board 7 for the Phone Agent): what it is and how far each part works on this phone, things to say, then
 * what it does, how, what it can do (the Phone Agent's actions, each with what it needs), how to start, permissions and limits, and
 * one button that starts it. The Phone Agent's page also links to Phone action safety.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FeatureDetailScreen(
    featureId: String,
    onBack: () -> Unit,
    onStartChat: (prompt: String, listen: Boolean) -> Unit,
    onOpenDeveloper: () -> Unit,
    onOpenPhoneSafety: () -> Unit = {},
) {
    val feature = FeatureCatalog.find(featureId)
    ZarvisBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(ZarvisSpacing.md),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            if (feature == null) {
                QueenPageHeader(title = "ZARVIS", subtitle = "That capability is not available.", onBack = onBack, backLabel = tr(UiString.COMMON_BACK))
                return@Column
            }
            QueenPageHeader(title = feature.title, subtitle = feature.summary, onBack = onBack, backLabel = tr(UiString.COMMON_BACK))

            GlassSurface(modifier = Modifier.fillMaxWidth(), contentPadding = 0.dp) {
                SectionKicker(feature.category, isHeading = false, modifier = Modifier.padding(start = ZarvisSpacing.md, top = 14.dp))
                feature.statuses.forEach { line ->
                    QueenRow(
                        title = line.name,
                        detail = line.state.note,
                        trailing = { StatusBadge(label = statusLabel(line.state.status), tone = toneOf(line.state.status)) },
                    )
                }
                if (feature.id == "phone") {
                    QueenRow(
                        title = tr(UiString.SETTINGS_PAGE_PHONE_SAFETY),
                        detail = tr(UiString.HOME_PHONE_SAFETY_SHORT),
                        icon = ZarvisIcons.Shield,
                        iconTint = ZarvisAccents.gold,
                        onClick = onOpenPhoneSafety,
                    )
                }
            }

            if (feature.examples.isNotEmpty()) {
                QueenSection(title = "Try saying") {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm), verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                        feature.examples.forEach { example -> ZarvisChip(label = example, onClick = { onStartChat(example, false) }) }
                    }
                }
            }

            if (feature.phoneActions.isNotEmpty()) {
                QueenSection(title = "What it can do") {
                    QueenListCard {
                        feature.phoneActions.forEachIndexed { index, action ->
                            if (index > 0) QueenRowDivider()
                            QueenRow(
                                title = action.title,
                                detail = "${action.description} Say: “${action.example}”",
                                trailing = { action.state.note?.let { StatusBadge(label = it, tone = StatusTone.NEUTRAL) } },
                                below = {
                                    Text(action.permission, style = MaterialTheme.typography.labelMedium, color = ZarvisAccents.gold)
                                },
                            )
                        }
                    }
                }
            } else if (feature.canDo.isNotEmpty()) {
                QueenSection(title = "What it can do") { Bullets(feature.canDo) }
            }

            QueenSection(title = "What it does") { Body(feature.what) }
            QueenSection(title = "Why it is useful") { Body(feature.why) }
            QueenSection(title = "How it works") {
                feature.how.forEachIndexed { index, step -> Body("${index + 1}. $step") }
            }
            QueenSection(title = "How to start") { Body(feature.start) }
            QueenSection(title = "Permissions") { Body(feature.permissions) }
            QueenSection(title = "Limitations") { Bullets(feature.limits) }

            ZarvisPrimaryButton(
                text = feature.cta,
                onClick = {
                    when (feature.action) {
                        "developer" -> onOpenDeveloper()
                        "voice" -> onStartChat("", true)
                        else -> onStartChat(feature.prompt, false)
                    }
                },
                modifier = Modifier.fillMaxWidth().padding(top = ZarvisSpacing.sm),
            )
        }
    }
}

@Composable
private fun Body(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun Bullets(items: List<String>) {
    items.forEach { Body("• $it") }
}

/** Partial is "works, not yet verified on a phone" (cyan); Planned and Unsupported are quiet; Working is green. */
private fun toneOf(status: CapabilityStatus): StatusTone = when (status) {
    CapabilityStatus.WORKING -> StatusTone.SUCCESS
    CapabilityStatus.PARTIAL -> StatusTone.ACTIVE
    CapabilityStatus.PLANNED, CapabilityStatus.UNSUPPORTED -> StatusTone.NEUTRAL
}
