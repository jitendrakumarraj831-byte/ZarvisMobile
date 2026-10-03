package com.zarvismobile.app

import android.app.Application
import android.os.StrictMode
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class ZarvisApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.DEBUG) {
            // Debug builds log any network call or custom slow call on the main thread, so the
            // emulator verification (scripts/emulator/verify.sh) can prove none happens.
            // Release builds are unaffected.
            StrictMode.setThreadPolicy(
                StrictMode.ThreadPolicy.Builder().detectNetwork().detectCustomSlowCalls().penaltyLog().build(),
            )
        }
    }
}
