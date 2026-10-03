package com.zarvismobile.core.security

/** The key/value surface token handling needs, so it can be tested without the Android Keystore. */
interface SecretStore {
    fun putString(key: String, value: String)
    fun getString(key: String): String?
    fun remove(key: String)
}
