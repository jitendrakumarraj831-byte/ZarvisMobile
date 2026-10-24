package com.zarvismobile.domain.presentation

import com.zarvismobile.domain.capability.SharedFeatureCatalog
import com.zarvismobile.domain.entity.CapabilityStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The Skills tab's filters and search, on the real shared catalogue: every row's place comes from the catalogue's own states. */
class SkillsCatalogTest {
    private val catalog = SharedFeatureCatalog.loadDefault()

    private fun place(id: String) = SkillsCatalog.placeOf(catalog, catalog.capability(id))

    private fun ids(filter: SkillFilter, query: String = "") =
        SkillsCatalog.groups(catalog, filter, query).flatMap { group -> group.rows.map { it.capability.id } }

    @Test
    fun `where a capability is used follows its states and its explanation page`() {
        assertEquals(SkillPlace.ON_THIS_PHONE, place("phone_agent"))
        assertEquals(SkillPlace.ON_THIS_PHONE, place("voice_input"))
        assertEquals(SkillPlace.IN_CHAT, place("conversation"))
        assertEquals(SkillPlace.IN_CHAT, place("web_search"))
        assertEquals(SkillPlace.WEBSITE_ONLY, place("projects"))
        assertEquals(SkillPlace.WEBSITE_ONLY, place("pull_requests"))
        assertEquals(SkillPlace.NOT_YET, place("image_generation"))
    }

    @Test
    fun `nothing the app cannot do is offered under On this phone or In Chat`() {
        for (filter in listOf(SkillFilter.ON_THIS_PHONE, SkillFilter.IN_CHAT)) {
            for (id in ids(filter)) {
                val status = catalog.capability(id).android.status
                assertTrue(status == CapabilityStatus.PARTIAL || status == CapabilityStatus.WORKING, "$id is $status but listed under $filter")
            }
        }
    }

    @Test
    fun `Website only lists exactly what works on the website and not in the app`() {
        val expected = catalog.capabilities.filter {
            it.android.status in setOf(CapabilityStatus.PLANNED, CapabilityStatus.UNSUPPORTED) &&
                it.web.status in setOf(CapabilityStatus.PARTIAL, CapabilityStatus.WORKING)
        }.map { it.id }.toSet()
        assertEquals(expected, ids(SkillFilter.WEBSITE_ONLY).toSet())
    }

    @Test
    fun `All with no search shows every grouped capability once, in the catalogue's order`() {
        assertEquals(catalog.groups.flatMap { it.capabilityIds }, ids(SkillFilter.ALL))
    }

    @Test
    fun `search ignores case and spaces and drops groups with nothing left`() {
        assertEquals(listOf("voice_input", "spoken_replies"), ids(SkillFilter.ALL, "  VOICE "))
        val groups = SkillsCatalog.groups(catalog, SkillFilter.ALL, "voice")
        assertEquals(listOf("Voice"), groups.map { it.title })
        assertEquals(emptyList(), ids(SkillFilter.ALL, "no such skill"))
        // A word's start, not any part of it: "invoices" (Business drafts) is not a match for "voice".
        assertTrue("business_drafts" !in ids(SkillFilter.ALL, "voice"))
        assertTrue("business_drafts" in ids(SkillFilter.ALL, "invoice"))
    }

    @Test
    fun `search and filter narrow together`() {
        assertEquals(emptyList(), ids(SkillFilter.WEBSITE_ONLY, "voice"))
        assertEquals(listOf("projects"), ids(SkillFilter.WEBSITE_ONLY, "project"))
    }
}
