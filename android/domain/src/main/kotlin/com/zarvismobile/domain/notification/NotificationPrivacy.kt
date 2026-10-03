package com.zarvismobile.domain.notification

import com.zarvismobile.domain.privacy.SensitiveApps

/**
 * Blueprint §12 notification privacy. Pure policy: given one notification as Android reported
 * it and the user's settings, decide what ZARVIS may show or say about it. Nothing here reads
 * Android; the listener hands in [NotificationSnapshot]s.
 */
enum class NotificationMode(val label: String) {
    OFF("Off"),
    APP_AND_TYPE("App + type"),
    CONTACT_AND_APP("Contact + app"),
    CONTACT_APP_PREVIEW("Contact + app + preview"),
    FULL_CONTENT("Available content"),
}

enum class LockScreenBehavior(val label: String) {
    SILENT_WHEN_LOCKED("Don't speak while the phone is locked"),
    APP_ONLY_WHEN_LOCKED("Only say the app name while locked"),
    SAME_AS_UNLOCKED("Same as unlocked"),
}

/** Minutes after midnight, local time. Wraps past midnight when [startMinute] > [endMinute]. */
data class QuietHours(val enabled: Boolean, val startMinute: Int, val endMinute: Int) {
    init {
        require(startMinute in 0 until MINUTES_PER_DAY && endMinute in 0 until MINUTES_PER_DAY) { "Quiet hours must be within a day" }
    }

    fun contains(minuteOfDay: Int): Boolean = when {
        !enabled || startMinute == endMinute -> false
        startMinute < endMinute -> minuteOfDay in startMinute until endMinute
        else -> minuteOfDay >= startMinute || minuteOfDay < endMinute
    }

    companion object {
        const val MINUTES_PER_DAY = 24 * 60
    }
}

/** Defaults are the least-exposing reasonable choices; everything is changed in ZARVIS Settings > Notifications. */
data class NotificationPrivacySettings(
    val mode: NotificationMode = NotificationMode.APP_AND_TYPE,
    val speakEnabled: Boolean = false,
    val quietHours: QuietHours = QuietHours(enabled = true, startMinute = 22 * 60, endMinute = 7 * 60),
    val lockScreen: LockScreenBehavior = LockScreenBehavior.SILENT_WHEN_LOCKED,
    val headphonesOnly: Boolean = true,
    /** OTP / banking / authentication alerts are hidden unless the user turns this on. */
    val includeSensitive: Boolean = false,
    val excludedPackages: Set<String> = emptySet(),
)

/**
 * One notification exactly as Android reported it. [sender] is only ever what Android put in a
 * messaging notification (MessagingStyle sender or the title of a message/email/call) — ZARVIS
 * never infers a name.
 */
data class NotificationSnapshot(
    val key: String,
    val packageName: String,
    val appLabel: String,
    val category: String?,
    val sender: String?,
    val title: String?,
    val text: String?,
    val postedAtMillis: Long,
)

/** Conditions at the moment a notification arrives (read from Android by the caller). */
data class SpeakContext(val minuteOfDay: Int, val deviceLocked: Boolean, val headphonesConnected: Boolean)

sealed interface SpeakDecision {
    data class Speak(val text: String) : SpeakDecision
    data class Skip(val reason: String) : SpeakDecision
}

data class NotificationSummary(
    val lines: List<String>,
    val hiddenSensitive: Int,
    val excluded: Int,
    val total: Int,
)

object NotificationPrivacy {

    private val OTP_OR_AUTH = Regex(
        """\b(otp|one[- ]?time\s*(pass(word|code)?|code|pin)|verification\s*code|security\s*code|auth(entication)?\s*code|login\s*code|sign[- ]?in\s*code|2fa|two[- ]factor|passcode)\b|ओटीपी|सत्यापन\s*कोड""",
        RegexOption.IGNORE_CASE,
    )
    private val CODE_NEAR_DIGITS = Regex("""\bcode\b\D{0,20}\b\d{4,8}\b|\b\d{4,8}\b\D{0,20}\bcode\b""", RegexOption.IGNORE_CASE)
    private val BANKING = Regex(
        """\b(debited|credited|a/c|acct|account\s*balance|avl\s*bal|available\s*balance|upi|transaction|txn|net\s*banking|card\s*ending|withdrawn|neft|imps|rtgs)\b""",
        RegexOption.IGNORE_CASE,
    )
    /** Conservative on purpose: when unsure it treats the notification as sensitive (hides more). */
    fun isSensitive(n: NotificationSnapshot): Boolean {
        if (SensitiveApps.isSensitivePackage(n.packageName)) return true
        val body = listOfNotNull(n.title, n.text).joinToString(" ")
        return OTP_OR_AUTH.containsMatchIn(body) || CODE_NEAR_DIGITS.containsMatchIn(body) || BANKING.containsMatchIn(body)
    }

    fun typeLabel(category: String?): String = when (category) {
        "msg" -> "Message"
        "email" -> "Email"
        "call", "missed_call" -> "Call"
        "event" -> "Event"
        "reminder" -> "Reminder"
        "alarm" -> "Alarm"
        "social" -> "Social update"
        "promo" -> "Promotion"
        "transport" -> "Media"
        "navigation" -> "Navigation"
        else -> "Notification"
    }

    /** Text ZARVIS may use for [n] under [settings], or null when [n] must not be described. */
    fun describe(n: NotificationSnapshot, settings: NotificationPrivacySettings, forceMode: NotificationMode? = null): String? {
        val mode = forceMode ?: settings.mode
        if (mode == NotificationMode.OFF) return null
        if (n.packageName in settings.excludedPackages) return null
        if (isSensitive(n) && !settings.includeSensitive) return "Security or banking alert from ${n.appLabel} (content hidden)"
        val type = typeLabel(n.category)
        val sender = n.sender?.trim()?.takeIf { it.isNotEmpty() }
        val withContact = if (sender != null) "$type from $sender on ${n.appLabel}" else "$type from ${n.appLabel}"
        val body = n.text?.trim()?.replace(Regex("\\s+"), " ")?.takeIf { it.isNotEmpty() }
        return when (mode) {
            NotificationMode.OFF -> null
            NotificationMode.APP_AND_TYPE -> "$type from ${n.appLabel}"
            NotificationMode.CONTACT_AND_APP -> withContact
            NotificationMode.CONTACT_APP_PREVIEW -> body?.let { "$withContact: ${it.take(PREVIEW_CHARS)}${if (it.length > PREVIEW_CHARS) "…" else ""}" } ?: withContact
            NotificationMode.FULL_CONTENT -> {
                val titled = n.title?.trim()?.takeIf { it.isNotEmpty() && it != sender }
                listOfNotNull(withContact, titled, body?.take(FULL_CHARS)).joinToString(": ")
            }
        }
    }

    /** Whether to speak a newly arrived notification, and exactly what to say. */
    fun speakDecision(n: NotificationSnapshot, settings: NotificationPrivacySettings, context: SpeakContext): SpeakDecision {
        if (!settings.speakEnabled) return SpeakDecision.Skip("spoken notifications are off")
        if (settings.mode == NotificationMode.OFF) return SpeakDecision.Skip("notification mode is Off")
        if (n.packageName in settings.excludedPackages) return SpeakDecision.Skip("app is excluded")
        if (isSensitive(n) && !settings.includeSensitive) return SpeakDecision.Skip("security or banking alert")
        if (settings.quietHours.contains(context.minuteOfDay)) return SpeakDecision.Skip("quiet hours")
        if (settings.headphonesOnly && !context.headphonesConnected) return SpeakDecision.Skip("no headphones connected")
        val lockedMode = if (context.deviceLocked) {
            when (settings.lockScreen) {
                LockScreenBehavior.SILENT_WHEN_LOCKED -> return SpeakDecision.Skip("phone is locked")
                LockScreenBehavior.APP_ONLY_WHEN_LOCKED -> NotificationMode.APP_AND_TYPE
                LockScreenBehavior.SAME_AS_UNLOCKED -> null
            }
        } else {
            null
        }
        val text = describe(n, settings, forceMode = lockedMode) ?: return SpeakDecision.Skip("nothing may be said")
        return SpeakDecision.Speak(text)
    }

    /** What ZARVIS shows when asked to read notifications (newest first, capped). */
    fun summarize(all: List<NotificationSnapshot>, settings: NotificationPrivacySettings, max: Int = MAX_LINES): NotificationSummary {
        val newestFirst = all.sortedByDescending { it.postedAtMillis }
        val excluded = newestFirst.count { it.packageName in settings.excludedPackages }
        val hidden = newestFirst.count { it.packageName !in settings.excludedPackages && isSensitive(it) && !settings.includeSensitive }
        val lines = newestFirst.mapNotNull { describe(it, settings) }.take(max)
        return NotificationSummary(lines = lines, hiddenSensitive = hidden, excluded = excluded, total = all.size)
    }

    fun formatMinute(minute: Int): String {
        val h = minute / 60
        val m = minute % 60
        val suffix = if (h < 12) "AM" else "PM"
        val h12 = when (val x = h % 12) { 0 -> 12; else -> x }
        return "%d:%02d %s".format(h12, m, suffix)
    }

    /** One sentence describing the rules currently in effect for spoken notifications. */
    fun describeSpeakRules(settings: NotificationPrivacySettings): String = buildList {
        add("mode: ${settings.mode.label}")
        if (settings.headphonesOnly) add("only with headphones connected")
        if (settings.quietHours.enabled) add("silent ${formatMinute(settings.quietHours.startMinute)}–${formatMinute(settings.quietHours.endMinute)}")
        add(settings.lockScreen.label.replaceFirstChar { it.lowercase() })
        add(if (settings.includeSensitive) "security/banking alerts included" else "security/banking alerts never spoken")
        if (settings.excludedPackages.isNotEmpty()) add("${settings.excludedPackages.size} app(s) excluded")
    }.joinToString("; ")

    const val MAX_LINES = 10
    private const val PREVIEW_CHARS = 80
    private const val FULL_CHARS = 300
}

/** Speaks a fixed sample with the same engine and audio path spoken notifications use; returns what happened. */
fun interface NotificationSpeechPreview {
    suspend fun speakSample(): String
}
