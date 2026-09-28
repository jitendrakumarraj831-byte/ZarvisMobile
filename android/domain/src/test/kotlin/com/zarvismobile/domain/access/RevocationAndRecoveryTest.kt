package com.zarvismobile.domain.access

import com.zarvismobile.domain.entity.PermissionType
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class RevocationAndRecoveryTest {

    private class MemorySnapshots : AccessSnapshotStore {
        var saved: Map<PermissionType, Boolean> = emptyMap()
        override suspend fun load() = saved
        override suspend fun save(snapshot: Map<PermissionType, Boolean>) { saved = snapshot }
    }

    @Test
    fun `grant then revoke in Settings is detected on return`() = runTest {
        val states = mutableMapOf(PermissionType.CONTACTS to AccessState.GRANTED, PermissionType.PHONE_CALL to AccessState.GRANTED)
        val snapshots = MemorySnapshots()
        val detector = RevocationDetector({ states[it] ?: AccessState.NOT_REQUESTED }, snapshots)
        val permissions = listOf(PermissionType.CONTACTS, PermissionType.PHONE_CALL)

        assertTrue(detector.check(permissions).revoked.isEmpty(), "first observation has nothing to compare with")

        states[PermissionType.PHONE_CALL] = AccessState.DENIED // user revoked in Android Settings
        val report = detector.check(permissions)
        assertEquals(listOf(PermissionType.PHONE_CALL), report.revoked)
        assertEquals(AccessState.DENIED, report.current[PermissionType.PHONE_CALL])

        assertTrue(detector.check(permissions).revoked.isEmpty(), "a revocation is reported once")
        states[PermissionType.PHONE_CALL] = AccessState.GRANTED
        assertEquals(listOf(PermissionType.PHONE_CALL), detector.check(permissions).newlyGranted)
    }

    private val now = Instant.parse("2026-08-26T10:00:00Z")
    private fun action(ageMinutes: Long) = PendingAction("p1", "call mom", "phone.call", PendingAction.Stage.AWAITING_CONFIRMATION, now.minus(Duration.ofMinutes(ageMinutes)))

    @Test
    fun `a recent pending action after process death is offered again, never auto-run`() {
        val decision = PendingActionRecovery.decide(action(5), now)
        assertEquals("call mom", assertIs<RecoveryDecision.OfferResume>(decision).action.utterance)
    }

    @Test
    fun `an old pending action expires`() {
        assertIs<RecoveryDecision.Expired>(PendingActionRecovery.decide(action(31), now))
        assertIs<RecoveryDecision.Nothing>(PendingActionRecovery.decide(null, now))
    }
}
