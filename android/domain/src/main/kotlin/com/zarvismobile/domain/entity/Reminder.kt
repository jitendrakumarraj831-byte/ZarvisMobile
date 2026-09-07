package com.zarvismobile.domain.entity

import java.time.Instant

/** Backing entity for the `personal.reminder` reference skill. See SKILLS.md. */
data class Reminder(
    val id: String,
    val title: String,
    val dueAt: Instant,
    val completed: Boolean = false,
)
