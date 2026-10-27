package com.zarvismobile.domain.access

import kotlin.test.Test
import kotlin.test.assertEquals

class AccessGroupTest {
    @Test
    fun `a capability is grouped by what Android reports for it`() {
        assertEquals(AccessGroup.ALLOWED, AccessGroup.of(true, listOf(AccessState.GRANTED)))
        assertEquals(AccessGroup.ALLOWED, AccessGroup.of(true, listOf(AccessState.GRANTED, AccessState.NOT_REQUIRED)))
        assertEquals(AccessGroup.NOT_ON, AccessGroup.of(true, listOf(AccessState.NOT_REQUESTED)))
        assertEquals(AccessGroup.NOT_ON, AccessGroup.of(true, listOf(AccessState.GRANTED, AccessState.DENIED)))
        assertEquals(AccessGroup.NOT_ON, AccessGroup.of(true, listOf(AccessState.SPECIAL_ACCESS_OFF)))
        assertEquals(AccessGroup.NOT_ON, AccessGroup.of(true, listOf(AccessState.PERMANENTLY_DENIED)))
        assertEquals(AccessGroup.NO_PERMISSION, AccessGroup.of(true, emptyList()))
    }

    @Test
    fun `something this phone or build cannot provide is never offered as Not on yet`() {
        assertEquals(AccessGroup.UNAVAILABLE, AccessGroup.of(true, listOf(AccessState.UNAVAILABLE)))
        assertEquals(AccessGroup.UNAVAILABLE, AccessGroup.of(true, listOf(AccessState.DENIED, AccessState.UNAVAILABLE)))
        assertEquals(AccessGroup.UNAVAILABLE, AccessGroup.of(false, listOf(AccessState.NOT_REQUESTED)))
        assertEquals(AccessGroup.UNAVAILABLE, AccessGroup.of(false, emptyList()))
    }
}
