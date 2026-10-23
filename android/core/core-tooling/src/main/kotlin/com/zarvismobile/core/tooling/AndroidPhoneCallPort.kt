package com.zarvismobile.core.tooling

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.zarvismobile.domain.skill.PhoneCallPort
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Real, on-device implementation of [PhoneCallPort] for the `phone.call` skill — see
 * SKILLS.md and MASTER_SPEC.md §28 Phase 4. Places an actual call via `Intent.ACTION_CALL`
 * (requires [com.zarvismobile.domain.entity.PermissionType.PHONE_CALL], already checked by
 * the Tool pipeline before this handler runs — MASTER_SPEC.md §7) rather than
 * `ACTION_DIAL`, which only pre-fills the dialer: a skill named "call" that only opens the
 * dialer would be a partial, misleading success (Product Principle #4, "never fake
 * success").
 */
class AndroidPhoneCallPort(private val context: Context) : PhoneCallPort {

    override suspend fun call(phoneNumber: String): Boolean = withContext(Dispatchers.IO) {
        try {
            // fromParts, not parse: a "#" in the number ("*99#", an extension) would otherwise start a URI fragment and be cut off.
            val intent = Intent(Intent.ACTION_CALL, Uri.fromParts("tel", phoneNumber, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            true
        } catch (e: SecurityException) {
            // The permission check above already guards this in the normal path — this
            // only catches a revocation racing between that check and this call.
            false
        } catch (e: ActivityNotFoundException) {
            false
        }
    }
}
