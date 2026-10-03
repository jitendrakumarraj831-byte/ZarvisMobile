/**
 * Phase 1 Capability Registry — the single source of truth for every device/platform
 * capability ZARVIS can ask for (ZARVIS_MASTER_PRODUCT_BLUEPRINT.md §10, §11, §19).
 *
 * This TypeScript module is authoritative. `shared/capability-registry.json` is a generated
 * copy (`npm run capabilities:export`) that the Android domain module's own typed registry
 * is checked against in its unit tests, and `test/capabilities/registry.test.ts` fails if the
 * JSON drifts from this file. Web, Android, the API and voice all read the same statuses.
 *
 * Status rules (blueprint §19): WORKING only with real verification evidence. Nothing on
 * Android is WORKING yet because no real-device verification has been recorded; implemented
 * capabilities are PARTIAL with a note saying exactly what exists and what is unverified.
 */

export type RiskClass = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export type ActionClass =
  | "READ_ONLY"
  | "LOW_IMPACT"
  | "EXTERNAL_COMMUNICATION"
  | "FINANCIAL"
  | "DESTRUCTIVE"
  | "SECURITY_SENSITIVE";

export type CapabilityStatus = "WORKING" | "PARTIAL" | "PLANNED" | "UNSUPPORTED";

export type SpecialAccess = "NOTIFICATION_LISTENER" | "ACCESSIBILITY_SERVICE" | "USAGE_ACCESS" | "ASSISTANT_ROLE";

export type CapabilityId =
  | "microphone"
  | "contacts"
  | "phone_call"
  | "notification_read"
  | "notification_speak"
  | "camera"
  | "files"
  | "photos"
  | "location"
  | "bluetooth"
  | "alarms"
  | "calendar"
  | "accessibility"
  | "usage_stats"
  | "default_assistant"
  | "screen_interaction";

export interface PlatformState {
  status: CapabilityStatus;
  /** Exactly what exists and what does not — shown verbatim in Web/Android Permission Centers. */
  note: string;
}

export interface CapabilityDefinition {
  id: CapabilityId;
  name: string;
  /** What access the capability needs, in plain language. */
  requiredAccess: string;
  /** Android runtime permissions requested for this capability (empty = none / system flow). */
  androidPermissions: string[];
  /**
   * Special access Android grants only on its own Settings page (never a runtime dialog).
   * Names match the Android client's PermissionType enum.
   */
  androidSpecialAccess: SpecialAccess[];
  /** Other Android/API requirements (API level gates, system services, intents). */
  androidRequirements: string;
  risk: RiskClass;
  /** The strongest action class any supported action of this capability performs. */
  actionClass: ActionClass;
  dataExposure: string;
  supportedActions: string[];
  unsupportedActions: string[];
  /** "PER_ACTION": every action needs its own explicit confirmation; "NONE": permission gate only. */
  confirmation: "NONE" | "PER_ACTION";
  denialBehavior: string;
  fallback: string;
  revocationHandling: string;
  /** Where the user changes this access. */
  settingsDestination: string;
  rationale: {
    why: string;
    data: string;
    notAutomatic: string;
    revoke: string;
  };
  platforms: { web: PlatformState; android: PlatformState };
}

const ANDROID_UNVERIFIED = "Implemented in code; not yet verified on a real device, so it is not marked WORKING.";

export const CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    id: "microphone",
    name: "Microphone",
    requiredAccess: "Record audio while you are speaking to ZARVIS.",
    androidPermissions: ["android.permission.RECORD_AUDIO"],
    androidSpecialAccess: [],
    androidRequirements: "A speech recognition service must be installed (SpeechRecognizer.isRecognitionAvailable).",
    risk: "MEDIUM",
    actionClass: "READ_ONLY",
    dataExposure: "Audio is converted to text by the device's speech service; the text is sent to the ZARVIS backend as your request.",
    supportedActions: ["Speech-to-text after you tap the microphone"],
    unsupportedActions: ["Wake word", "Background or continuous listening", "Recording audio to a file"],
    confirmation: "NONE",
    denialBehavior: "Voice input is disabled; typing keeps working.",
    fallback: "Type your request.",
    revocationHandling: "Checked every time listening starts; a revoked permission returns you to text input.",
    settingsDestination: "Android Settings > Apps > ZARVIS > Permissions > Microphone",
    rationale: {
      why: "To turn what you say into a request when you tap the microphone.",
      data: "Your voice while listening is active. Nothing is recorded when the microphone is off.",
      notAutomatic: "ZARVIS never listens in the background and has no wake word.",
      revoke: "Turn off Microphone for ZARVIS in Android Settings at any time.",
    },
    platforms: {
      web: { status: "PARTIAL", note: "Browser speech recognition after you tap Speak, where the browser supports it (e.g. Chrome)." },
      android: { status: "PARTIAL", note: `Android SpeechRecognizer after a tap. ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "contacts",
    name: "Contacts",
    requiredAccess: "Read contact names and phone numbers stored on this phone.",
    androidPermissions: ["android.permission.READ_CONTACTS"],
    androidSpecialAccess: [],
    androidRequirements: "ContactsContract provider.",
    risk: "MEDIUM",
    actionClass: "READ_ONLY",
    dataExposure: "The matching contact's name and number are read on the device and shown to you. They are not uploaded.",
    supportedActions: ["Find a contact's number by name", "Resolve a name before a call you confirm"],
    unsupportedActions: ["Sharing contacts", "Editing or deleting contacts", "Uploading your address book"],
    confirmation: "NONE",
    denialBehavior: "Name lookups stop; calling a raw phone number still works with Phone permission.",
    fallback: "Say or type the phone number instead of a name.",
    revocationHandling: "Checked before every lookup; a revoked permission returns PERMISSION_REQUIRED.",
    settingsDestination: "Android Settings > Apps > ZARVIS > Permissions > Contacts",
    rationale: {
      why: "To find the number of a person you name, for example \"find Mom's number\".",
      data: "Contact names and phone numbers, read on your phone only for the name you asked about.",
      notAutomatic: "ZARVIS does not upload, share or change your contacts.",
      revoke: "Turn off Contacts for ZARVIS in Android Settings at any time.",
    },
    platforms: {
      web: { status: "UNSUPPORTED", note: "Browsers cannot read your phone's contacts. Use the Android app." },
      android: { status: "PARTIAL", note: `Name lookup via ContactsContract. ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "phone_call",
    name: "Phone calls",
    requiredAccess: "Place a phone call from this phone.",
    androidPermissions: ["android.permission.CALL_PHONE"],
    androidSpecialAccess: [],
    androidRequirements: "Telephony hardware and a dialer that handles ACTION_CALL.",
    risk: "HIGH",
    actionClass: "EXTERNAL_COMMUNICATION",
    dataExposure: "The number you confirm is passed to the phone's dialer. Call charges may apply.",
    supportedActions: ["Call a number or a named contact after you confirm the exact number"],
    unsupportedActions: ["Calling without your confirmation", "Answering, recording or ending calls", "Reading call history"],
    confirmation: "PER_ACTION",
    denialBehavior: "No call is placed. ZARVIS can show the number so you can dial it yourself.",
    fallback: "Dial the number yourself.",
    revocationHandling: "Checked immediately before the call; a revoked permission returns PERMISSION_REQUIRED.",
    settingsDestination: "Android Settings > Apps > ZARVIS > Permissions > Phone",
    rationale: {
      why: "To place a call you ask for, after you confirm who and which number.",
      data: "The phone number you confirm.",
      notAutomatic: "Phone permission never lets ZARVIS call anyone without a separate confirmation for that exact call.",
      revoke: "Turn off Phone for ZARVIS in Android Settings at any time.",
    },
    platforms: {
      web: { status: "UNSUPPORTED", note: "Browsers cannot place phone calls. Use the Android app." },
      android: { status: "PARTIAL", note: `ACTION_CALL after a per-call confirmation showing the resolved number. Verification is limited to the dialer accepting the intent. ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "notification_read",
    name: "Notification access",
    requiredAccess: "Read the notifications currently in your status bar (Android notification listener).",
    androidPermissions: [],
    androidSpecialAccess: ["NOTIFICATION_LISTENER"],
    androidRequirements:
      "ZARVIS's NotificationListenerService turned on by you in Settings > Notification access (Android 8+). On Android 13+ an app installed outside Google Play must first be given \"Allow restricted settings\" in App info.",
    risk: "HIGH",
    actionClass: "READ_ONLY",
    dataExposure:
      "The app name, category, and — depending on your privacy mode — sender and text of notifications in your status bar. Read on the phone when you ask; never stored or uploaded by ZARVIS.",
    supportedActions: [
      "Show a summary of your current notifications when you ask (after confirming each time)",
      "Apply your privacy mode: Off, App + type, Contact + app, Contact + app + preview, or Available content",
      "Hide OTP, banking and authentication alerts unless you choose to include them",
      "Skip apps you exclude",
    ],
    unsupportedActions: [
      "Replying to, dismissing or acting on notifications",
      "Keeping a history of notifications or uploading them",
      "Guessing a sender name Android didn't provide",
    ],
    confirmation: "PER_ACTION",
    denialBehavior: "ZARVIS can't see notifications; asking to read them explains how to turn access on.",
    fallback: "Open the notification shade yourself.",
    revocationHandling:
      "Checked live before every read; Android disconnects the listener immediately when access is turned off, and the Permissions page shows it on the next resume.",
    settingsDestination: "Android Settings > Apps > Special app access > Notification access > ZARVIS",
    rationale: {
      why: "So you can ask ZARVIS what notifications you have, and — if you turn it on — hear new ones spoken.",
      data: "Notifications other apps post, which can include messages and one-time codes. They stay on this phone.",
      notAutomatic:
        "ZARVIS never reads notifications to you unless you ask (or turn on spoken notifications), never acts on them, and hides security and banking alerts by default.",
      revoke: "Turn off Notification access for ZARVIS in Android Settings at any time; reading stops immediately.",
    },
    platforms: {
      web: { status: "UNSUPPORTED", note: "Browsers can't read other apps' notifications. Use the Android app." },
      android: { status: "PARTIAL", note: `NotificationListenerService with §12 privacy modes. ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "notification_speak",
    name: "Spoken notifications",
    requiredAccess: "Speak new notifications aloud, following your notification privacy rules.",
    androidPermissions: [],
    androidSpecialAccess: ["NOTIFICATION_LISTENER"],
    androidRequirements: "Notification access (above) plus an Android text-to-speech engine on the phone.",
    risk: "MEDIUM",
    actionClass: "LOW_IMPACT",
    dataExposure:
      "What your privacy mode allows (by default only the app and type, e.g. \"Message from WhatsApp\") is spoken through the speaker or headphones. Speech is generated on the phone; nothing is sent to ZARVIS servers.",
    supportedActions: [
      "Turn spoken notifications on or off (Settings > Notifications, or by asking)",
      "Quiet hours, headphones-only, lock-screen behaviour and per-app exclusions",
      "Never speak OTP, banking or authentication alerts unless you choose to",
    ],
    unsupportedActions: ["Speaking notifications from before it was turned on", "Replying to notifications by voice"],
    confirmation: "NONE",
    denialBehavior: "Nothing is spoken. Spoken notifications stay off until you turn them on.",
    fallback: "Ask \"read my notifications\" to see them on screen.",
    revocationHandling:
      "Speaking stops the moment notification access is turned off, and every notification is checked against your current settings before it is spoken.",
    settingsDestination: "ZARVIS Settings > Notifications",
    rationale: {
      why: "So you can hear who or what needs your attention without looking at the phone.",
      data: "Notification details allowed by your privacy mode, spoken aloud.",
      notAutomatic: "Off by default. Security and banking alerts are never spoken by default; quiet hours and headphones-only apply.",
      revoke: "Say \"stop speaking notifications\" or switch it off in ZARVIS Settings > Notifications.",
    },
    platforms: {
      web: { status: "UNSUPPORTED", note: "Not available in a browser." },
      android: { status: "PARTIAL", note: `On-device TextToSpeech driven by the notification listener. ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "camera",
    name: "Camera",
    requiredAccess: "Take a photo using the phone's camera app.",
    androidPermissions: [],
    androidSpecialAccess: [],
    androidRequirements: "A camera app that handles ACTION_IMAGE_CAPTURE. ZARVIS does not declare the CAMERA permission.",
    risk: "MEDIUM",
    actionClass: "READ_ONLY",
    dataExposure: "Only a small preview of the photo you take is returned to ZARVIS; it is shown to you and not uploaded or stored.",
    supportedActions: ["Take a photo with the system camera and show a preview"],
    unsupportedActions: ["Recording video", "Taking photos without you pressing the shutter", "Uploading or analyzing the photo (later phase)"],
    confirmation: "NONE",
    denialBehavior: "If you cancel the camera, nothing is captured.",
    fallback: "Choose an existing photo instead.",
    revocationHandling: "No runtime permission is held; each capture is a separate user action.",
    settingsDestination: "Not applicable — ZARVIS uses the system camera app.",
    rationale: {
      why: "To capture a photo when you ask.",
      data: "The photo you take, as a preview.",
      notAutomatic: "ZARVIS never opens the camera by itself and never takes a photo without you pressing the shutter.",
      revoke: "There is no standing permission; just cancel the camera app.",
    },
    platforms: {
      web: { status: "PLANNED", note: "Browser camera capture is not implemented." },
      android: { status: "PARTIAL", note: `System camera capture preview only; no storage or analysis. ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "files",
    name: "Files",
    requiredAccess: "Open a document you choose with the system file picker.",
    androidPermissions: [],
    androidSpecialAccess: [],
    androidRequirements: "Storage Access Framework (ACTION_OPEN_DOCUMENT). No storage permission.",
    risk: "MEDIUM",
    actionClass: "READ_ONLY",
    dataExposure: "Only the file you pick. Its name, type and size are shown to you.",
    supportedActions: ["Pick one document and show its name, type and size"],
    unsupportedActions: ["Browsing your storage", "Reading files you did not pick", "Uploading the file from Android (later phase)"],
    confirmation: "NONE",
    denialBehavior: "If you cancel the picker, nothing is read.",
    fallback: "Paste the text instead.",
    revocationHandling: "Access is per-pick; nothing persists after the action.",
    settingsDestination: "Not applicable — the system picker grants one-time access.",
    rationale: {
      why: "To work with a document you choose.",
      data: "Only the file you select.",
      notAutomatic: "ZARVIS cannot see any other file, and picking a file does not upload it.",
      revoke: "Nothing to revoke — access ends with the action.",
    },
    platforms: {
      web: { status: "PARTIAL", note: "Browser file picker; PDF/DOCX/text are extracted by the backend for the chat. Files are not stored." },
      android: { status: "PARTIAL", note: `System document picker; shows the chosen file's metadata only. ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "photos",
    name: "Photos",
    requiredAccess: "Choose a photo with the system photo picker.",
    androidPermissions: [],
    androidSpecialAccess: [],
    androidRequirements: "Android Photo Picker (PickVisualMedia). No media permission.",
    risk: "MEDIUM",
    actionClass: "READ_ONLY",
    dataExposure: "Only the photo you pick.",
    supportedActions: ["Pick one photo and show its details"],
    unsupportedActions: ["Browsing your gallery", "Reading photos you did not pick", "Uploading from Android (later phase)"],
    confirmation: "NONE",
    denialBehavior: "If you cancel the picker, nothing is read.",
    fallback: "Describe the photo in text.",
    revocationHandling: "Access is per-pick; nothing persists.",
    settingsDestination: "Not applicable — the system picker grants one-time access.",
    rationale: {
      why: "To work with a photo you choose.",
      data: "Only the photo you select.",
      notAutomatic: "ZARVIS cannot see your gallery.",
      revoke: "Nothing to revoke — access ends with the action.",
    },
    platforms: {
      web: { status: "PARTIAL", note: "Attach an image; it is analyzed by the backend's Gemini vision model when configured." },
      android: { status: "PARTIAL", note: `System photo picker; shows the chosen photo's metadata only. ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "location",
    name: "Location",
    requiredAccess: "Your approximate (coarse) location when you ask for it.",
    androidPermissions: ["android.permission.ACCESS_COARSE_LOCATION"],
    androidSpecialAccess: [],
    androidRequirements: "Location services turned on; LocationManager.",
    risk: "MEDIUM",
    actionClass: "READ_ONLY",
    dataExposure: "Approximate latitude/longitude, shown to you. Not uploaded or stored.",
    supportedActions: ["Show your approximate current location"],
    unsupportedActions: ["Precise location", "Background location", "Tracking or sharing your location"],
    confirmation: "NONE",
    denialBehavior: "Location is not read.",
    fallback: "Tell ZARVIS the place by name.",
    revocationHandling: "Checked before every read; a revoked permission returns PERMISSION_REQUIRED.",
    settingsDestination: "Android Settings > Apps > ZARVIS > Permissions > Location",
    rationale: {
      why: "To answer \"where am I\" style requests.",
      data: "Your approximate location, only when you ask.",
      notAutomatic: "ZARVIS never reads location in the background and never shares it.",
      revoke: "Turn off Location for ZARVIS in Android Settings at any time.",
    },
    platforms: {
      web: { status: "PLANNED", note: "Browser geolocation is not implemented." },
      android: { status: "PARTIAL", note: `Coarse location on request via LocationManager. ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "bluetooth",
    name: "Bluetooth",
    requiredAccess: "Open Bluetooth settings so you can connect a device.",
    androidPermissions: [],
    androidSpecialAccess: [],
    androidRequirements: "Settings.ACTION_BLUETOOTH_SETTINGS. No Bluetooth permission is declared.",
    risk: "MEDIUM",
    actionClass: "LOW_IMPACT",
    dataExposure: "None — the system settings screen handles pairing.",
    supportedActions: ["Open Bluetooth settings"],
    unsupportedActions: ["Scanning, pairing or connecting devices automatically", "Turning Bluetooth on or off silently"],
    confirmation: "NONE",
    denialBehavior: "Not applicable.",
    fallback: "Open Bluetooth from the quick settings panel.",
    revocationHandling: "No permission is held.",
    settingsDestination: "Android Settings > Connected devices",
    rationale: {
      why: "To take you to Bluetooth settings when you ask.",
      data: "None.",
      notAutomatic: "ZARVIS does not pair or connect devices for you.",
      revoke: "Nothing to revoke.",
    },
    platforms: {
      web: { status: "UNSUPPORTED", note: "Not available in the browser." },
      android: { status: "PARTIAL", note: `System settings flow only (USER_ACTION_REQUIRED). ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "alarms",
    name: "Alarms & reminders",
    requiredAccess: "Post reminder notifications, and hand alarms to the Clock app.",
    androidPermissions: ["android.permission.POST_NOTIFICATIONS"],
    androidSpecialAccess: [],
    androidRequirements:
      "POST_NOTIFICATIONS is a runtime permission only on Android 13+; on Android 8–12 notifications are controlled by the app's notification setting. Reminders use an exact alarm on Android 8–12, and on 13+ when you allow ZARVIS in Settings > Alarms & reminders; without that, Android may deliver a reminder up to 10 minutes late. Alarms use AlarmClock.ACTION_SET_ALARM (normal SET_ALARM permission).",
    risk: "LOW",
    actionClass: "LOW_IMPACT",
    dataExposure: "Reminder text is stored on this phone only.",
    supportedActions: ["Create a reminder at a time you state", "List reminders", "Hand an alarm to the Clock app for you to save"],
    unsupportedActions: ["Guessing a time you did not state", "Deleting alarms in the Clock app"],
    confirmation: "NONE",
    denialBehavior: "Reminders are not created, because they could not notify you.",
    fallback: "Set the alarm in the Clock app yourself.",
    revocationHandling: "Re-checked when the reminder fires; if notifications were turned off, nothing is shown.",
    settingsDestination: "Android Settings > Apps > ZARVIS > Notifications",
    rationale: {
      why: "To notify you at the time you set a reminder for.",
      data: "The reminder text and time, stored on your phone.",
      notAutomatic: "ZARVIS only notifies you about reminders you created.",
      revoke: "Turn off notifications for ZARVIS in Android Settings at any time.",
    },
    platforms: {
      web: { status: "UNSUPPORTED", note: "Browser notifications are not implemented." },
      android: { status: "PARTIAL", note: `Reminders via AlarmManager + notification; alarms via the Clock app. ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "calendar",
    name: "Calendar",
    requiredAccess: "Open a pre-filled event in your calendar app for you to save.",
    androidPermissions: [],
    androidSpecialAccess: [],
    androidRequirements: "A calendar app that handles Intent.ACTION_INSERT on CalendarContract.Events. No calendar permission is declared.",
    risk: "MEDIUM",
    actionClass: "LOW_IMPACT",
    dataExposure: "The event title and time are passed to your calendar app.",
    supportedActions: ["Open a pre-filled new event for you to review and save"],
    unsupportedActions: ["Reading your calendar", "Saving events without you", "Editing or deleting events"],
    confirmation: "NONE",
    denialBehavior: "Not applicable.",
    fallback: "Add the event in your calendar app yourself.",
    revocationHandling: "No permission is held.",
    settingsDestination: "Not applicable — your calendar app saves the event.",
    rationale: {
      why: "To prepare an event you describe.",
      data: "The event details you gave.",
      notAutomatic: "The event is only saved if you tap Save in your calendar app.",
      revoke: "Nothing to revoke.",
    },
    platforms: {
      web: { status: "PLANNED", note: "Calendar integrations are planned for the Integrations Hub." },
      android: { status: "PARTIAL", note: `Pre-filled insert flow (USER_ACTION_REQUIRED). ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "accessibility",
    name: "Accessibility service",
    requiredAccess: "ZARVIS's accessibility service, used only for the phone navigation you ask for.",
    androidPermissions: [],
    androidSpecialAccess: ["ACCESSIBILITY_SERVICE"],
    androidRequirements:
      "AccessibilityService turned on by you in Settings > Accessibility. Lock screen needs Android 9+. On Android 13+ an app installed outside Google Play must first be given \"Allow restricted settings\". Google Play distribution requires Play's Accessibility API declaration.",
    risk: "VERY_HIGH",
    actionClass: "SECURITY_SENSITIVE",
    dataExposure: "While on, Android lets the service see what is on screen. ZARVIS only reads it at the moment you ask for an action; nothing is logged or uploaded.",
    supportedActions: [
      "Back, Home, Recent apps, open the notification shade, open quick settings, lock the screen — each confirmed first",
    ],
    unsupportedActions: [
      "Universal or background automation",
      "Typing text, entering passwords or PINs",
      "Acting inside Android Settings, permission or install screens (ZARVIS will not grant itself access)",
      "Acting while you haven't asked",
    ],
    confirmation: "PER_ACTION",
    denialBehavior: "Phone navigation by voice is unavailable; everything else keeps working.",
    fallback: "Use the phone's own navigation buttons or gestures.",
    revocationHandling: "Android unbinds the service the moment you turn it off; every action checks the live state first.",
    settingsDestination: "Android Settings > Accessibility > ZARVIS",
    rationale: {
      why: "So you can navigate your phone by voice — Back, Home, Recent apps, notifications, quick settings, lock screen.",
      data: "Android gives accessibility services access to screen content. ZARVIS reads it only when you ask for an action.",
      notAutomatic:
        "Accessibility never means universal automation: every action is one you asked for and confirmed, and ZARVIS never taps inside Android's security or permission screens.",
      revoke: "Turn ZARVIS off in Android Settings > Accessibility; it stops immediately.",
    },
    platforms: {
      web: { status: "UNSUPPORTED", note: "Not available in a browser." },
      android: { status: "PARTIAL", note: `AccessibilityService global actions with per-action confirmation. ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "usage_stats",
    name: "Usage access",
    requiredAccess: "See which apps you used today and for how long (Android usage access).",
    androidPermissions: ["android.permission.PACKAGE_USAGE_STATS"],
    androidSpecialAccess: ["USAGE_ACCESS"],
    androidRequirements: "Usage access turned on for ZARVIS in Settings > Usage access (a special app-op, not a runtime dialog).",
    risk: "HIGH",
    actionClass: "READ_ONLY",
    dataExposure: "Per-app foreground time for today, read from Android when you ask and shown to you. Not stored or uploaded.",
    supportedActions: ["Show today's screen time and your most-used apps when you ask (after confirming each time)"],
    unsupportedActions: ["Tracking in the background", "Blocking or limiting apps", "Usage history beyond today"],
    confirmation: "PER_ACTION",
    denialBehavior: "Screen-time questions explain how to turn usage access on.",
    fallback: "Android Settings > Digital Wellbeing shows screen time.",
    revocationHandling: "The app-op is checked live before every read; turning it off takes effect immediately.",
    settingsDestination: "Android Settings > Apps > Special app access > Usage access > ZARVIS",
    rationale: {
      why: "So you can ask how much you've used your phone today and which apps took the most time.",
      data: "Which apps you opened today and for how long.",
      notAutomatic: "ZARVIS reads it only when you ask, never tracks you in the background, and never uploads it.",
      revoke: "Turn off Usage access for ZARVIS in Android Settings at any time.",
    },
    platforms: {
      web: { status: "UNSUPPORTED", note: "Browsers can't see app usage." },
      android: { status: "PARTIAL", note: `UsageStatsManager (today, foreground time). ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "default_assistant",
    name: "Default assistant",
    requiredAccess: "Be chosen as the phone's default digital assistant, so the assist gesture opens ZARVIS.",
    androidPermissions: [],
    androidSpecialAccess: ["ASSISTANT_ROLE"],
    androidRequirements:
      "An activity that handles android.intent.action.ASSIST; you choose ZARVIS in Settings > Default apps > Digital assistant app. Verifying the choice needs Android 10+ (RoleManager). Always-on wake-word detection needs the privileged CAPTURE_AUDIO_HOTWORD permission, which Android only grants to system apps.",
    risk: "MEDIUM",
    actionClass: "LOW_IMPACT",
    dataExposure: "None beyond opening ZARVIS: ZARVIS does not request the screen content Android can hand to assistants.",
    supportedActions: ["Open ZARVIS over the current app with the assist gesture (long-press Home / corner swipe) and start listening"],
    unsupportedActions: [
      "A \"Hey ZARVIS\" wake word (Android reserves hotword detection for system apps)",
      "Reading the screen behind it automatically",
      "Choosing itself as the default (only you can, in Android Settings)",
    ],
    confirmation: "NONE",
    denialBehavior: "The assist gesture keeps opening your current assistant; open ZARVIS from its icon instead.",
    fallback: "Open ZARVIS from the launcher.",
    revocationHandling: "Checked with RoleManager on every resume; choosing another assistant is reflected immediately.",
    settingsDestination: "Android Settings > Apps > Default apps > Digital assistant app",
    rationale: {
      why: "So a long-press on Home (or a corner swipe) opens ZARVIS over whatever you're doing.",
      data: "No extra data: ZARVIS doesn't read the screen when you invoke it.",
      notAutomatic: "ZARVIS never listens until you invoke it — there is no wake word.",
      revoke: "Pick a different digital assistant (or None) in Android Settings > Default apps.",
    },
    platforms: {
      web: { status: "UNSUPPORTED", note: "Not available in a browser." },
      android: { status: "PARTIAL", note: `ACTION_ASSIST activity; role verified with RoleManager on Android 10+. ${ANDROID_UNVERIFIED}` },
    },
  },
  {
    id: "screen_interaction",
    name: "Screen interaction",
    requiredAccess: "Read the visible text of, or tap one labelled button in, the app you're using — through ZARVIS's accessibility service.",
    androidPermissions: [],
    androidSpecialAccess: ["ACCESSIBILITY_SERVICE"],
    androidRequirements:
      "Accessibility service on (see Accessibility service). The app must be visible behind ZARVIS, which you open over it with the assist gesture.",
    risk: "VERY_HIGH",
    actionClass: "SECURITY_SENSITIVE",
    dataExposure: "Text visible in the one app you're using, read when you ask and shown only to you. Password fields are never read.",
    supportedActions: [
      "Read the visible text of the app behind ZARVIS (confirmed each time)",
      "Tap one uniquely labelled button, e.g. \"tap Next\" (confirmed each time, result verified)",
    ],
    unsupportedActions: [
      "Password fields, banking, payment, authenticator and password-manager apps",
      "Android Settings, permission, install and system screens",
      "Buttons that pay, buy, delete, sign in, grant access or accept terms",
      "Typing, swiping, multi-step automation or acting in the background",
    ],
    confirmation: "PER_ACTION",
    denialBehavior: "Screen reading and tapping are unavailable.",
    fallback: "Read or tap the screen yourself.",
    revocationHandling: "Needs the accessibility service live at the moment of the action; turning it off stops it immediately.",
    settingsDestination: "Android Settings > Accessibility > ZARVIS",
    rationale: {
      why: "So you can ask ZARVIS to read what's on screen or press a button by voice.",
      data: "The text of the app you're using, only when you ask.",
      notAutomatic: "Every read or tap is one you asked for and confirmed. Sensitive apps, password fields and security screens are always off-limits.",
      revoke: "Turn ZARVIS off in Android Settings > Accessibility.",
    },
    platforms: {
      web: { status: "UNSUPPORTED", note: "Browsers can't see or control other apps." },
      android: { status: "PARTIAL", note: `Accessibility node reading and ACTION_CLICK with safety blocks. ${ANDROID_UNVERIFIED}` },
    },
  },
];

/**
 * What the shared Brain is told about device capabilities (blueprint §1 "one Brain, multiple
 * clients"; §9 "the LLM proposes, the policy layer decides"). Generated from this registry so
 * the model's picture of what exists can never drift from what the clients actually do.
 */
export function deviceCapabilitiesForPrompt(): string {
  const lines = CAPABILITIES.map((c) => {
    const where = [
      c.platforms.android.status === "WORKING" || c.platforms.android.status === "PARTIAL" ? "Android app" : null,
      c.platforms.web.status === "WORKING" || c.platforms.web.status === "PARTIAL" ? "web" : null,
    ].filter(Boolean);
    return `- ${c.name}: ${where.length ? `available in the ${where.join(" and ")}` : "not available anywhere yet"}` +
      (c.confirmation === "PER_ACTION" ? "; each action needs the user's explicit confirmation" : "") + ".";
  });
  return (
    "Device capabilities (phone features) are executed only by the ZARVIS client on the user's own device, " +
    "after the user grants Android/browser access — never by you and never through your tools. " +
    "If the user asks for one here, do not claim you did it or can see the data: say which app can do it " +
    "(and that the phone will ask for access) or give the manual way. Capability registry:\n" +
    lines.join("\n")
  );
}

export function findCapability(id: string): CapabilityDefinition | undefined {
  return CAPABILITIES.find((capability) => capability.id === id);
}

const RISK_RANK: Record<RiskClass, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, VERY_HIGH: 3 };

/**
 * Action policy (blueprint §17): the policy layer decides whether an action needs its own
 * explicit confirmation. It can only ever *add* a confirmation requirement on top of what a
 * skill declares — never remove one — so a mis-declared skill cannot weaken the gate.
 */
export function policyRequiresConfirmation(actionClass: ActionClass, risk: RiskClass): boolean {
  if (
    actionClass === "EXTERNAL_COMMUNICATION" ||
    actionClass === "FINANCIAL" ||
    actionClass === "DESTRUCTIVE" ||
    actionClass === "SECURITY_SENSITIVE"
  ) {
    return true;
  }
  return RISK_RANK[risk] >= RISK_RANK.HIGH;
}
