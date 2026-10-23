package com.zarvismobile.domain.skill

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import java.time.temporal.TemporalAdjusters

/**
 * Parses the due time out of a spoken/typed reminder request, in English, Hindi (Devanagari)
 * and Hinglish. Deliberately conservative: if no time can be understood it returns
 * [Result.NoTime] and the skill asks the user — it never guesses a time the user didn't say.
 *
 * Supported shapes (examples):
 * - relative: "in 10 minutes", "in an hour", "in 2 hours", "10 minute mein", "2 ghante baad", "30 मिनट में"
 * - clock: "at 8", "at 8am", "at 8:30 pm", "at 20:15", "8 baje", "subah 8 baje", "shaam 6 baje", "रात 9 बजे"
 * - day: "today", "tonight", "tomorrow", "kal", "aaj", "कल", "आज", "on monday", "somvar"
 */
object ReminderTimeParser {

    sealed interface Result {
        data class Parsed(val dueAt: ZonedDateTime, val title: String) : Result
        data class NoTime(val title: String) : Result
        /** A time was understood but it is already in the past (e.g. "today at 7am" at 9am). */
        data class InPast(val dueAt: ZonedDateTime, val title: String) : Result
    }

    private val WORD_NUMBERS = mapOf(
        "a" to 1, "an" to 1, "one" to 1, "ek" to 1, "एक" to 1,
        "two" to 2, "do" to 2, "दो" to 2, "three" to 3, "teen" to 3, "तीन" to 3,
        "four" to 4, "char" to 4, "चार" to 4, "five" to 5, "paanch" to 5, "पांच" to 5, "पाँच" to 5,
        "ten" to 10, "das" to 10, "दस" to 10, "fifteen" to 15, "pandrah" to 15,
        "twenty" to 20, "bees" to 20, "thirty" to 30, "tees" to 30, "half" to 30, "aadha" to 30,
    )

    private const val NUM = """(\d{1,3}|a|an|one|two|three|four|five|ten|fifteen|twenty|thirty|ek|do|teen|char|paanch|das|pandrah|bees|tees|एक|दो|तीन|चार|पांच|पाँच|दस)"""

    private val RELATIVE = listOf(
        Regex("""\bin\s+$NUM\s*(minutes?|mins?|hours?|hrs?)\b""", RegexOption.IGNORE_CASE),
        Regex("""(?<![\p{L}\d])$NUM\s*(minute|minutes|min|mins|ghante|ghanta|घंटे|घंटा|मिनट)\s*(mein|me|main|baad|bad|में|बाद)(?![\p{L}])""", RegexOption.IGNORE_CASE),
        Regex("""\bin\s+(half)\s+(an\s+)?(hour)\b""", RegexOption.IGNORE_CASE),
    )

    /** Hours and minutes said together ("in 1 hour 30 minutes", "in 2 hours and 15 mins", "1 ghanta 30 minute baad"): group 1 hours, 2 minutes. */
    private val HOURS_AND_MINUTES = listOf(
        Regex("""\bin\s+$NUM\s*(?:hours?|hrs?)\s*(?:and\s+)?$NUM\s*(?:minutes?|mins?)\b""", RegexOption.IGNORE_CASE),
        Regex(
            """(?<![\p{L}\d])$NUM\s*(?:ghante|ghanta|घंटे|घंटा)\s*(?:aur\s+|और\s+)?$NUM\s*(?:minute|minutes|min|mins|मिनट)\s*(?:mein|me|main|baad|bad|में|बाद)(?![\p{L}])""",
            RegexOption.IGNORE_CASE,
        ),
    )

    /** "in an hour and a half", "in 2 hours and a half": group 1 hours. */
    private val HOURS_AND_A_HALF = Regex("""\bin\s+$NUM\s*(?:hours?|hrs?)\s+and\s+a\s+half\b""", RegexOption.IGNORE_CASE)

    private val CLOCK_AT = Regex("""\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?![\d:])""", RegexOption.IGNORE_CASE)

    /** Alarms only: "an alarm for 6:30". Never a length of time ("for 5 minutes"). Same groups as [CLOCK_AT]. */
    private val CLOCK_FOR = Regex(
        """\bfor\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?![\d:])(?!\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?)\b)""",
        RegexOption.IGNORE_CASE,
    )
    private val CLOCK_AMPM = Regex("""(?<![\d:])(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?![\p{L}])""", RegexOption.IGNORE_CASE)
    private val CLOCK_BAJE = Regex("""(?<![\d:])(\d{1,2})(?::(\d{2}))?\s*(baje|bje|बजे)(?![\p{L}])""", RegexOption.IGNORE_CASE)

    private val MORNING = Regex("""(?<![\p{L}])(subah|savere|morning|सुबह)(?![\p{L}])""", RegexOption.IGNORE_CASE)
    private val AFTERNOON = Regex("""(?<![\p{L}])(dopahar|afternoon|दोपहर)(?![\p{L}])""", RegexOption.IGNORE_CASE)
    private val EVENING = Regex("""(?<![\p{L}])(shaam|sham|evening|शाम)(?![\p{L}])""", RegexOption.IGNORE_CASE)
    private val NIGHT = Regex("""(?<![\p{L}])(raat|tonight|night|रात)(?![\p{L}])""", RegexOption.IGNORE_CASE)

    private val TOMORROW = Regex("""(?<![\p{L}])(tomorrow|kal|कल)(?![\p{L}])""", RegexOption.IGNORE_CASE)
    private val TODAY = Regex("""(?<![\p{L}])(today|tonight|aaj|आज)(?![\p{L}])""", RegexOption.IGNORE_CASE)

    private val WEEKDAYS = mapOf(
        DayOfWeek.MONDAY to listOf("monday", "somvar", "सोमवार"),
        DayOfWeek.TUESDAY to listOf("tuesday", "mangalvar", "मंगलवार"),
        DayOfWeek.WEDNESDAY to listOf("wednesday", "budhvar", "बुधवार"),
        DayOfWeek.THURSDAY to listOf("thursday", "guruvar", "गुरुवार"),
        DayOfWeek.FRIDAY to listOf("friday", "shukravar", "शुक्रवार"),
        DayOfWeek.SATURDAY to listOf("saturday", "shanivar", "शनिवार"),
        DayOfWeek.SUNDAY to listOf("sunday", "ravivar", "रविवार"),
    )

    private val TRIGGERS = listOf(
        Regex("""^\s*(please\s+)?(set\s+(a\s+)?reminder\s+(to\s+)?|remind\s+me\s+(to\s+|about\s+)?|reminder\s*:?\s*)""", RegexOption.IGNORE_CASE),
        Regex("""\s*(yaad\s+dila(na|o|dena|do)?|याद\s+दिला(ना|ओ|देना)?)\s*$""", RegexOption.IGNORE_CASE),
        Regex("""\s*(mujhe|मुझे)\s*""", RegexOption.IGNORE_CASE),
    )

    /**
     * [forAlarm]: the time is for an alarm, so an hour said without am/pm or a daypart is in the morning ("set an alarm at 6" is 6 am,
     * not the reminders' "1 to 6 is pm"), and "for 6:30" is a clock time.
     */
    fun parse(text: String, now: ZonedDateTime, forAlarm: Boolean = false): Result {
        var remainder = " $text "
        var dueAt: ZonedDateTime? = null

        // 1. Relative ("in 10 minutes") wins outright. Hours and minutes said together are added up first.
        for (pattern in HOURS_AND_MINUTES) {
            val match = pattern.find(remainder) ?: continue
            val hours = toNumber(match.groupValues[1]) ?: continue
            val minutes = toNumber(match.groupValues[2]) ?: continue
            dueAt = relative(now, hours * 60L + minutes) ?: continue
            remainder = remainder.removeRange(match.range)
            break
        }
        if (dueAt == null) {
            HOURS_AND_A_HALF.find(remainder)?.let { match ->
                val hours = toNumber(match.groupValues[1]) ?: return@let
                dueAt = relative(now, hours * 60L + 30) ?: return@let
                remainder = remainder.removeRange(match.range)
            }
        }
        if (dueAt == null) {
            for (pattern in RELATIVE) {
                val match = pattern.find(remainder) ?: continue
                val amount = if (match.groupValues[1].equals("half", true)) 30 else toNumber(match.groupValues[1]) ?: continue
                // The unit word itself, never the whole match: "three" contains "hr".
                val unit = match.groupValues[2].lowercase()
                val minutes = when {
                    match.groupValues[1].equals("half", true) -> 30L
                    unit.contains("hour") || unit.contains("hr") || unit.contains("ghant") || unit.contains("घंट") -> amount * 60L
                    else -> amount.toLong()
                }
                dueAt = relative(now, minutes) ?: continue
                remainder = remainder.removeRange(match.range)
                break
            }
        }

        if (dueAt == null) {
            // 2. Clock time + day qualifiers.
            val clock = CLOCK_AT.find(remainder) ?: (if (forAlarm) CLOCK_FOR.find(remainder) else null)
                ?: CLOCK_AMPM.find(remainder) ?: CLOCK_BAJE.find(remainder)
            var time: LocalTime? = null
            if (clock != null) {
                val hourRaw = clock.groupValues[1].toInt()
                val minute = clock.groupValues[2].toIntOrNull() ?: 0
                val meridiem = clock.groupValues.getOrNull(3)?.lowercase()?.replace(".", "").orEmpty()
                val hour = resolveHour(hourRaw, meridiem, remainder, forAlarm)
                if (hour != null && minute in 0..59) {
                    time = LocalTime.of(hour, minute)
                    remainder = remainder.removeRange(clock.range)
                }
            }

            var date: LocalDate? = null
            var explicitDay = false
            // Read before the day words are taken out: "tonight" is both a day word and a daypart.
            val night = NIGHT.containsMatchIn(remainder)
            var tonight = false
            TOMORROW.find(remainder)?.let {
                date = now.toLocalDate().plusDays(1)
                explicitDay = true
                remainder = remainder.removeRange(it.range)
            }
            if (date == null) {
                TODAY.find(remainder)?.let {
                    date = now.toLocalDate()
                    explicitDay = true
                    tonight = night
                    if (time == null && it.value.equals("tonight", true)) time = LocalTime.of(21, 0)
                    remainder = remainder.removeRange(it.range)
                }
            }
            if (date == null) {
                for ((day, names) in WEEKDAYS) {
                    val match = names.firstNotNullOfOrNull { name ->
                        Regex("""(?<![\p{L}])(on\s+)?$name(?![\p{L}])""", RegexOption.IGNORE_CASE).find(remainder)
                    } ?: continue
                    date = now.toLocalDate().with(TemporalAdjusters.next(day))
                    explicitDay = true
                    remainder = remainder.removeRange(match.range)
                    break
                }
            }

            if (time != null) {
                val day = date ?: now.toLocalDate()
                var candidate = ZonedDateTime.of(day, time, now.zone)
                // "tonight at 12", "aaj raat 1 baje": a small hour of tonight is after midnight, so on the next date.
                val afterMidnightTonight = tonight && time.hour < 5
                if ((!explicitDay || afterMidnightTonight) && !candidate.isAfter(now)) candidate = candidate.plusDays(1)
                dueAt = candidate
            } else if (date != null) {
                // A day without a time is not enough — ask instead of guessing a time.
                return Result.NoTime(cleanTitle(stripDayparts(remainder)))
            }
        }

        val title = cleanTitle(stripDayparts(remainder))
        return when {
            dueAt == null -> Result.NoTime(title)
            !dueAt.isAfter(now) -> Result.InPast(dueAt, title)
            else -> Result.Parsed(dueAt, title)
        }
    }

    /** [minutes] from [now], or null when that is no time at all or more than 30 days away. */
    private fun relative(now: ZonedDateTime, minutes: Long): ZonedDateTime? =
        if (minutes <= 0 || minutes > 60L * 24 * 30) null else now.plusMinutes(minutes).withSecond(0).withNano(0)

    /** 12-hour inference: explicit am/pm wins; else daypart words; else 1–6 → pm, 7–11 → am (for an alarm, 1–11 → am). */
    private fun resolveHour(hour: Int, meridiem: String, context: String, forAlarm: Boolean): Int? {
        if (hour !in 0..23) return null
        return when {
            meridiem == "am" -> if (hour == 12) 0 else hour.takeIf { it in 1..12 }
            meridiem == "pm" -> if (hour == 12) 12 else (hour + 12).takeIf { hour in 1..11 }
            hour > 12 || hour == 0 -> hour
            MORNING.containsMatchIn(context) -> if (hour == 12) 0 else hour
            AFTERNOON.containsMatchIn(context) || EVENING.containsMatchIn(context) -> if (hour == 12) 12 else hour + 12
            NIGHT.containsMatchIn(context) -> when (hour) {
                12 -> 0
                in 1..4 -> hour
                else -> hour + 12
            }
            hour == 12 -> 12
            // An alarm without am/pm or a daypart is almost always for the morning ("set an alarm at 6").
            forAlarm -> hour
            hour in 1..6 -> hour + 12
            else -> hour
        }
    }

    private fun stripDayparts(text: String): String =
        listOf(MORNING, AFTERNOON, EVENING, NIGHT).fold(text) { acc, regex -> acc.replace(regex, " ") }

    private fun cleanTitle(text: String): String {
        var title = text
        for (trigger in TRIGGERS) title = title.replace(trigger, " ")
        title = title
            .replace(Regex("""\s+(at|on|by|ko|को)\s*$""", RegexOption.IGNORE_CASE), " ")
            .replace(Regex("""^\s*(to|about|ki|की|ke|का)\s+""", RegexOption.IGNORE_CASE), " ")
            .replace(Regex("""\s+"""), " ")
            .trim()
            .trim(',', '.', '!', '?', '।')
            .trim()
        return title
    }

    private fun toNumber(token: String): Int? = token.toIntOrNull() ?: WORD_NUMBERS[token.lowercase()]
}
