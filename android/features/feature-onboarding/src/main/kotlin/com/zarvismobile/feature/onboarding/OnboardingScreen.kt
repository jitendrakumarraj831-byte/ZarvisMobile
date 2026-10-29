package com.zarvismobile.feature.onboarding

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.AiOrb
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.core.ui.components.ZarvisGhostButton
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import com.zarvismobile.core.ui.components.QueenListCard
import com.zarvismobile.core.ui.components.QueenRow
import com.zarvismobile.core.ui.components.QueenRowDivider
import com.zarvismobile.core.ui.components.SectionKicker
import com.zarvismobile.core.ui.i18n.trf
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisDisplayStyles
import com.zarvismobile.core.ui.theme.ZarvisProStyles
import com.zarvismobile.domain.presentation.UiString

/**
 * Progressive onboarding — see MASTER_SPEC.md §15. Every page is skippable; permissions are
 * requested later, only when a skill that needs them is first invoked (§16), not here.
 */
@Composable
fun OnboardingScreen(
    onFinished: () -> Unit,
    viewModel: OnboardingViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(uiState.complete) {
        if (uiState.complete) onFinished()
    }

    val page = OnboardingPages.all[uiState.pageIndex]
    // System Back steps back a page, like the on-screen Back, instead of closing the app from the middle of the welcome.
    BackHandler(enabled = uiState.pageIndex > 0, onBack = viewModel::previous)

    ZarvisBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = ZarvisSpacing.md, vertical = ZarvisSpacing.sm),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (uiState.pageIndex > 0) {
                    ZarvisGhostButton(text = tr(UiString.COMMON_BACK), onClick = viewModel::previous)
                } else {
                    Text(text = "ZARVIS", style = ZarvisDisplayStyles.brand, color = ZarvisAccents.gold)
                }
                Spacer(Modifier.weight(1f))
                ZarvisGhostButton(text = tr(UiString.ONBOARDING_SKIP), onClick = viewModel::skip)
            }

            // weight(fill = false) + verticalScroll: takes only the space it needs but scrolls instead of clipping if a longer page or a
            // larger accessibility font size ever needs more height than is available between the top row and the page controls below.
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = ZarvisSpacing.sm),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
            ) {
                WelcomeOrb()
                SectionKicker(text = trf(UiString.ONBOARDING_PAGE_OF, uiState.pageIndex + 1, uiState.pageCount), isHeading = false)
                Text(
                    text = tr(page.title),
                    style = ZarvisProStyles.pageTitle,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.semantics { heading() },
                )
                Text(
                    text = tr(page.body),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                // The first page says the two promises up front; page 4 explains them.
                if (uiState.pageIndex == 0) {
                    Column(Modifier.fillMaxWidth().padding(top = ZarvisSpacing.sm), verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                        QueenListCard {
                            QueenRow(title = tr(UiString.ONBOARDING_POINT_RISKY), icon = ZarvisIcons.Shield, iconTint = ZarvisAccents.primary)
                            QueenRowDivider()
                            QueenRow(title = tr(UiString.ONBOARDING_POINT_PERMISSIONS), icon = ZarvisIcons.Lock, iconTint = ZarvisAccents.primary)
                        }
                    }
                }
            }

            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.lg),
                modifier = Modifier.padding(bottom = ZarvisSpacing.md),
            ) {
                PageIndicator(count = uiState.pageCount, current = uiState.pageIndex)
                ZarvisPrimaryButton(
                    text = tr(if (uiState.pageIndex == uiState.pageCount - 1) UiString.ONBOARDING_START else UiString.ONBOARDING_NEXT),
                    onClick = viewModel::next,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/** The welcome's orb: the same lit sphere as Home's, breathing slowly unless motion is off. Decoration only (no words for TalkBack). */
@Composable
private fun WelcomeOrb() {
    AiOrb(state = VoiceState.IDLE, onClick = null, size = 168.dp, idleMotion = true, modifier = Modifier.padding(top = ZarvisSpacing.md))
}

/** Where you are among the pages: a bar in the primary for this one, dots for the others. Read out as "Page 1 of 6". */
@Composable
private fun PageIndicator(count: Int, current: Int) {
    val description = trf(UiString.ONBOARDING_PAGE_OF, current + 1, count)
    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = description },
    ) {
        repeat(count) { index ->
            val isActive = index == current
            Box(
                modifier = Modifier
                    .size(width = if (isActive) 24.dp else 8.dp, height = 8.dp)
                    .background(
                        if (isActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline.copy(alpha = 0.5f),
                        RoundedCornerShape(4.dp),
                    ),
            )
        }
    }
}
