package com.zarvismobile.domain.presentation

import com.zarvismobile.domain.capability.CatalogCapability
import com.zarvismobile.domain.capability.SharedFeatureCatalog
import com.zarvismobile.domain.entity.CapabilityStatus

/** Where a capability is used from this phone, read from shared/feature-catalog.json (never decided by the screen). */
enum class SkillPlace {
    /** Works in this app outside Chat: its own screen or the phone itself (voice, Phone Agent, Memory, Developer Agent). */
    ON_THIS_PHONE,

    /** Works by asking in Chat: its explanation page's action is Chat. */
    IN_CHAT,

    /** Not in this app, but works on the website. */
    WEBSITE_ONLY,

    /** Neither in this app nor on the website yet. */
    NOT_YET,
}

/** The filters above the Skills list. [ALL] shows everything, the others one [SkillPlace] each. */
enum class SkillFilter(val label: UiString) {
    ALL(UiString.SKILLS_FILTER_ALL),
    ON_THIS_PHONE(UiString.WORK_ON_THIS_PHONE),
    IN_CHAT(UiString.SKILLS_FILTER_CHAT),
    WEBSITE_ONLY(UiString.WORK_AVAILABILITY_WEBSITE),
    ;

    fun accepts(place: SkillPlace): Boolean = when (this) {
        ALL -> true
        ON_THIS_PHONE -> place == SkillPlace.ON_THIS_PHONE
        IN_CHAT -> place == SkillPlace.IN_CHAT
        WEBSITE_ONLY -> place == SkillPlace.WEBSITE_ONLY
    }
}

/** One row of the Skills list: the capability, where it is used, and the page that explains it (when there is one). */
data class SkillRow(val capability: CatalogCapability, val place: SkillPlace, val detailPage: String?)

/** One titled group of the Skills list ("AI", "Voice", ...), in the catalogue's order. */
data class SkillGroup(val title: String, val rows: List<SkillRow>)

/**
 * The Skills tab's list: the catalogue's groups of capabilities, each with where it is used on this phone, narrowed by a
 * [SkillFilter] and a search. Every state comes from the shared catalogue, so the list and the website agree.
 */
object SkillsCatalog {
    private fun usable(status: CapabilityStatus) = status == CapabilityStatus.WORKING || status == CapabilityStatus.PARTIAL

    fun placeOf(catalog: SharedFeatureCatalog, capability: CatalogCapability): SkillPlace = when {
        usable(capability.android.status) -> {
            val action = capability.detail?.let { catalog.page(it)?.android?.action }
            if (action == "chat") SkillPlace.IN_CHAT else SkillPlace.ON_THIS_PHONE
        }
        usable(capability.web.status) -> SkillPlace.WEBSITE_ONLY
        else -> SkillPlace.NOT_YET
    }

    private val wordBreak = Regex("[^\\p{L}\\p{N}]+")

    /**
     * True when a word of the capability's name, line or note starts with [query] ("voice" finds "Voice input", not "invoices"), or,
     * for a query of several words, when the text contains it. Case and surrounding spaces are ignored; a blank query matches all.
     */
    fun matches(capability: CatalogCapability, query: String): Boolean {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return true
        return listOfNotNull(capability.name, capability.short, capability.android.note).any { text ->
            val lower = text.lowercase()
            if (' ' in q) q in lower else lower.split(wordBreak).any { it.startsWith(q) }
        }
    }

    /** The groups to show for [filter] and [query]; a group with no matching row is left out. */
    fun groups(catalog: SharedFeatureCatalog, filter: SkillFilter, query: String): List<SkillGroup> =
        catalog.groups.mapNotNull { group ->
            val rows = group.capabilityIds
                .map(catalog::capability)
                .map { SkillRow(it, placeOf(catalog, it), it.detail) }
                .filter { filter.accepts(it.place) && matches(it.capability, query) }
            if (rows.isEmpty()) null else SkillGroup(group.title, rows)
        }
}
