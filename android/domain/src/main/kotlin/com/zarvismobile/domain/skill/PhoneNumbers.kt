package com.zarvismobile.domain.skill

/**
 * Phone numbers as WhatsApp needs them: the full international number in digits, without "+" ("919876543210"). Contacts are often
 * saved without the country code ("98765 43210", "098765 43210"), so the phone's own country (its SIM's) supplies it.
 */
object PhoneNumbers {
    /**
     * [number] in international digits, or null when that cannot be known for sure (no country code in the number and an unknown
     * country, or a number too short or too long to be a phone number). [countryIso] is a two-letter country code, any case.
     */
    fun international(number: String, countryIso: String?): String? {
        val trimmed = number.trim()
        val digits = trimmed.filter { it.isDigit() }
        val explicit = when {
            trimmed.startsWith("+") -> digits
            digits.startsWith("00") -> digits.drop(2)
            else -> null
        }
        if (explicit != null) return explicit.takeIf { it.length in 8..15 }
        val code = CALLING_CODES[countryIso?.lowercase()] ?: return null
        val national = digits.trimStart('0')
        // Already international without the "+" ("919876543210"): longer than a national number and starting with the code.
        if (national.startsWith(code) && national.length - code.length >= NATIONAL_LENGTH.getOrDefault(code, 8)) {
            return national.takeIf { it.length in 8..15 }
        }
        return (code + national).takeIf { national.length >= 6 && it.length in 8..15 }
    }

    /** Country calling codes for the countries ZARVIS is used in most. */
    private val CALLING_CODES = mapOf(
        "in" to "91", "us" to "1", "ca" to "1", "gb" to "44", "ae" to "971", "sa" to "966", "qa" to "974", "kw" to "965",
        "om" to "968", "bh" to "973", "np" to "977", "bd" to "880", "pk" to "92", "lk" to "94", "sg" to "65", "my" to "60",
        "au" to "61", "nz" to "64", "de" to "49", "fr" to "33", "it" to "39", "es" to "34", "nl" to "31", "za" to "27",
        "ng" to "234", "ke" to "254", "id" to "62", "ph" to "63", "th" to "66", "jp" to "81", "cn" to "86",
    )

    /** The usual length of a national number, where it is fixed (India and North America: 10 digits). */
    private val NATIONAL_LENGTH = mapOf("91" to 10, "1" to 10)
}
