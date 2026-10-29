package com.zarvismobile.domain.presentation

/**
 * Requests a Chat control sends on the user's behalf. They stay in English whatever the app's language, so the on-device router
 * always recognises them (DeviceCommandRoutingTest sends each one through the real catalogue); the control's own name is translated.
 */
object ChatRequests {
    /** The photo button by Chat's field: pick one photo in the system picker and have ZARVIS describe it (`photos.describe_photo`). */
    const val DESCRIBE_PHOTO = "Describe a photo"
}
