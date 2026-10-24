package com.zarvismobile.feature.developer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.QueenListCard
import com.zarvismobile.core.ui.components.QueenPageHeader
import com.zarvismobile.core.ui.components.QueenRowDivider
import com.zarvismobile.core.ui.components.QueenSection
import com.zarvismobile.core.ui.components.RiskBadge
import com.zarvismobile.core.ui.components.RiskBadgeLevel
import com.zarvismobile.core.ui.components.SkeletonBlock
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.domain.presentation.StatusTone
import com.zarvismobile.domain.presentation.UiString

/**
 * Developer Mode — see DEVELOPER_AGENT.md; Queen Pro board 13. Read-only analysis of a repository: the address, Analyze, and the
 * result as a short summary and a few facts (Yes / No, never true / false). Its words follow the app's language.
 */
@Composable
fun DeveloperScreen(onBack: (() -> Unit)? = null, viewModel: DeveloperViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()

    // Full-screen destination (no Scaffold bottomBar, MASTER_SPEC.md §23): claims the
    // gesture-nav-bar inset itself, and imePadding() keeps the repo-URL field/button above
    // the keyboard instead of the keyboard covering them.
    ZarvisBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(ZarvisSpacing.md),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            QueenPageHeader(
                title = tr(UiString.WORK_DEVELOPER_TITLE),
                subtitle = tr(UiString.DEV_INTRO),
                onBack = onBack,
                backLabel = tr(UiString.COMMON_BACK),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                RiskBadge(level = RiskBadgeLevel.LOW)
                StatusBadge(label = tr(UiString.DEV_READ_ONLY), tone = StatusTone.NEUTRAL)
            }

            GlassSurface(modifier = Modifier.fillMaxWidth()) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = uiState.repoUrl,
                        onValueChange = viewModel::onRepoUrlChange,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text(tr(UiString.DEV_REPO_URL)) },
                        leadingIcon = { Icon(imageVector = ZarvisIcons.Link, contentDescription = null) },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp),
                    )
                    ZarvisPrimaryButton(text = tr(UiString.DEV_ANALYZE), onClick = viewModel::analyze, modifier = Modifier.fillMaxWidth(), enabled = !uiState.isAnalyzing)
                    if (uiState.isAnalyzing) {
                        SkeletonBlock(Modifier.fillMaxWidth().height(12.dp))
                    }
                }
            }

            uiState.error?.let { Text(text = it, color = MaterialTheme.colorScheme.error) }

            uiState.result?.let { structure ->
                QueenSection(title = tr(UiString.DEV_RESULT)) {
                    QueenListCard {
                        uiState.summary?.let {
                            Text(text = it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(ZarvisSpacing.md))
                            QueenRowDivider()
                        }
                        Fact(tr(UiString.DEV_PRIMARY_LANGUAGE), structure.primaryLanguage)
                        QueenRowDivider()
                        Fact(tr(UiString.DEV_BUILD_SYSTEM), structure.buildSystem)
                        QueenRowDivider()
                        Fact(tr(UiString.DEV_HAS_TESTS), yesNo(structure.hasTests), if (structure.hasTests) ZarvisAccents.success else ZarvisAccents.danger)
                        QueenRowDivider()
                        Fact(tr(UiString.DEV_HAS_CI), yesNo(structure.hasCi), if (structure.hasCi) ZarvisAccents.success else ZarvisAccents.danger)
                        QueenRowDivider()
                        Fact(tr(UiString.WORK_FILES_TITLE), structure.fileCount.toString())
                        QueenRowDivider()
                        Fact(tr(UiString.DEV_TOP_FOLDERS), structure.topLevelDirs.joinToString(", "))
                    }
                }
            }
        }
    }
}

@Composable
private fun yesNo(value: Boolean): String = tr(if (value) UiString.COMMON_YES else UiString.COMMON_NO)

/** One fact of the analysis: what it is on the left, the answer on the right. */
@Composable
private fun Fact(label: String, value: String, valueColor: Color = Color.Unspecified) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = ZarvisSpacing.md, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = valueColor, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
    }
}
