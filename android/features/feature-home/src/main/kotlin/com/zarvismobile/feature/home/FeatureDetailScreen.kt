package com.zarvismobile.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.QueenExpandableRow
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
import com.zarvismobile.domain.presentation.StatusLabels
import com.zarvismobile.domain.presentation.StatusTone
import com.zarvismobile.domain.presentation.UiString

/**
 * A product page (Queen Pro board 7 for the Phone Agent): what it is and how far each part works on this phone, the one button that
 * starts it, things to say, what it can do (the Phone Agent's actions, each with what it needs), then the longer explanation (what it
 * does, why, how, how to start, permissions and limits) in rows that open in place, so the page is not a wall of text. The Phone
 * Agent's page also links to Phone action safety.
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
                        // The Skills tab's words for the same status, in the app's language.
                        trailing = { StatusBadge(label = tr(StatusLabels.capability(line.state.status)), tone = toneOf(line.state.status)) },
                    )
                }
                if (feature.id == "phone") {
                    QueenRow(
                        title = tr(UiString.SETTINGS_PAGE_PHONE_SAFETY),
                        detail = tr(UiString.HOME_PHONE_SAFETY_SHORT),
                        icon = ZarvisIcons.Shield,
                        iconTint = ZarvisAccents.primary,
                        onClick = onOpenPhoneSafety,
                    )
                }
            }

            // Right under its status, so starting it never needs a scroll to the bottom of the page.
            ZarvisPrimaryButton(
                text = feature.cta,
                onClick = {
                    when (feature.action) {
                        "developer" -> onOpenDeveloper()
                        "voice" -> onStartChat("", true)
                        else -> onStartChat(feature.prompt, false)
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )

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
                                    Text(action.permission, style = MaterialTheme.typography.labelMedium, color = ZarvisAccents.primary)
                                },
                            )
                        }
                    }
                }
            } else if (feature.canDo.isNotEmpty()) {
                QueenSection(title = "What it can do") { Bullets(feature.canDo) }
            }

            QueenSection(title = "About it") {
                QueenListCard {
                    AboutRow("What it does", ZarvisIcons.Sparkle, startOpen = true) { Body(feature.what) }
                    QueenRowDivider()
                    AboutRow("Why it is useful", ZarvisIcons.Check) { Body(feature.why) }
                    QueenRowDivider()
                    AboutRow("How it works", ZarvisIcons.List) {
                        feature.how.forEachIndexed { index, step -> Body("${index + 1}. $step") }
                    }
                    QueenRowDivider()
                    AboutRow("How to start", ZarvisIcons.Bolt) { Body(feature.start) }
                    QueenRowDivider()
                    AboutRow("Permissions", ZarvisIcons.Shield) { Body(feature.permissions) }
                    QueenRowDivider()
                    AboutRow("Limitations", ZarvisIcons.Alert) { Bullets(feature.limits) }
                }
            }
            Spacer(Modifier.height(ZarvisSpacing.md))
        }
    }
}

/** One part of the longer explanation, closed until tapped (except [startOpen]); whether it is open survives turning the phone. */
@Composable
private fun AboutRow(title: String, icon: ImageVector, startOpen: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    var open by rememberSaveable(title) { mutableStateOf(startOpen) }
    QueenExpandableRow(title = title, expanded = open, onToggle = { open = !open }, icon = icon, iconTint = ZarvisAccents.primary, content = content)
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
