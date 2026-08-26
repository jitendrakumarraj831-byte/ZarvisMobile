package com.jarvismobile.data.local.reminder

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
}
