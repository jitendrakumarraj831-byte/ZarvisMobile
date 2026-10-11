package com.zarvismobile.feature.conversation

import kotlinx.coroutines.flow.Flow

/**
 * The two settings the Chat screen reads: the app language (voice input and read-aloud follow it) and whether replies are spoken. It is
 * an interface so the screen's view model can be tested on the JVM; the app binds it to its saved preferences (`AppModule`).
 */
interface ChatPreferences {
    val locale: Flow<String>
    val autoSpeak: Flow<Boolean>
}
