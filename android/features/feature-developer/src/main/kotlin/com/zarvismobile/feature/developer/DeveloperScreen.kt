package com.zarvismobile.feature.developer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.QueenIconTile
import com.zarvismobile.core.ui.components.QueenInlineError
import com.zarvismobile.core.ui.components.QueenListCard
import com.zarvismobile.core.ui.components.QueenNote
import com.zarvismobile.core.ui.components.QueenPageHeader
import com.zarvismobile.core.ui.components.QueenRowDivider
import com.zarvismobile.core.ui.components.QueenSection
import com.zarvismobile.core.ui.components.RiskBadge
import com.zarvismobile.core.ui.components.RiskBadgeLevel
import com.zarvismobile.core.ui.components.SkeletonList
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.ZarvisTextField
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.domain.presentation.StatusTone
import com.zarvismobile.domain.presentation.UiString

/**
 * Developer Mode — see DEVELOPER_AGENT.md; Queen Pro board 13. Read-only analysis of a repository: what the analysis reports, the
 * address, Analyze, and the result as a short summary and a few facts (Yes / No, never true / false). While it runs, the button says
 * Analyzing and the result's place holds a skeleton; a failure says what happened in the server's words. Its words follow the app's
 * language. Nothing on this page changes a repository.
 */
@Composable
fun DeveloperScreen(onBack: (() -> Unit)? = null, viewModel: DeveloperViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()

    // navigationBarsPadding() claims the gesture-nav-bar inset when no tab bar has (the graph marks the tab bar's space as taken),
    // and imePadding() keeps the repo-URL field/button above the keyboard instead of the keyboard covering them.
    ZarvisBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(ZarvisSpacing.pageGutter),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            QueenPageHeader(
                title = tr(UiString.WORK_DEVELOPER_TITLE),
                subtitle = tr(UiString.DEV_INTRO),
                onBack = onBack,
                backLabel = tr(UiString.COMMON_BACK),
                actions = {
                    RiskBadge(level = RiskBadgeLevel.LOW)
                    StatusBadge(label = tr(UiString.DEV_READ_ONLY), tone = StatusTone.NEUTRAL)
                },
            )

            // Exactly the facts the result below shows, so the page never promises more than the analysis returns.
            QueenNote(
                title = tr(UiString.DEV_REPORTS),
                text = listOf(
                    UiString.DEV_PRIMARY_LANGUAGE, UiString.DEV_BUILD_SYSTEM, UiString.DEV_HAS_TESTS, UiString.DEV_HAS_CI,
                    UiString.WORK_FILES_TITLE, UiString.DEV_TOP_FOLDERS,
                ).map { tr(it) }.joinToString(" · "),
                icon = ZarvisIcons.Code,
                tint = ZarvisAccents.blue,
            )

            GlassSurface(modifier = Modifier.fillMaxWidth()) {
                Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.gap)) {
                    ZarvisTextField(
                        value = uiState.repoUrl,
                        onValueChange = viewModel::onRepoUrlChange,
                        label = tr(UiString.DEV_REPO_URL),
                        placeholder = "https://github.com/owner/repo",
                        leadingIcon = ZarvisIcons.Github,
                        enabled = !uiState.isAnalyzing,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                        keyboardActions = KeyboardActions(onGo = { if (!uiState.isAnalyzing) viewModel.analyze() }),
                    )
                    // The button says what is happening while the analysis runs (and is off, so it cannot be sent twice).
                    ZarvisPrimaryButton(
                        text = tr(if (uiState.isAnalyzing) UiString.DEV_ANALYZING else UiString.DEV_ANALYZE),
                        onClick = viewModel::analyze,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !uiState.isAnalyzing,
                        icon = ZarvisIcons.Search,
                    )
                }
            }

            uiState.error?.let { QueenInlineError(text = it) }

            if (uiState.isAnalyzing) {
                // The result's place, in its shape, announced once as "Analyzing…".
                SkeletonList(loadingLabel = tr(UiString.DEV_ANALYZING), rows = 2)
            }

            uiState.result?.let { structure ->
                QueenSection(title = tr(UiString.DEV_RESULT), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
                    QueenListCard {
                        uiState.summary?.let {
                            Text(text = it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(ZarvisSpacing.md))
                            QueenRowDivider()
                        }
                        Fact(ZarvisIcons.Code, ZarvisAccents.blue, tr(UiString.DEV_PRIMARY_LANGUAGE), structure.primaryLanguage)
                        QueenRowDivider()
                        Fact(ZarvisIcons.Bolt, ZarvisAccents.violet, tr(UiString.DEV_BUILD_SYSTEM), structure.buildSystem)
                        QueenRowDivider()
                        Fact(
                            ZarvisIcons.Bug, ZarvisAccents.pink, tr(UiString.DEV_HAS_TESTS), yesNo(structure.hasTests),
                            if (structure.hasTests) ZarvisAccents.success else ZarvisAccents.danger,
                        )
                        QueenRowDivider()
                        Fact(
                            ZarvisIcons.Activity, ZarvisAccents.cyan, tr(UiString.DEV_HAS_CI), yesNo(structure.hasCi),
                            if (structure.hasCi) ZarvisAccents.success else ZarvisAccents.danger,
                        )
                        QueenRowDivider()
                        Fact(ZarvisIcons.File, ZarvisAccents.primary, tr(UiString.WORK_FILES_TITLE), structure.fileCount.toString())
                        QueenRowDivider()
                        Fact(ZarvisIcons.Folder, ZarvisAccents.violet, tr(UiString.DEV_TOP_FOLDERS), structure.topLevelDirs.joinToString(", "))
                    }
                }
            }
        }
    }
}

@Composable
private fun yesNo(value: Boolean): String = tr(if (value) UiString.COMMON_YES else UiString.COMMON_NO)

/** One fact of the analysis: its icon and what it is on the left, the answer on the right (Yes / No in words, never colour alone). */
@Composable
private fun Fact(icon: ImageVector, tint: Color, label: String, value: String, valueColor: Color = Color.Unspecified) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = ZarvisSpacing.md, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.gap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        QueenIconTile(icon = icon, tint = tint, size = 32.dp)
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = valueColor, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
    }
}
