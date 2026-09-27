package com.zarvismobile.domain.port

import com.zarvismobile.domain.entity.PermissionType

/** Asks the Android activity for runtime permissions before a skill or the microphone runs. */
interface RuntimePermissionBroker {
    suspend fun ensure(permissions: List<PermissionType>): Boolean
}
