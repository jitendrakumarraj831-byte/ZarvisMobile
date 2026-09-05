package com.zarvismobile.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.zarvismobile.data.local.reminder.ReminderDao
import com.zarvismobile.data.local.reminder.ReminderEntity

@Database(entities = [ReminderEntity::class], version = 1, exportSchema = false)
abstract class ZarvisDatabase : RoomDatabase() {
    abstract fun reminderDao(): ReminderDao
}
