package com.zarvismobile.domain.presentation

/**
 * What to tell the user when the phone's speech recogniser stops without a transcript, from Android's error code
 * (`android.speech.SpeechRecognizer.ERROR_*`, numbered here because this module has no Android dependency). Hearing nothing or
 * nothing it could match is the most common outcome of tapping the microphone, not a failure: the chat goes back to waiting,
 * with a hint, instead of showing an error state and a code number.
 */
object SpeechErrors {
    const val NETWORK_TIMEOUT = 1
    const val NETWORK = 2
    const val AUDIO = 3
    const val SERVER = 4
    const val CLIENT = 5
    const val SPEECH_TIMEOUT = 6
    const val NO_MATCH = 7
    const val RECOGNIZER_BUSY = 8
    const val INSUFFICIENT_PERMISSIONS = 9
    const val TOO_MANY_REQUESTS = 10
    const val SERVER_DISCONNECTED = 11
    const val LANGUAGE_NOT_SUPPORTED = 12
    const val LANGUAGE_UNAVAILABLE = 13

    /** [isError] false: nothing went wrong (the user said nothing it could recognise), so the screen is not put in its error state. */
    data class Outcome(val text: UiString, val isError: Boolean)

    /** [code] is Android's error code; `null` means this phone has no speech recognition service at all. */
    fun describe(code: Int?): Outcome = when (code) {
        null -> Outcome(UiString.VOICE_UNAVAILABLE, isError = true)
        SPEECH_TIMEOUT, NO_MATCH -> Outcome(UiString.VOICE_NOT_HEARD, isError = false)
        NETWORK_TIMEOUT, NETWORK, SERVER, SERVER_DISCONNECTED -> Outcome(UiString.VOICE_NETWORK, isError = true)
        AUDIO -> Outcome(UiString.VOICE_AUDIO, isError = true)
        RECOGNIZER_BUSY, TOO_MANY_REQUESTS -> Outcome(UiString.VOICE_BUSY, isError = true)
        INSUFFICIENT_PERMISSIONS -> Outcome(UiString.VOICE_PERMISSION_OFF, isError = true)
        LANGUAGE_NOT_SUPPORTED, LANGUAGE_UNAVAILABLE -> Outcome(UiString.VOICE_LANGUAGE, isError = true)
        else -> Outcome(UiString.VOICE_FAILED, isError = true)
    }
}
