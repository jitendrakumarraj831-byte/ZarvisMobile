package com.zarvismobile.data.local.reminder

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface ReminderDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(reminder: ReminderEntity)

    @Query("SELECT * FROM reminders ORDER BY dueAtEpochMillis ASC")
    suspend fun getAll(): List<ReminderEntity>

    @Query("UPDATE reminders SET completed = 1 WHERE id = :id")
    suspend fun markCompleted(id: String): Int

    /** Every reminder, when the account they belong to signs out or is deleted. */
    @Query("DELETE FROM reminders")
    suspend fun deleteAll()
}
