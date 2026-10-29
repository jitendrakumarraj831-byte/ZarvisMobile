package com.zarvismobile.feature.home

import com.zarvismobile.domain.capability.CatalogCapability
import com.zarvismobile.domain.capability.CatalogPage
import com.zarvismobile.domain.capability.FeatureState
import com.zarvismobile.domain.capability.SharedFeatureCatalog

/** A capability on a detail page with its state in this app, e.g. Voice input, Partial, "The phone's speech recognizer". */
data class FeatureStatusLine(val name: String, val state: FeatureState)

data class PhoneAction(
    val title: String,
    val description: String,
    val example: String,
    val permission: String,
    val state: FeatureState,
)

data class FeaturePage(
    val id: String,
    val category: String,
    val title: String,
    val summary: String,
    val statuses: List<FeatureStatusLine>,
    val what: String,
    val why: String,
    val how: List<String>,
    val canDo: List<String>,
    val start: String,
    val permissions: String,
    val limits: List<String>,
    val examples: List<String>,
    val cta: String,
    val prompt: String,
    val action: String,
    val phoneActions: List<PhoneAction> = emptyList(),
)

/**
 * The product pages this app has, read from shared/feature-catalog.json: the same catalogue the website's Capabilities hub
 * embeds (web/feature-pages.js), so a capability has one status per platform everywhere. The statuses shown here are the
 * Android ones; none is Working until a real-device run is recorded (SharedFeatureCatalogTest).
 */
object FeatureCatalog {
    val pages: List<FeaturePage> by lazy {
        val shared = SharedFeatureCatalog.default
        shared.pages.map { page -> page.toFeaturePage(shared.capabilitiesOf(page)) }
    }

    fun find(id: String): FeaturePage? = pages.find { it.id == id }
}

private fun CatalogPage.toFeaturePage(capabilities: List<CatalogCapability>): FeaturePage {
    val copy = android
    return FeaturePage(
        id = id,
        category = category,
        title = title,
        summary = copy.summary,
        statuses = capabilities.map { FeatureStatusLine(it.name, it.android) },
        what = copy.what,
        why = copy.why,
        how = copy.how,
        canDo = copy.canDo,
        start = copy.start,
        permissions = copy.permissions,
        limits = copy.limits,
        examples = copy.examples,
        cta = copy.cta,
        prompt = copy.prompt,
        action = copy.action,
        phoneActions = phoneActions.map { PhoneAction(it.title, it.description, it.example, it.requires, it.android) },
    )
}
