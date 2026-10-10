package com.zarvismobile.domain.presentation

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * A screen that is registered in the navigation graph but that nothing navigates to cannot be reached by anyone (the
 * System Metrics and Tasks routes were exactly that). The graph is Android code, so this reads its source, as
 * web/tests/css.test.js reads the stylesheet for classes nothing renders.
 */
class NavigationReachabilityTest {
    private val source = File("../app/src/main/kotlin/com/zarvismobile/app/navigation/NavGraph.kt").readText()

    private fun routes(): Map<String, String> =
        Regex("""const val (\w+) = "([^"]+)"""").findAll(source.substringAfter("object Routes").substringBefore("}")).associate { it.groupValues[1] to it.groupValues[2] }

    /** The names of routes that are tabs in the bottom bar, or the place the app starts. */
    private fun tabsAndStart(): Set<String> =
        Regex("""ZarvisNavItem\(Routes\.(\w+)""").findAll(source).map { it.groupValues[1] }.toSet() + setOf("HOME", "ONBOARDING")

    private fun isNavigatedTo(name: String): Boolean =
        source.lines().any { line -> ("navigate(" in line && "Routes.$name" in line) || Regex("""->\s*Routes\.$name\b""").containsMatchIn(line) }

    @Test
    fun `the routes and the bottom tabs could be read`() {
        assertTrue(routes().size >= 10, routes().toString())
        assertEquals(setOf("HOME", "CHAT", "CAPABILITIES", "ACTIVITY", "MORE"), tabsAndStart().minus("ONBOARDING"))
    }

    @Test
    fun `every registered screen can be reached from another screen`() {
        // Not screens: the argument names, and the feature route, which is entered through "feature/<id>".
        val notScreens = setOf("CONVERSATION_ARG_INITIAL_TEXT", "FEATURE_ARG", "FEATURE")
        val unreachable = routes().keys.filter { it !in notScreens && it !in tabsAndStart() && !isNavigatedTo(it) }
        assertEquals(emptyList(), unreachable, "registered but nothing navigates to: $unreachable")
        assertTrue("navigate(\"feature/" in source, "nothing opens a feature page")
    }

    @Test
    fun `every Work destination the catalog offers is wired to a route`() {
        for (screen in WorkScreen.entries) {
            assertTrue(Regex("""WorkScreen\.${screen.name}\s*->\s*Routes\.\w+""").containsMatchIn(source), "WorkScreen.${screen.name} has no route in NavGraph.kt")
        }
    }
}
