package com.zarvismobile.domain.skill

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The rules that decide WHICH contact "call Ram" means. Before them the phone returned whichever database row came first for a
 * "contains" match, so "Ram" could ring "Sriram", and a contact with three numbers could ring the fax line.
 */
class ContactMatchingTest {

    private fun contact(name: String, number: String = "9000000000") = PhoneContact(name, number)
    private fun names(query: String, vararg all: String) = ContactMatching.bestMatches(query, all.map { contact(it) }).map { it.displayName }

    // ---- bestMatches -------------------------------------------------------------------------------------------------------------

    @Test
    fun `a contact named exactly like the query beats names that only contain it`() {
        assertEquals(listOf("Ram"), names("ram", "Sriram", "Ram Kumar", "Ram", "Parameshwar"))
    }

    @Test
    fun `a name that starts with the query beats one that merely contains it`() {
        assertEquals(listOf("Ramesh Gupta"), names("ram", "Sriram", "Ramesh Gupta", "Parameshwar"))
    }

    @Test
    fun `a word that starts with the query beats a name that contains it in the middle of a word`() {
        assertEquals(listOf("Shyam Ram"), names("ram", "Sriram", "Shyam Ram"))
    }

    @Test
    fun `a query that fits only inside other names still matches them`() {
        assertEquals(listOf("Sriram"), names("ram", "Sriram", "Priya"))
    }

    @Test
    fun `two contacts at the same rank are both returned so the caller can see the ambiguity, sorted by name`() {
        assertEquals(listOf("Ram Kumar", "Ram Singh"), names("ram", "Ram Singh", "Ram Kumar", "Sriram"))
    }

    @Test
    fun `matching ignores case and extra spaces`() {
        assertEquals(listOf("Mom Sharma"), names("  MOM   sharma ", "Mom Sharma", "Priya"))
    }

    @Test
    fun `nothing matches, a blank query and no candidates all give an empty list`() {
        assertTrue(names("zzz", "Mom", "Dad").isEmpty())
        assertTrue(names("   ", "Mom").isEmpty())
        assertTrue(ContactMatching.bestMatches("mom", emptyList()).isEmpty())
    }

    // ---- collapse ----------------------------------------------------------------------------------------------------------------

    @Test
    fun `a contact with several numbers is one entry, not one per number`() {
        val rows = listOf(
            ContactRow("1", "Mom", "111"),
            ContactRow("1", "Mom", "222"),
            ContactRow("1", "Mom", "333"),
        )
        assertEquals(1, ContactMatching.collapse(rows).size)
    }

    @Test
    fun `the number the user marked as default wins, then a mobile number, then the first`() {
        val primary = listOf(
            ContactRow("1", "Mom", "10000000001"),
            ContactRow("1", "Mom", "10000000002", isMobile = true),
            ContactRow("1", "Mom", "10000000003", isPrimary = true),
        )
        assertEquals("10000000003", ContactMatching.collapse(primary).single().phoneNumber)

        val mobile = listOf(ContactRow("1", "Mom", "10000000001"), ContactRow("1", "Mom", "10000000002", isMobile = true))
        assertEquals("10000000002", ContactMatching.collapse(mobile).single().phoneNumber)

        val first = listOf(ContactRow("1", "Mom", "10000000001"), ContactRow("1", "Mom", "10000000002"))
        assertEquals("10000000001", ContactMatching.collapse(first).single().phoneNumber)
    }

    @Test
    fun `the same person synced from two accounts with the same number is one entry however the number is written`() {
        val rows = listOf(
            ContactRow("1", "Mom", "+91 98765 43210"),
            ContactRow("2", "mom", "098765 43210"),
        )
        assertEquals(1, ContactMatching.collapse(rows).size)
    }

    @Test
    fun `two different people with the same name stay two entries`() {
        val rows = listOf(ContactRow("1", "Ram", "9876543210"), ContactRow("2", "Ram", "9123456789"))
        assertEquals(2, ContactMatching.collapse(rows).size)
    }

    // ---- likePattern -------------------------------------------------------------------------------------------------------------

    @Test
    fun `percent, underscore and backslash in a name are matched literally, not as wildcards`() {
        assertEquals("%mom%", ContactMatching.likePattern(" mom "))
        assertEquals("%100\\% off%", ContactMatching.likePattern("100% off"))
        assertEquals("%a\\_b%", ContactMatching.likePattern("a_b"))
        assertEquals("%a\\\\b%", ContactMatching.likePattern("a\\b"))
    }
}
