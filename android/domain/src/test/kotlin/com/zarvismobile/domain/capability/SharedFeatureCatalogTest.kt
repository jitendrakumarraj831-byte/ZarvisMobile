package com.zarvismobile.domain.capability

import com.zarvismobile.domain.entity.CapabilityStatus
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The same rules web/tests/featureCatalog.test.js checks for the website, on the copy the Android app packages. */
class SharedFeatureCatalogTest {
    private val catalog = SharedFeatureCatalog.loadDefault()

    @Test
    fun `the packaged catalogue is the shared file the website embeds`() {
        val shared = SharedFeatureCatalog.parse(File("../../shared/feature-catalog.json").readText())
        assertEquals(shared.groups, catalog.groups)
        assertEquals(shared.capabilities, catalog.capabilities)
        assertEquals(shared.pages, catalog.pages)
        val web = File("../../web/feature-pages.js").readText()
        assertTrue("BEGIN shared/feature-catalog.json" in web, "the website embeds the shared catalogue")
        for (capability in catalog.capabilities) assertTrue("\"id\": \"${capability.id}\"" in web, "the website's copy has ${capability.id}; run node scripts/sync-feature-catalog.mjs")
    }

    @Test
    fun `nothing in the Android app is WORKING until a real-device run is recorded`() {
        for (capability in catalog.capabilities) assertNotEquals(CapabilityStatus.WORKING, capability.android.status, capability.id)
        for (action in catalog.pages.flatMap { it.phoneActions }) assertNotEquals(CapabilityStatus.WORKING, action.android.status, action.title)
    }

    @Test
    fun `a capability that is not plainly working says why, on both platforms`() {
        for (capability in catalog.capabilities) {
            for ((platform, state) in listOf("web" to capability.web, "android" to capability.android)) {
                if (state.status == CapabilityStatus.PARTIAL || state.status == CapabilityStatus.UNSUPPORTED) {
                    assertTrue(!state.note.isNullOrBlank(), "${capability.id}.$platform is ${state.status} and must say why")
                }
            }
        }
        for (action in catalog.pages.flatMap { it.phoneActions }) assertTrue(!action.android.note.isNullOrBlank(), action.title)
    }

    @Test
    fun `a PLANNED capability offers no button and no page that implies it works`() {
        for (capability in catalog.capabilities) {
            if (capability.web.status == CapabilityStatus.PLANNED) assertNull(capability.webControl, capability.id)
            if (capability.web.status == CapabilityStatus.PLANNED && capability.android.status == CapabilityStatus.PLANNED) assertNull(capability.detail, capability.id)
        }
    }

    @Test
    fun `every page has Android copy and explains only capabilities that exist`() {
        val ids = catalog.capabilities.map { it.id }.toSet()
        for (page in catalog.pages) {
            assertTrue(page.capabilityIds.isNotEmpty(), page.id)
            assertTrue(page.capabilityIds.all { it in ids }, page.id)
            assertTrue(page.android.cta.isNotBlank() && page.android.what.isNotBlank(), page.id)
        }
        assertNull(catalog.page("workspace")!!.web, "AI Workspace has no website detail page; the website's Chat is the page")
    }

    @Test
    fun `the Phone Agent's actions name capabilities from the shared registry`() {
        val phone = assertNotNull(catalog.page("phone"))
        assertTrue(phone.phoneActions.size >= 10, "the phone actions are listed (${phone.phoneActions.size})")
        val registry = CapabilityRegistry.loadDefault()
        for (action in phone.phoneActions) action.capability?.let { assertNotNull(registry.find(it.wireId), action.title) }
        val agent = catalog.capability("phone_agent")
        assertEquals(CapabilityStatus.UNSUPPORTED, agent.web.status, "the website cannot run phone actions")
        assertNotEquals(CapabilityStatus.UNSUPPORTED, agent.android.status)
    }

    @Test
    fun `a website-only capability tells the Android user where to use it`() {
        for (capability in catalog.capabilities) {
            if (capability.android.status == CapabilityStatus.PLANNED && capability.web.status != CapabilityStatus.PLANNED) {
                assertTrue("website" in capability.android.note.orEmpty().lowercase(), capability.id)
            }
        }
    }
}
