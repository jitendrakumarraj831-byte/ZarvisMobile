package com.zarvismobile.domain.skill

import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.domain.entity.EntitlementLevel
import com.zarvismobile.domain.entity.JsonSchema
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillCategory
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillHandler
import com.zarvismobile.domain.entity.SkillResult
import com.zarvismobile.domain.entity.UsageCost

/**
 * `app.search` — opens YouTube, Maps, the Play Store or the browser at the results for a query, or Maps at the directions to a
 * place (blueprint Phase 11 INTENT_AVAILABLE): "YouTube pe arijit ke gaane search karo", "airport ka rasta dikhao", "search pizza on
 * the map". Reads nothing and changes nothing, so no confirmation. Directions are only shown: the user presses Start.
 */
object AppSearchSkillFactory {
    fun create(search: AppSearchPort): SkillDefinition = SkillDefinition(
        id = "app.search",
        name = "Search in an app",
        description = "Show search results in YouTube, Maps, the Play Store or the browser, or directions in Maps, e.g. " +
            "\"YouTube pe arijit search karo\" or \"airport ka rasta dikhao\".",
        category = SkillCategory.PHONE,
        capabilities = listOf(
            "search", "youtube", "यूट्यूब", "google", "गूगल", "maps", "map", "मैप", "play store", "प्ले स्टोर", "rasta", "raasta", "रास्ता",
            "directions", "navigate", "dhundo", "dhoondo", "khojo", "सर्च", "खोजो", "ढूंढो",
        ),
        requiredPermissions = emptyList(),
        requiredEntitlement = EntitlementLevel.FREE,
        usageCost = UsageCost.FREE,
        riskLevel = RiskLevel.LOW,
        actionClass = ActionClass.LOW_IMPACT,
        capabilityId = null,
        requiresConfirmation = false,
        executesOnDevice = true,
        inputSchema = JsonSchema(requiredFields = setOf("query")),
        handler = handler(search),
    )

    /** The app named for a search ("YouTube", "maps", "directions", "Google", none), or null for one this skill cannot search. */
    fun targetOf(app: String?): SearchTarget? = when (AppAliases.normalize(app.orEmpty())) {
        "", "web", "google", "googlesearch", "browser", "chrome", "internet", "गूगल" -> SearchTarget.WEB
        "youtube", "yt", "यूट्यूब" -> SearchTarget.YOUTUBE
        "maps", "map", "googlemaps", "मैप", "मैप्स", "नक्शा" -> SearchTarget.MAPS
        "directions", "direction", "navigation", "navigate", "route", "rasta", "raasta", "रास्ता" -> SearchTarget.DIRECTIONS
        "playstore", "googleplay", "play", "प्लेस्टोर" -> SearchTarget.PLAY_STORE
        else -> null
    }

    private fun handler(search: AppSearchPort) = SkillHandler { input, _ ->
        val query = (input.values["query"] as? String)?.trim().orEmpty()
        if (query.isEmpty()) return@SkillHandler SkillResult.Failure("missing_query", "What should I search for?")
        val app = input.values["app"] as? String
        val target = targetOf(app)
            ?: return@SkillHandler SkillResult.Failure(
                "unsupported_search_app",
                "I can show search results in YouTube, Maps, the Play Store or the browser, not in \"${app?.trim()}\".",
            )
        when (val shown = search.search(target, query)) {
            is SearchShown.Shown -> if (target == SearchTarget.DIRECTIONS) {
                SkillResult.Success(
                    output = mapOf("openedIn" to shown.appName, "destination" to query),
                    summary = "I opened directions to $query in ${shown.appName}. Press Start there when you're ready.",
                    userActionRequired = true,
                    evidence = mapOf("searchOpenedIn" to shown.appName),
                )
            } else {
                SkillResult.Success(
                    output = mapOf("openedIn" to shown.appName, "query" to query),
                    summary = "Searching ${shown.appName} for \"$query\".",
                    evidence = mapOf("searchOpenedIn" to shown.appName),
                )
            }
            is SearchShown.Unavailable -> SkillResult.Failure("search_unavailable", shown.message)
        }
    }
}
