package com.zarvismobile.domain.skill

import java.util.Locale

/** One row of the phone's contact database: a contact (by [contactId]) and ONE of its numbers. A contact with three numbers is three rows. */
data class ContactRow(
    val contactId: String,
    val displayName: String,
    val phoneNumber: String,
    /** The number the user marked as the contact's default. */
    val isPrimary: Boolean = false,
    /** A mobile number, as opposed to home, work or fax. */
    val isMobile: Boolean = false,
)

/**
 * How a spoken name is matched to contacts. Pure Kotlin so the rules are tested here; the Android lookup only fetches rows and applies them.
 *
 * The phone's database can only answer "which names contain this text", in no useful order. Picking the first row of that answer
 * dials the wrong person: "Ram" also matches "Sriram" and "Parameshwar". So the rows are turned into distinct contacts, ranked by
 * how well the name matches, and a name that still fits more than one contact is reported as ambiguous instead of being guessed.
 */
object ContactMatching {
    /** How well a name matches, best first. */
    private enum class Tier { EXACT, STARTS_WITH, WORD_STARTS_WITH, CONTAINS }

    /**
     * One entry per contact (never one per number), with its best number: the default one, else a mobile one, else the first.
     * The same number written two ways ("+91 98765 43210" and "09876543210") counts once.
     */
    fun collapse(rows: List<ContactRow>): List<PhoneContact> =
        rows.groupBy { it.contactId }.values.mapNotNull { numbers ->
            val best = numbers.firstOrNull { it.isPrimary } ?: numbers.firstOrNull { it.isMobile } ?: numbers.firstOrNull() ?: return@mapNotNull null
            PhoneContact(best.displayName, best.phoneNumber)
        }.distinctBy { it.displayName.normalized() to digitsOf(it.phoneNumber).takeLast(NUMBER_IDENTITY_DIGITS) }

    /**
     * The contacts that match [query] best, and only those: contacts whose name IS the query beat names that start with it, which beat names
     * with a word that starts with it, which beat names that merely contain it. Sorted by name. More than one entry means the query is
     * ambiguous; an empty list means nothing matches.
     */
    fun bestMatches(query: String, candidates: List<PhoneContact>): List<PhoneContact> {
        val wanted = query.normalized()
        if (wanted.isEmpty()) return emptyList()
        val ranked = candidates.mapNotNull { contact -> tierOf(wanted, contact.displayName.normalized())?.let { contact to it } }
        val best = ranked.minOfOrNull { it.second } ?: return emptyList()
        return ranked.filter { it.second == best }.map { it.first }.sortedBy { it.displayName.normalized() }
    }

    /** The SQL LIKE pattern for "a name containing [name]", with `%`, `_` and `\` taken literally (use `ESCAPE '\'`). */
    fun likePattern(name: String): String = "%" + name.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"

    private fun tierOf(wanted: String, name: String): Tier? = when {
        name == wanted -> Tier.EXACT
        name.startsWith(wanted) -> Tier.STARTS_WITH
        name.split(' ').any { it.startsWith(wanted) } || name.contains(" $wanted") -> Tier.WORD_STARTS_WITH
        name.contains(wanted) -> Tier.CONTAINS
        else -> null
    }

    private fun String.normalized(): String = trim().lowercase(Locale.ROOT).replace(Regex("\\s+"), " ")

    private fun digitsOf(number: String): String = number.filter { it.isDigit() }

    /** Numbers are compared by their last ten digits, so a country code or a leading 0 does not make one number look like two. */
    private const val NUMBER_IDENTITY_DIGITS = 10
}
