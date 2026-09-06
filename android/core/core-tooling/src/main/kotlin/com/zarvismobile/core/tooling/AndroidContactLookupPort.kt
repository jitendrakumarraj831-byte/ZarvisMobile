package com.zarvismobile.core.tooling

import android.content.Context
import android.provider.ContactsContract
import com.zarvismobile.domain.skill.ContactLookupPort
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

    override suspend fun findByName(name: String): PhoneContact? = withContext(Dispatchers.IO) {
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
        )
        val selection = "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY} LIKE ?"
        val selectionArgs = arrayOf("%$name%")

        try {
            context.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                null,
            )?.use { cursor ->
                if (!cursor.moveToFirst()) return@withContext null
                val nameIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY)
                val numberIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)
                PhoneContact(displayName = cursor.getString(nameIndex), phoneNumber = cursor.getString(numberIndex))
            }
        } catch (e: SecurityException) {
            null
        }
    }
}
