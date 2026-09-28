package com.zarvismobile.domain.skill

import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.domain.entity.EntitlementLevel
import com.zarvismobile.domain.entity.JsonSchema
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.entity.PreparedAction
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillCategory
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillHandler
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.SkillPreparer
import com.zarvismobile.domain.entity.SkillResult
import com.zarvismobile.domain.entity.UsageCost
import com.zarvismobile.domain.notification.NotificationMode
import com.zarvismobile.domain.notification.NotificationPrivacy
import com.zarvismobile.domain.privacy.SensitiveApps
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Phase 1 special-access capabilities: notification access, spoken notifications, usage access,
 * accessibility global actions, screen reading/tapping, and the default-assistant role.
 *
 * Every skill runs through the ToolPipeline, is gated by the live Android state of its special
 * access, confirms the exact action whenever the action policy requires it, and reports only
 * what Android actually returned.
 */
object SpecialAccessSkills {

    private val TIME = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)

    private fun skill(
        id: String,
        name: String,
        description: String,
        capabilities: List<String>,
        capabilityId: String,
        risk: RiskLevel,
        actionClass: ActionClass,
        permissions: List<PermissionType>,
        required: Set<String> = emptySet(),
        preparer: SkillPreparer? = null,
        handler: SkillHandler,
    ) = SkillDefinition(
        id = id,
        name = name,
        description = description,
        category = SkillCategory.PHONE,
        capabilities = capabilities,
        requiredPermissions = permissions,
        requiredEntitlement = EntitlementLevel.FREE,
        usageCost = UsageCost.FREE,
        riskLevel = risk,
        actionClass = actionClass,
        capabilityId = capabilityId,
        // Confirmation comes from ActionPolicy (risk/action class), never weakened here.
        requiresConfirmation = false,
        executesOnDevice = true,
        inputSchema = JsonSchema(requiredFields = required),
        preparer = preparer,
        handler = handler,
    )

    // --- notification_read ---------------------------------------------------------------

    fun readNotifications(reader: NotificationReaderPort, settings: NotificationSettingsPort) = skill(
        id = "notifications.read_recent",
        name = "Read notifications",
        description = "Show a privacy-filtered summary of your current notifications, e.g. \"read my notifications\".",
        capabilities = listOf(
            "read my notifications", "read notifications", "my notifications", "any notifications", "check notifications",
            "check my notifications", "what notifications", "notifications padho", "notification padho", "notifications batao",
            "notification batao", "नोटिफिकेशन पढ़ो", "सूचनाएं पढ़ो",
        ),
        capabilityId = "notification_read",
        risk = RiskLevel.HIGH,
        actionClass = ActionClass.READ_ONLY,
        permissions = listOf(PermissionType.NOTIFICATION_LISTENER),
        preparer = SkillPreparer { input, _ ->
            val prefs = settings.current()
            if (prefs.mode == NotificationMode.OFF) {
                return@SkillPreparer PreparedAction.Failed(
                    SkillResult.Failure(
                        "notification_mode_off",
                        "Notification reading is Off in ZARVIS Settings > Notifications. Choose a mode there, then ask again.",
                        userActionRequired = true,
                    ),
                )
            }
            when (val active = reader.active()) {
                ActiveNotifications.NotConnected -> PreparedAction.Failed(listenerNotConnected())
                is ActiveNotifications.Available -> {
                    val visible = active.items.filterNot { it.packageName in prefs.excludedPackages }
                    val apps = visible.map { it.appLabel }.distinct()
                    val from = when {
                        apps.isEmpty() -> ""
                        apps.size <= 3 -> " from ${apps.joinToString(", ")}"
                        else -> " from ${apps.take(3).joinToString(", ")} and ${apps.size - 3} more app(s)"
                    }
                    PreparedAction.Ready(
                        description = "Show a summary of your ${visible.size} current notification(s)$from in this chat, " +
                            "using the \"${prefs.mode.label}\" privacy mode. " +
                            (if (prefs.includeSensitive) "Security and banking alerts are included (your setting)." else "Security and banking alerts stay hidden.") +
                            " Nothing is uploaded.",
                        input = input,
                    )
                }
            }
        },
        handler = SkillHandler { _, _ ->
            val prefs = settings.current()
            when (val active = reader.active()) {
                ActiveNotifications.NotConnected -> listenerNotConnected()
                is ActiveNotifications.Available -> {
                    val summary = NotificationPrivacy.summarize(active.items, prefs)
                    val evidence = mapOf(
                        "activeNotifications" to active.items.size.toString(),
                        "shown" to summary.lines.size.toString(),
                        "hiddenSensitive" to summary.hiddenSensitive.toString(),
                        "excludedApps" to summary.excluded.toString(),
                        "mode" to prefs.mode.name,
                    )
                    if (active.items.isEmpty()) {
                        SkillResult.Success(mapOf("count" to 0), "You have no notifications right now.", evidence = evidence)
                    } else {
                        val body = buildString {
                            append("You have ${active.items.size} notification(s)")
                            append(if (summary.lines.size < active.items.size) " — showing ${summary.lines.size}:" else ":")
                            summary.lines.forEach { append("\n- ").append(it) }
                            if (summary.excluded > 0) append("\n(${summary.excluded} from apps you excluded are not shown.)")
                        }
                        SkillResult.Success(mapOf("count" to active.items.size), body, evidence = evidence)
                    }
                }
            }
        },
    )

    private fun listenerNotConnected() = SkillResult.Failure(
        "listener_not_connected",
        "Notification access is on, but Android hasn't connected ZARVIS's notification listener yet. Try again in a few seconds.",
    )

    // --- notification_speak --------------------------------------------------------------

    fun speakNotificationsOn(settings: NotificationSettingsPort) = skill(
        id = "notifications.speak_on",
        name = "Speak notifications",
        description = "Turn on spoken notifications (with your privacy rules), e.g. \"speak my notifications\".",
        capabilities = listOf(
            "speak my notifications", "speak notifications", "read notifications aloud", "read my notifications aloud",
            "announce notifications", "announce my notifications", "notifications bolkar", "notifications bol kar",
            "notification bolo", "नोटिफिकेशन बोलो",
        ),
        capabilityId = "notification_speak",
        risk = RiskLevel.MEDIUM,
        actionClass = ActionClass.LOW_IMPACT,
        permissions = listOf(PermissionType.NOTIFICATION_LISTENER),
        handler = SkillHandler { _, _ ->
            settings.update { current ->
                current.copy(speakEnabled = true, mode = if (current.mode == NotificationMode.OFF) NotificationMode.APP_AND_TYPE else current.mode)
            }
            val saved = settings.current() // verify by reading back what was stored
            if (!saved.speakEnabled) {
                SkillResult.Failure("not_saved", "I couldn't save that setting, so spoken notifications are still off.")
            } else {
                SkillResult.Success(
                    output = mapOf("speakEnabled" to true),
                    summary = "Spoken notifications are on — ${NotificationPrivacy.describeSpeakRules(saved)}. " +
                        "Speech is generated on this phone. Change this in Settings > Notifications.",
                    evidence = mapOf("speakEnabledReadBack" to "true", "mode" to saved.mode.name),
                )
            }
        },
    )

    fun speakNotificationsOff(settings: NotificationSettingsPort) = skill(
        id = "notifications.speak_off",
        name = "Stop speaking notifications",
        description = "Turn off spoken notifications, e.g. \"stop speaking notifications\".",
        capabilities = listOf(
            "stop speaking notifications", "stop speaking my notifications", "turn off spoken notifications",
            "don't speak notifications", "dont speak notifications", "stop announcing notifications",
            "notifications mat bolo", "notification band karo", "नोटिफिकेशन मत बोलो",
        ),
        capabilityId = "notification_speak",
        risk = RiskLevel.LOW,
        actionClass = ActionClass.LOW_IMPACT,
        permissions = emptyList(),
        handler = SkillHandler { _, _ ->
            settings.update { it.copy(speakEnabled = false) }
            if (settings.current().speakEnabled) {
                SkillResult.Failure("not_saved", "I couldn't save that setting, so spoken notifications are still on.")
            } else {
                SkillResult.Success(
                    mapOf("speakEnabled" to false),
                    "Spoken notifications are off.",
                    evidence = mapOf("speakEnabledReadBack" to "false"),
                )
            }
        },
    )

    // --- usage_stats ---------------------------------------------------------------------

    fun screenTime(usage: UsageStatsPort, zone: () -> ZoneId = { ZoneId.systemDefault() }) = skill(
        id = "usage.screen_time",
        name = "Screen time",
        description = "Show today's screen time and most-used apps, e.g. \"what's my screen time today\".",
        capabilities = listOf(
            "screen time", "app usage", "phone usage", "which apps did i use", "how long have i used",
            "how much time on my phone", "kitna phone chalaya", "kitna phone use kiya", "स्क्रीन टाइम",
        ),
        capabilityId = "usage_stats",
        risk = RiskLevel.HIGH,
        actionClass = ActionClass.READ_ONLY,
        permissions = listOf(PermissionType.USAGE_ACCESS),
        preparer = SkillPreparer { input, _ ->
            PreparedAction.Ready(
                "Show today's total screen time and your most-used apps (from Android usage access) in this chat. Nothing is uploaded.",
                input,
            )
        },
        handler = SkillHandler { _, _ ->
            when (val report = usage.todaySoFar()) {
                is UsageReport.Unavailable -> SkillResult.Failure("usage_unavailable", report.reason)
                is UsageReport.Available -> {
                    val used = report.apps.filter { it.foregroundMillis >= 60_000 }.sortedByDescending { it.foregroundMillis }
                    val total = report.apps.sumOf { it.foregroundMillis }
                    val since = TIME.format(Instant.ofEpochMilli(report.sinceEpochMillis).atZone(zone()))
                    val evidence = mapOf(
                        "source" to "UsageStatsManager",
                        "appsReported" to report.apps.size.toString(),
                        "totalForegroundMillis" to total.toString(),
                        "sinceEpochMillis" to report.sinceEpochMillis.toString(),
                    )
                    if (used.isEmpty()) {
                        SkillResult.Success(mapOf("totalMillis" to total), "Android has no app use of a minute or more recorded since $since today.", evidence = evidence)
                    } else {
                        val top = used.take(5).joinToString("\n") { "- ${it.label}: ${duration(it.foregroundMillis)}" }
                        SkillResult.Success(
                            mapOf("totalMillis" to total),
                            "Screen time since $since today: ${duration(total)}. Most used:\n$top",
                            evidence = evidence,
                        )
                    }
                }
            }
        },
    )

    internal fun duration(millis: Long): String {
        val minutes = millis / 60_000
        return if (minutes >= 60) "${minutes / 60} h ${minutes % 60} min" else "$minutes min"
    }

    // --- accessibility (global actions) --------------------------------------------------

    fun globalAction(screen: ScreenAccessPort) = skill(
        id = "device.global_action",
        name = "Phone navigation",
        description = "Press Back, Home, Recent apps, open the notification shade or quick settings, or lock the screen, e.g. \"go home\".",
        capabilities = listOf(
            "go back", "go home", "home screen", "recent apps", "show recents", "notification shade", "notification panel",
            "pull down notifications", "quick settings", "lock the screen", "lock screen", "lock my phone", "lock the phone",
            "wapas jao", "home pe jao", "phone lock karo", "फ़ोन लॉक करो",
        ),
        capabilityId = "accessibility",
        risk = RiskLevel.VERY_HIGH,
        actionClass = ActionClass.SECURITY_SENSITIVE,
        permissions = listOf(PermissionType.ACCESSIBILITY_SERVICE),
        required = setOf("action"),
        preparer = SkillPreparer { input, _ ->
            val action = GlobalAction.entries.firstOrNull { it.name == input.values["action"] }
                ?: return@SkillPreparer PreparedAction.Failed(
                    SkillResult.Failure("unknown_action", "I can press Back, Home, Recent apps, open notifications or quick settings, or lock the screen."),
                )
            if (!screen.serviceConnected()) return@SkillPreparer PreparedAction.Failed(serviceNotConnected())
            if (!screen.supports(action)) {
                return@SkillPreparer PreparedAction.Failed(SkillResult.Failure("unsupported_action", "This phone's Android version can't do ${action.spoken} through accessibility."))
            }
            val description = when (action) {
                GlobalAction.LOCK_SCREEN -> "Lock the screen now using Android accessibility. You'll need your PIN, pattern or fingerprint to unlock."
                else -> "Press ${action.spoken} using Android accessibility."
            }
            PreparedAction.Ready(description, input)
        },
        handler = SkillHandler { input, _ ->
            val action = GlobalAction.valueOf(input.values["action"] as String)
            val result = screen.performGlobal(action)
            val evidence = buildMap {
                put("performGlobalActionReturned", result.accepted.toString())
                result.observedPackage?.let { put("activeWindowAfter", it) }
                result.expectedPackage?.let { put("expectedWindow", it) }
                put("verified", result.verified.toString())
            }
            when {
                !result.accepted -> SkillResult.Failure("not_accepted", "Android didn't accept ${action.spoken}, so nothing changed.")
                result.verified -> SkillResult.Success(mapOf("action" to action.name), "Done — ${action.spoken}.", evidence = evidence)
                else -> SkillResult.Success(
                    mapOf("action" to action.name),
                    "Android accepted ${action.spoken}; ZARVIS couldn't independently confirm the screen changed.",
                    evidence = evidence,
                )
            }
        },
    )

    /** Maps spoken phrasing to a [GlobalAction] name (offline fallback parsing). */
    fun parseGlobalAction(utterance: String): String? {
        val lower = utterance.lowercase()
        return when {
            listOf("lock the screen", "lock screen", "lock my phone", "lock the phone", "phone lock", "फ़ोन लॉक").any { lower.contains(it) } -> GlobalAction.LOCK_SCREEN.name
            lower.contains("quick settings") -> GlobalAction.QUICK_SETTINGS.name
            listOf("notification shade", "notification panel", "pull down notifications").any { lower.contains(it) } -> GlobalAction.NOTIFICATIONS.name
            lower.contains("recent") -> GlobalAction.RECENTS.name
            listOf("go home", "home screen", "home pe").any { lower.contains(it) } -> GlobalAction.HOME.name
            listOf("go back", "wapas").any { lower.contains(it) } -> GlobalAction.BACK.name
            else -> null
        }
    }

    private fun serviceNotConnected() = SkillResult.Failure(
        "accessibility_not_connected",
        "ZARVIS's accessibility service is allowed but not running. Turn it off and on again in Android Settings > Accessibility > ZARVIS.",
    )

    // --- screen_interaction --------------------------------------------------------------

    private fun noTarget() = SkillResult.Failure(
        "no_target_app",
        "Open the app you want me to use, then open ZARVIS over it with the assistant gesture (long-press Home, or swipe in from a bottom corner) and ask again.",
        userActionRequired = true,
    )

    private fun refuseSensitive(target: ScreenTarget): SkillResult.Failure? = when {
        SensitiveApps.isSecuritySurface(target.packageName) -> SkillResult.Failure(
            "security_surface",
            "I don't read or tap Android's own settings, permission or install screens — change those yourself so Android's security checks stay with you.",
        )
        SensitiveApps.isSensitivePackage(target.packageName) -> SkillResult.Failure(
            "sensitive_app",
            "${target.appLabel} looks like a banking, payment, authenticator or password app, so I won't read or tap its screen.",
        )
        else -> null
    }

    fun readScreen(screen: ScreenAccessPort) = skill(
        id = "screen.read",
        name = "Read screen",
        description = "Read the visible text of the app you're using, e.g. \"read my screen\".",
        capabilities = listOf(
            "read my screen", "read the screen", "read this screen", "what's on my screen", "what is on my screen",
            "what's on the screen", "what is on the screen", "screen padho", "screen par kya hai", "स्क्रीन पढ़ो",
        ),
        capabilityId = "screen_interaction",
        risk = RiskLevel.VERY_HIGH,
        actionClass = ActionClass.SECURITY_SENSITIVE,
        permissions = listOf(PermissionType.ACCESSIBILITY_SERVICE),
        preparer = SkillPreparer { input, _ ->
            if (!screen.serviceConnected()) return@SkillPreparer PreparedAction.Failed(serviceNotConnected())
            val target = screen.foregroundTarget() ?: return@SkillPreparer PreparedAction.Failed(noTarget())
            refuseSensitive(target)?.let { return@SkillPreparer PreparedAction.Failed(it) }
            PreparedAction.Ready(
                "Read the text currently visible in ${target.appLabel} and show it here. Password fields are never read; nothing is uploaded or stored.",
                SkillInput(input.values + ("targetPackage" to target.packageName)),
            )
        },
        handler = SkillHandler { input, _ ->
            val expected = input.values["targetPackage"] as? String ?: return@SkillHandler noTarget()
            when (val read = screen.readScreen(expected)) {
                is ScreenRead.Unavailable -> SkillResult.Failure("screen_unavailable", read.reason, userActionRequired = read.userActionRequired)
                is ScreenRead.Text -> {
                    val evidence = mapOf(
                        "package" to read.target.packageName,
                        "textNodes" to read.lines.size.toString(),
                        "skippedPasswordFields" to read.skippedPasswordFields.toString(),
                    )
                    if (read.lines.isEmpty()) {
                        SkillResult.Success(mapOf("lines" to 0), "I couldn't find any readable text on the ${read.target.appLabel} screen.", evidence = evidence)
                    } else {
                        val text = read.lines.joinToString("\n").let { if (it.length > MAX_SCREEN_CHARS) it.take(MAX_SCREEN_CHARS) + "…" else it }
                        SkillResult.Success(mapOf("lines" to read.lines.size), "On the ${read.target.appLabel} screen:\n$text", evidence = evidence)
                    }
                }
            }
        },
    )

    private val BLOCKED_TAP_LABELS = Regex(
        """\b(pay|payment|buy|purchase|order|checkout|transfer|send money|subscribe|delete|remove|uninstall|erase|reset|format|allow|grant|install|confirm|accept|agree|sign in|log in|login|password|unlock)\b""",
        RegexOption.IGNORE_CASE,
    )

    fun tapOnScreen(screen: ScreenAccessPort) = skill(
        id = "screen.tap",
        name = "Tap on screen",
        description = "Tap one labelled button in the app you're using, e.g. \"tap Next\".",
        capabilities = listOf("tap on", "tap the", "tap", "press the", "click on", "click the", "button dabao", "dabao"),
        capabilityId = "screen_interaction",
        risk = RiskLevel.VERY_HIGH,
        actionClass = ActionClass.SECURITY_SENSITIVE,
        permissions = listOf(PermissionType.ACCESSIBILITY_SERVICE),
        required = setOf("label"),
        preparer = SkillPreparer { input, _ ->
            val label = (input.values["label"] as String).trim()
            if (BLOCKED_TAP_LABELS.containsMatchIn(label)) {
                return@SkillPreparer PreparedAction.Failed(
                    SkillResult.Failure(
                        "blocked_label",
                        "I don't tap \"$label\": buttons that pay, buy, delete, sign in, grant access or accept terms must be tapped by you.",
                    ),
                )
            }
            if (!screen.serviceConnected()) return@SkillPreparer PreparedAction.Failed(serviceNotConnected())
            val target = screen.foregroundTarget() ?: return@SkillPreparer PreparedAction.Failed(noTarget())
            refuseSensitive(target)?.let { return@SkillPreparer PreparedAction.Failed(it) }
            when (val plan = screen.planTap(label)) {
                is TapPlan.Unavailable -> PreparedAction.Failed(SkillResult.Failure("tap_unavailable", plan.reason, userActionRequired = plan.userActionRequired))
                is TapPlan.Ready -> PreparedAction.Ready(
                    "Tap \"${plan.label}\" in ${plan.target.appLabel}. This can send, submit or change something in that app.",
                    SkillInput(mapOf("label" to plan.label, "targetPackage" to plan.target.packageName)),
                )
            }
        },
        handler = SkillHandler { input, _ ->
            val label = input.values["label"] as String
            val expected = input.values["targetPackage"] as? String ?: return@SkillHandler noTarget()
            val result = screen.tap(label, expected)
            val evidence = mapOf(
                "actionClickReturned" to result.accepted.toString(),
                "windowChangedAfter" to result.screenChanged.toString(),
                "package" to expected,
            )
            when {
                !result.accepted -> SkillResult.Failure("tap_failed", result.reason ?: "Android didn't accept the tap on \"$label\", so nothing happened.")
                result.screenChanged -> SkillResult.Success(mapOf("label" to label), "Tapped \"$label\" — the screen changed.", evidence = evidence)
                else -> SkillResult.Success(
                    mapOf("label" to label),
                    "Android accepted the tap on \"$label\", but the screen didn't visibly change. Check the app to see whether it worked.",
                    evidence = evidence,
                )
            }
        },
    )

    /** "tap Next" / "press the OK button" / "Next dabao" → the label, or null. */
    fun parseTapLabel(utterance: String): String? {
        val trimmed = utterance.trim()
        Regex("""^(?:please\s+)?(?:tap|press|click)\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+button)?[.!]?$""", RegexOption.IGNORE_CASE)
            .find(trimmed)?.let { return it.groupValues[1].trim().trim('"', '\'', '“', '”').ifBlank { null } }
        Regex("""^(.+?)\s+(?:button\s+)?dabao$""", RegexOption.IGNORE_CASE)
            .find(trimmed)?.let { return it.groupValues[1].trim().trim('"', '\'').ifBlank { null } }
        return null
    }

    // --- default_assistant ---------------------------------------------------------------

    fun assistantSetup(role: AssistantRolePort) = skill(
        id = "assistant.setup",
        name = "Default assistant",
        description = "Make ZARVIS your phone's default digital assistant, e.g. \"make ZARVIS my default assistant\".",
        capabilities = listOf(
            "default assistant", "digital assistant", "assistant app", "make zarvis my assistant", "set zarvis as assistant",
            "set as default assistant", "default assistant banao", "डिफ़ॉल्ट असिस्टेंट",
        ),
        capabilityId = "default_assistant",
        risk = RiskLevel.MEDIUM,
        actionClass = ActionClass.LOW_IMPACT,
        permissions = listOf(PermissionType.ASSISTANT_ROLE),
        handler = SkillHandler { _, _ ->
            if (role.isDefaultAssistant()) {
                SkillResult.Success(
                    mapOf("defaultAssistant" to true),
                    "ZARVIS is your default digital assistant — Android confirms it holds the Assistant role. " +
                        "Use your phone's assistant gesture (long-press Home or swipe in from a bottom corner) to open ZARVIS over any app.",
                    evidence = mapOf("roleManagerIsRoleHeld" to "true"),
                )
            } else {
                SkillResult.Failure("role_not_held", "Android doesn't list ZARVIS as the default assistant, so nothing changed.")
            }
        },
    )

    private const val MAX_SCREEN_CHARS = 1500
}
