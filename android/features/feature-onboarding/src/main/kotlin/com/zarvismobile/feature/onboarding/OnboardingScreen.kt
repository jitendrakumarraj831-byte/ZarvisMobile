package com.zarvismobile.feature.onboarding

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.ZarvisGhostButton
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.theme.ZarvisSpacing

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

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(ZarvisSpacing.xl),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            ZarvisGhostButton(text = "Skip", onClick = viewModel::skip)
        }

        // weight(fill = false) + verticalScroll: takes only the space it needs (preserving
        // the original SpaceBetween look for today's short copy) but scrolls instead of
        // clipping if a longer page or a larger accessibility font size ever needs more
        // height than is available between the skip row and the page controls below.
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f, fill = false)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            Text(text = page.title, style = MaterialTheme.typography.headlineLarge)
            Text(text = page.body, style = MaterialTheme.typography.bodyLarge)
        }

        Column(
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.lg),
        ) {
            PageIndicator(count = uiState.pageCount, current = uiState.pageIndex)
            ZarvisPrimaryButton(
                text = if (uiState.pageIndex == uiState.pageCount - 1) "Get started" else "Next",
                onClick = viewModel::next,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun PageIndicator(count: Int, current: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.xs)) {
        repeat(count) { index ->
            val isActive = index == current
            Surface(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape),
                color = if (isActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
            ) {
                Box(modifier = Modifier.fillMaxSize())
            }
        }
    }
}
