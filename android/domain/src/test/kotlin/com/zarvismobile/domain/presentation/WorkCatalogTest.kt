package com.zarvismobile.domain.presentation

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WorkCatalogTest {
    private val items = WorkCatalog.items

    @Test
    fun `ids are unique`() {
        assertEquals(items.size, items.map { it.id }.toSet().size)
    }

    @Test
    fun `an item is either openable or labelled Website only, never both and never neither`() {
        for (item in items) {
            val destinations = listOfNotNull(item.screen, item.featureId)
            if (item.availability == WorkAvailability.WEBSITE_ONLY) {
                assertTrue(destinations.isEmpty(), "${item.id} is Website only but has a button")
            } else {
                assertEquals(1, destinations.size, "${item.id} must open exactly one thing")
            }
        }
    }

    @Test
    fun `an app screen is marked Available, a Chat page is marked Works in Chat or Android only`() {
        for (item in items) {
            if (item.screen != null) assertEquals(WorkAvailability.AVAILABLE, item.availability, item.id)
            if (item.featureId != null) assertTrue(item.availability in setOf(WorkAvailability.CHAT, WorkAvailability.ANDROID_ONLY), item.id)
        }
    }

    @Test
    fun `every screen the navigation can open is offered here, so none is a dead end`() {
        assertEquals(WorkScreen.entries.toSet(), items.mapNotNull { it.screen }.toSet())
    }

    @Test
    fun `every feature page an item opens exists in the feature catalog`() {
        val source = File("../features/feature-home/src/main/kotlin/com/zarvismobile/feature/home/FeatureCatalog.kt").readText()
        val ids = Regex("""\bid = "([a-z]+)"""").findAll(source).map { it.groupValues[1] }.toSet()
        assertTrue(ids.isNotEmpty(), "could not read the feature ids")
        for (item in items) item.featureId?.let { assertTrue(it in ids, "${item.id} opens feature page \"$it\", which does not exist (have $ids)") }
    }

    @Test
    fun `website-only items say so in their text`() {
        for (item in WorkCatalog.websiteOnly) {
            assertTrue("website" in item.body.en.lowercase(), item.id)
            assertTrue("वेबसाइट" in item.body.hi, item.id)
        }
        assertEquals(setOf("projects", "agents"), WorkCatalog.websiteOnly.map { it.id }.toSet())
    }

    @Test
    fun `the page never claims every item is the real screen`() {
        assertTrue("real screen" !in UiString.WORK_INTRO.en.lowercase())
        assertTrue("Website only" in UiString.WORK_INTRO.en)
        assertNull(items.firstOrNull { it.availability == WorkAvailability.WEBSITE_ONLY && it.screen != null })
        assertNotNull(WorkCatalog.onThisPhone.firstOrNull())
    }
}
