package com.zarvismobile.domain.presentation

/** What state an item on the Work page is in on this phone. A label the user can read, never implied by a button alone. */
enum class WorkAvailability(val label: UiString, val tone: StatusTone) {
    /** A real screen in this app. */
    AVAILABLE(UiString.WORK_AVAILABILITY_AVAILABLE, StatusTone.SUCCESS),

    /** Works only on a phone: the website cannot do it. */
    ANDROID_ONLY(UiString.WORK_AVAILABILITY_ANDROID, StatusTone.ACTIVE),

    /** Done by asking in Chat; the item opens a page that explains what to ask. */
    CHAT(UiString.WORK_AVAILABILITY_CHAT, StatusTone.NEUTRAL),

    /** Exists on the website but not in this app. It has no button, because there is nothing to open. */
    WEBSITE_ONLY(UiString.WORK_AVAILABILITY_WEBSITE, StatusTone.WAITING),
}

/** The app screens a Work item can open. The navigation graph maps each one to its route. */
enum class WorkScreen { TASKS, MEMORY, METRICS, PLANS, DEVELOPER, SETTINGS }

/**
 * One card on the Work page. It opens a [screen] of the app, or the [featureId] page that explains a Chat-based area, or
 * (website-only items) nothing at all.
 */
data class WorkItem(
    val id: String,
    val title: UiString,
    val body: UiString,
    val availability: WorkAvailability,
    val screen: WorkScreen? = null,
    val featureId: String? = null,
)

/**
 * The Work page's content. It replaces a static list whose header said every item "opens the real screen" and that
 * linked to explanation pages. What is here is either a real screen, a Chat page that says so, or labelled
 * "Website only" with no button. `WorkCatalogTest` keeps it that way.
 */
object WorkCatalog {
    val items: List<WorkItem> = listOf(
        WorkItem("tasks", UiString.WORK_TASKS_TITLE, UiString.WORK_TASKS_BODY, WorkAvailability.AVAILABLE, screen = WorkScreen.TASKS),
        WorkItem("memory", UiString.WORK_MEMORY_TITLE, UiString.WORK_MEMORY_BODY, WorkAvailability.AVAILABLE, screen = WorkScreen.MEMORY),
        WorkItem("usage", UiString.WORK_USAGE_TITLE, UiString.WORK_USAGE_BODY, WorkAvailability.AVAILABLE, screen = WorkScreen.METRICS),
        WorkItem("plans", UiString.WORK_PLANS_TITLE, UiString.WORK_PLANS_BODY, WorkAvailability.AVAILABLE, screen = WorkScreen.PLANS),
        WorkItem("developer", UiString.WORK_DEVELOPER_TITLE, UiString.WORK_DEVELOPER_BODY, WorkAvailability.AVAILABLE, screen = WorkScreen.DEVELOPER),
        WorkItem("phone", UiString.WORK_PHONE_TITLE, UiString.WORK_PHONE_BODY, WorkAvailability.ANDROID_ONLY, featureId = "phone"),
        WorkItem("research", UiString.WORK_RESEARCH_TITLE, UiString.WORK_RESEARCH_BODY, WorkAvailability.CHAT, featureId = "research"),
        WorkItem("creative", UiString.WORK_CREATIVE_TITLE, UiString.WORK_CREATIVE_BODY, WorkAvailability.CHAT, featureId = "creative"),
        WorkItem("business", UiString.WORK_BUSINESS_TITLE, UiString.WORK_BUSINESS_BODY, WorkAvailability.CHAT, featureId = "business"),
        WorkItem("files", UiString.WORK_FILES_TITLE, UiString.WORK_FILES_BODY, WorkAvailability.CHAT, featureId = "documents"),
        WorkItem("settings", UiString.WORK_SETTINGS_TITLE, UiString.WORK_SETTINGS_BODY, WorkAvailability.AVAILABLE, screen = WorkScreen.SETTINGS),
        WorkItem("projects", UiString.WORK_PROJECTS_TITLE, UiString.WORK_PROJECTS_BODY, WorkAvailability.WEBSITE_ONLY),
        WorkItem("agents", UiString.WORK_AGENTS_TITLE, UiString.WORK_AGENTS_BODY, WorkAvailability.WEBSITE_ONLY),
    )

    val onThisPhone: List<WorkItem> = items.filter { it.availability != WorkAvailability.WEBSITE_ONLY }
    val websiteOnly: List<WorkItem> = items.filter { it.availability == WorkAvailability.WEBSITE_ONLY }
}
