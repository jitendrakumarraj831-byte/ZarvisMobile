package com.jarvismobile.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.jarvismobile.data.local.reminder.ReminderDao
import com.jarvismobile.data.local.reminder.ReminderEntity

@Database(entities = [ReminderEntity::class], version = 1, exportSchema = false)
abstract class JarvisDatabase : RoomDatabase() {
    abstract fun reminderDao(): ReminderDao
}
