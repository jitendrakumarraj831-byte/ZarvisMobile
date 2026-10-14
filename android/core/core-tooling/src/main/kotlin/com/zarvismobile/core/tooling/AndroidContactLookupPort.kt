package com.zarvismobile.core.tooling

import android.content.Context
import android.provider.ContactsContract.CommonDataKinds.Phone
import com.zarvismobile.domain.skill.ContactLookupPort
import com.zarvismobile.domain.skill.ContactMatching
import com.zarvismobile.domain.skill.ContactRow
import com.zarvismobile.domain.skill.PhoneContact
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Real, on-device implementation of [ContactLookupPort] for `phone.find_contact`/`phone.call`
 * — see SKILLS.md and MASTER_SPEC.md §28 Phase 4. The Tool pipeline's permission stage
 * (MASTER_SPEC.md §7) already checks [com.zarvismobile.domain.entity.PermissionType.CONTACTS]
 * before this ever runs; the `SecurityException` catch below is only a defensive guard
 * against the permission being revoked in the narrow window between that check and this
 * query actually executing, so a race there fails as "not found" rather than crashing.
 */
class AndroidContactLookupPort(private val context: Context) : ContactLookupPort {

    /**
     * Every contact whose name contains [name], one entry each. The database is only asked for rows: which of them is THE contact (and
     * whether the name is ambiguous) is decided by [ContactMatching], which is tested without a phone.
     *
     * The text is escaped (`ESCAPE '\'`), so a name with `%` or `_` in it is matched literally instead of acting as a wildcard that
     * matches every contact. The rows come back sorted by name and capped, so a huge address book cannot make this slow.
     */
    override suspend fun search(name: String): List<PhoneContact> = withContext(Dispatchers.IO) {
        if (name.isBlank()) return@withContext emptyList()
        val projection = arrayOf(Phone.CONTACT_ID, Phone.DISPLAY_NAME_PRIMARY, Phone.NUMBER, Phone.IS_PRIMARY, Phone.TYPE)
        val selection = "${Phone.DISPLAY_NAME_PRIMARY} LIKE ? ESCAPE '\\'"
        val selectionArgs = arrayOf(ContactMatching.likePattern(name))
        val sortOrder = "${Phone.DISPLAY_NAME_PRIMARY} ASC" // plain column and direction only: the provider checks what a caller puts in ORDER BY

        try {
            val rows = mutableListOf<ContactRow>()
            context.contentResolver.query(Phone.CONTENT_URI, projection, selection, selectionArgs, sortOrder)?.use { cursor ->
                val idIndex = cursor.getColumnIndexOrThrow(Phone.CONTACT_ID)
                val nameIndex = cursor.getColumnIndexOrThrow(Phone.DISPLAY_NAME_PRIMARY)
                val numberIndex = cursor.getColumnIndexOrThrow(Phone.NUMBER)
                val primaryIndex = cursor.getColumnIndexOrThrow(Phone.IS_PRIMARY)
                val typeIndex = cursor.getColumnIndexOrThrow(Phone.TYPE)
                while (cursor.moveToNext() && rows.size < MAX_ROWS) {
                    val displayName = cursor.getString(nameIndex)
                    val number = cursor.getString(numberIndex)
                    // A row without a name or number cannot be shown or dialed, so it is not a candidate.
                    if (displayName.isNullOrBlank() || number.isNullOrBlank()) continue
                    rows += ContactRow(
                        contactId = cursor.getString(idIndex).orEmpty(),
                        displayName = displayName,
                        phoneNumber = number,
                        isPrimary = cursor.getInt(primaryIndex) != 0,
                        isMobile = cursor.getInt(typeIndex) == Phone.TYPE_MOBILE,
                    )
                }
            }
            ContactMatching.collapse(rows)
        } catch (e: SecurityException) {
            emptyList()
        }
    }

    private companion object {
        /** More than any real address book has rows for one name; it only stops a runaway query. */
        const val MAX_ROWS = 500
    }
}
