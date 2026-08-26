package com.jarvismobile.data.local.reminder

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "reminders")
data class ReminderEntity(
    @PrimaryKey val id: String,
    val title: String,
    val dueAtEpochMillis: Long,
    val completed: Boolean,
)
