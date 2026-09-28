# ZARVIS Permission-Aware AI Agent Architecture

> **Document type:** Product + Android architecture specification  
> **Status:** Implementation blueprint  
> **Goal:** Make ZARVIS a realistic, permission-aware personal digital agent that explains access requirements, risks, capabilities and limitations before performing device-level actions.

---

## 1. Product Vision

ZARVIS should not behave like an app that silently asks for every possible permission.

It should behave like a **permission-aware AI agent**:

1. Understand what the user is asking.
2. Determine which Android capability or permission is actually required.
3. Explain **why** the access is needed.
4. Explain what ZARVIS can and cannot do with that access.
5. Explain the privacy/security implications in simple language.
6. Let the user choose **Allow, Not Now, or Learn More**.
7. Request only the required Android permission or system access.
8. Verify whether access was actually granted.
9. Execute only within the granted capability.
10. If access is denied, continue with the rest of the task where possible.
11. Never bypass Android security or claim a capability that is unavailable.
12. Report the real result after execution.

The user remains in control of permissions and sensitive actions.

---

## 2. Core Principle

### ZARVIS does not own permissions.

Android owns permissions.

ZARVIS owns the **explanation, orchestration, user experience and capability routing** around those permissions.

The architecture must never assume:

- every permission can be granted at installation time;
- every permission can be requested with a normal runtime dialog;
- every Android setting can be changed programmatically;
- every third-party app exposes an API;
- Accessibility can legitimately replace every missing API;
- notification access means ZARVIS can automatically send replies;
- a permission being technically available means it should always be requested.

---

## 3. Permission Intelligence Layer

Create a dedicated permission/capability abstraction instead of scattering permission checks throughout the Android codebase.

Suggested architecture:

```
User Intent
    |
    v
ZARVIS Agent Orchestrator
    |
    v
Capability Planner
    |
    v
Permission Intelligence
    |
    +---- required access?
    |
    +---- current status?
    |
    +---- risk level?
    |
    +---- supported on this Android version?
    |
    +---- app/policy limitation?
    |
    v
Permission Explanation UI
    |
    +---- Allow
    +---- Not Now
    +---- Learn More
    |
    v
Android/System Permission Flow
    |
    v
Verify Actual Access
    |
    v
ToolPipeline
    |
    v
Execute
    |
    v
Verify Result
    |
    v
Natural Text + Voice Response
```

---

## 4. Capability Registry

Create one authoritative capability registry.

Each capability should contain:

- stable capability ID;
- user-facing name;
- description;
- required Android permission/access;
- permission type;
- Android API level requirements;
- whether access is runtime, special access, role-based or system-settings based;
- risk level;
- data that may become accessible;
- what ZARVIS can do;
- what ZARVIS cannot do;
- whether confirmation is required before execution;
- denial behavior;
- revocation detection;
- fallback capability;
- privacy explanation;
- settings destination when applicable.

Example capability IDs:

```
microphone
contacts
phone_call
notification_read
notification_speak
camera
files
photos
location
bluetooth
alarms
calendar
accessibility
usage_stats
default_assistant
screen_interaction
```

Do not request a capability merely because it exists in the registry.

The Agent should request access only when the current user goal requires it, unless the user explicitly chooses an optional onboarding setup.

---

## 5. Permission Risk Model

Use a simple, understandable risk model.

### LOW

Examples:

- basic microphone use when actively recording;
- selected file access;
- basic device capability that exposes little personal information.

### MEDIUM

Examples:

- contacts;
- calendar;
- location;
- photos/files depending on scope.

### HIGH

Examples:

- notification content;
- broad communication access;
- persistent background-related access;
- powerful automation capabilities.

### VERY HIGH / ADVANCED

Examples:

- Accessibility-based interaction;
- broad screen/UI interaction;
- highly sensitive personal data access.

Risk labels are informational, not fear-based.

ZARVIS must not manipulate the user into granting access.

---

## 6. Natural Permission Explanation

Never show only:

> Allow ZARVIS to access X?

First provide context.

Example:

### Notification Access

> **Jitendra ji, ZARVIS को Notification Access चाहिए।**
>
> इससे मैं आपके फोन पर आने वाले notifications पहचान सकता हूँ।  
> उदाहरण के लिए, Deepak ji का message या कोई important alert आने पर मैं आपको बता सकता हूँ।
>
> **Privacy:** इस access से notification content ZARVIS को उपलब्ध हो सकता है। इसलिए इसे तभी enable करें जब आपको यह सुविधा चाहिए।
>
> **You can turn this off anytime from Android Settings.**
>
> **[Allow Access] [Not Now] [Learn More]**

The exact wording must be configurable and localized.

---

## 7. Personalized Spoken Notifications

If the user explicitly enables notification voice assistance, ZARVIS can use the contact/app information available in the notification.

Examples:

> “Jitendra ji, Deepak ji का एक नया WhatsApp message आया है।”

> “Jitendra ji, Abhimanyu ji आपको call कर रहे हैं।”

> “Jitendra ji, आपके लिए एक important notification आया है।”

If a contact name is unavailable:

> “Jitendra ji, WhatsApp पर एक नया message आया है।”

Never invent a sender name.

Never infer a person's identity from unrelated information.

---

## 8. Notification Privacy Modes

Provide explicit user controls:

```
Notification Voice Mode

○ Off
○ App + notification type only
○ Contact/app name
○ Contact/app name + message preview
○ Read available notification content
```

Additional controls:

```
Quiet Hours
Lock-screen behavior
Headphones-only mode
Bluetooth/headset behavior
Sensitive-app exclusions
Sensitive-content exclusions
Read only when screen is unlocked
Read only after user asks
```

Potentially sensitive notification categories such as OTPs, authentication codes, banking alerts or private content should have conservative defaults.

ZARVIS must not announce sensitive content loudly by default.

---

## 9. Microphone

When voice interaction needs microphone access:

> “Jitendra ji, आपकी आवाज़ समझने के लिए microphone access चाहिए। आप इसे allow नहीं करेंगे तो text chat फिर भी काम करेगी।”

Requirements:

- request at the correct moment;
- show active listening state;
- stop recording cleanly;
- handle denial;
- handle Android microphone privacy indicators;
- never claim microphone access when it is unavailable;
- preserve typed text if voice fails.

---

## 10. Contacts

Purpose:

- identify a person by saved contact name;
- support contact-aware calling or communication flows.

Example:

> “Deepak ji को पहचानने के लिए मुझे आपके Contacts access की जरूरत है।”

Privacy explanation:

> “इससे आपके saved contacts की जानकारी access हो सकती है।”

Rules:

- do not upload the entire contacts database unnecessarily;
- use the minimum data needed;
- prefer local contact lookup where possible;
- do not expose contacts to unrelated features;
- if permission is denied, allow direct-number flows where Android/API support permits.

---

## 11. Phone / Calling

Example:

> “Call करने के लिए phone capability चाहिए। अगर आप permission नहीं देते हैं तो मैं call शुरू नहीं कर पाऊँगा, लेकिन number तैयार करके दे सकता हूँ जहाँ supported हो।”

For:

> “Deepak ji को call करो।”

Flow:

```
Resolve contact
    ->
Confirm target
    ->
Check required access
    ->
Request if missing
    ->
Execute supported call action
    ->
Verify
    ->
Speak result
```

Do not silently call an ambiguous contact.

---

## 12. Files, Photos and Camera

ZARVIS should request narrow access where Android provides scoped mechanisms.

Examples:

> “इस PDF को पढ़ने के लिए आपको पूरी storage access देने की जरूरत नहीं है। आप सिर्फ यह file select कर सकते हैं।”

Prefer:

- Android document picker;
- scoped media access;
- one-time selection;
- explicit camera invocation;
- minimal data retention.

Avoid broad storage permissions when a scoped API solves the use case.

---

## 13. Location

Location should be requested only for a feature that needs it.

Example:

> “आपके आसपास की जगहें खोजने के लिए मुझे location चाहिए। आप चाहें तो यह access अभी न दें और location manually भी बता सकते हैं।”

Controls:

- approximate/precise where supported;
- foreground/background distinction;
- one-time/while-in-use where supported;
- clear fallback.

Never request continuous background location just because it might be useful later.

---

## 14. Device Settings and System Controls

ZARVIS may expose supported Android actions through dedicated APIs/intents/system flows.

Example:

> “Jitendra ji, Bluetooth से जुड़े इस action के लिए Android system control खोलना जरूरी है। मैं आपको system screen पर ले जा सकता हूँ।”

The agent must distinguish:

```
DIRECTLY_SUPPORTED
SYSTEM_SCREEN_REQUIRED
USER_CONFIRMATION_REQUIRED
NOT_SUPPORTED
```

Never claim:

> “Bluetooth on कर दिया”

unless the action was actually completed and verified.

---

## 15. Accessibility / Advanced Interaction

Accessibility must be treated as an **advanced capability**, not a universal bypass.

Before enabling it:

> “यह ZARVIS का advanced interaction access है। इससे supported screen elements के साथ interaction संभव हो सकता है। इसमें privacy implications ज्यादा हो सकते हैं। इसे तभी enable करें जब आपको संबंधित automation सुविधा की जरूरत हो।”

Rules:

- explain why it is needed;
- explain what data/UI may become accessible;
- use narrower APIs whenever possible;
- do not use Accessibility merely to bypass an unavailable API;
- do not automate restricted/sensitive actions without appropriate user confirmation;
- obey Android and Google Play policies;
- provide an easy way to disable it.

---

## 16. Third-Party App Reality

ZARVIS must maintain a capability matrix for external apps.

Possible states:

```
API_AVAILABLE
INTENT_AVAILABLE
SHARE_FLOW_AVAILABLE
SYSTEM_FLOW_AVAILABLE
ACCESSIBILITY_ALLOWED_AND_SUPPORTED
USER_ACTION_REQUIRED
NOT_SUPPORTED
```

For example, a user may ask:

> “WhatsApp पर Deepak ji को message भेजो।”

ZARVIS should determine the strongest legitimate route.

If direct sending is unavailable:

> “Jitendra ji, मैं message तैयार कर सकता हूँ और WhatsApp खोल सकता हूँ, लेकिन इस device/app configuration में direct sending उपलब्ध नहीं है।”

Never fake completion.

---

## 17. Confirmation Policy

Permissions and actions are different concepts.

A user granting permission does **not** automatically authorize every future action.

Examples:

- Notification access granted ≠ permission to read every message aloud.
- Contacts granted ≠ permission to share contacts.
- Phone permission granted ≠ permission to call arbitrary numbers without confirmation.
- Accessibility enabled ≠ permission to perform sensitive actions without confirmation.
- Files access granted ≠ permission to upload every file.

Create a separate action-risk policy.

Suggested action levels:

```
READ_ONLY
LOW_IMPACT
EXTERNAL_COMMUNICATION
FINANCIAL
DESTRUCTIVE
SECURITY_SENSITIVE
```

High-impact actions should require explicit confirmation where appropriate.

---

## 18. Agent Decision Example

User:

> “ZARVIS, Deepak ji का message पढ़कर बताओ।”

Agent:

```
1. Intent = read_notification
2. Required capability = notification_read
3. Check access
4. If unavailable:
   explain access + risk
   ask user
5. If allowed:
   find relevant notification
6. Apply notification privacy mode
7. Read/summarize
8. Speak result
```

If permission is denied:

> “ठीक है Jitendra ji। Notification access नहीं दिया गया है, इसलिए मैं अभी उस message को नहीं पढ़ सकता।”

No repeated permission nagging.

---

## 19. Permission Center

Create a dedicated Android screen:

```
ZARVIS ACCESS CENTER

Core Access
────────────────────────

🎙 Microphone             Allowed
👤 Contacts               Allowed
📞 Phone                  Allowed
🔔 Notifications          Allowed
📁 Files                  Not granted
📍 Location               Not granted
📷 Camera                 Allowed

Advanced Access
────────────────────────

⚠ Notification Reader     Enabled
⚠ Accessibility            Disabled

Privacy
────────────────────────

Notification Voice        Contact + App
Quiet Hours               11:00 PM - 07:00 AM
Sensitive Notifications   Protected

[Review Android Settings]
```

Every row must show:

- current status;
- purpose;
- risk;
- what feature depends on it;
- revoke/manage action where possible.

---

## 20. Permission State Machine

Every capability should have an explicit state.

```
UNKNOWN
  |
  v
EXPLANATION_SHOWN
  |
  +---- NOT_NOW
  |
  +---- USER_CHOSE_ALLOW
              |
              v
       SYSTEM_PERMISSION
              |
       +------+------+
       |             |
    GRANTED        DENIED
       |             |
       v             v
   AVAILABLE       UNAVAILABLE
       |
       v
      REVOKED (if later disabled)
```

The app must re-check the actual Android state rather than trusting its own stored boolean.

---

## 21. Revocation Handling

If a user disables access in Android Settings:

ZARVIS should detect it when the app returns to foreground or before the relevant action.

Example:

> “Jitendra ji, आपने Notification Access बंद कर दिया है। इसलिए मैं अब notifications पढ़ नहीं सकता। बाकी ZARVIS features सामान्य रूप से available हैं।”

Never crash because a previously granted permission disappeared.

---

## 22. Onboarding

Do not request every permission in one giant sequence by default.

Recommended onboarding:

### Step 1 — Basic ZARVIS

- account/session;
- language;
- voice preference;
- basic app settings.

### Step 2 — Explain optional capabilities

```
Voice Assistant
Phone Agent
Notification Assistant
File Assistant
Location Assistant
Advanced Automation
```

### Step 3 — User chooses

> “आप कौन-सी सुविधाएँ अभी enable करना चाहते हैं?”

### Step 4 — Request only selected access.

### Step 5 — Test

ZARVIS performs a small safe verification:

> “Microphone तैयार है।”
>
> “Notification access उपलब्ध है।”
>
> “Contacts access उपलब्ध है।”

---

## 23. Voice UX

Voice responses should feel respectful and natural.

Default address:

> “Jitendra ji…”

But this must be configurable.

Settings:

```
How ZARVIS addresses me

○ Jitendra
○ Jitendra ji
○ My name
○ No name
```

Do not hardcode a user's name into the architecture.

---

## 24. Privacy Rules

ZARVIS must follow these product principles:

1. Least privilege.
2. Explain before requesting.
3. User decides.
4. No silent escalation.
5. No permission bypass.
6. No fake execution.
7. No fake verification.
8. No unnecessary data collection.
9. No unnecessary cloud upload.
10. Local processing where practical.
11. Sensitive content gets conservative defaults.
12. Revoked access is respected immediately.
13. Permission status is visible to the user.
14. Logs should avoid sensitive content.
15. User can disable optional capabilities.

---

## 25. Agent Tool Contract

Every Android tool should expose structured metadata.

Example conceptual contract:

```ts
type AgentCapability = {
  id: string;
  name: string;
  description: string;

  requiredAccess: string[];

  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

  executionMode:
    | "DIRECT"
    | "SYSTEM_FLOW"
    | "USER_CONFIRMATION"
    | "USER_ACTION"
    | "UNSUPPORTED";

  canExecute(context): Promise<boolean>;

  explainAccess(context): PermissionExplanation;

  requestAccess(context): Promise<PermissionResult>;

  execute(input, context): Promise<ToolResult>;

  verify(result, context): Promise<VerificationResult>;
};
```

The exact implementation may differ, but the architectural separation should remain.

---

## 26. Tool Result Contract

Never return only a generic error.

Use structured results:

```ts
type ToolResult = {
  success: boolean;

  status:
    | "COMPLETED"
    | "DENIED"
    | "PERMISSION_REQUIRED"
    | "USER_ACTION_REQUIRED"
    | "CONFIRMATION_REQUIRED"
    | "UNSUPPORTED"
    | "FAILED";

  capabilityId: string;

  message: string;

  userSafeMessage: string;

  retryable: boolean;

  verification?: {
    verified: boolean;
    evidence?: string;
  };
};
```

This lets the UI and voice layer tell the truth.

---

## 27. Agent + UI Integration

The UI should never display a generic “Working...” forever.

Example:

```
ZARVIS

Checking notification access...
        ↓
Access required
        ↓
Why I need it
        ↓
Privacy impact
        ↓
[Allow] [Not Now] [Learn More]
        ↓
Access granted
        ↓
Reading notification...
        ↓
Verified
        ↓
“Jitendra ji, Deepak ji का message आया है.”
```

---

## 28. Security Boundaries

Never allow the model itself to directly execute privileged Android operations.

Use:

```
LLM
 ↓
Intent
 ↓
Policy Engine
 ↓
Capability Registry
 ↓
Permission Manager
 ↓
ToolPipeline
 ↓
Android API
 ↓
Verification
```

The model proposes.

The policy/tool layer decides.

Android enforces permissions.

The user confirms sensitive actions.

---

## 29. What ZARVIS Must Never Do

- silently grant itself permissions;
- hide why access is required;
- claim access that was denied;
- read private content aloud by default;
- invent contact names;
- send messages without a legitimate execution path;
- change restricted settings by bypassing Android;
- use Accessibility as a universal workaround;
- upload private data unnecessarily;
- keep using a permission after the user revoked it;
- tell the user an action succeeded without verification;
- pressure users to enable high-risk access;
- disguise a high-risk capability as low-risk;
- silently perform destructive or financial actions.

---

## 30. Implementation Order

### Phase A — Foundation

- capability registry;
- permission manager;
- permission state model;
- risk metadata;
- Android version compatibility;
- structured tool results.

### Phase B — Core Android Access

- microphone;
- contacts;
- phone;
- notifications;
- files/document picker;
- camera;
- location.

### Phase C — Permission Center

- access dashboard;
- explanations;
- status;
- risk information;
- revocation detection;
- Android Settings deep links.

### Phase D — Notification Agent

- notification listener;
- sender/app recognition;
- privacy modes;
- spoken notification engine;
- quiet hours;
- sensitive notification handling.

### Phase E — Phone Agent

- contact resolution;
- call flow;
- app opening;
- supported system actions;
- confirmation;
- result verification.

### Phase F — Advanced Agent

- capability planner;
- multi-step execution;
- policy engine;
- confirmation engine;
- task engine;
- memory integration.

### Phase G — Advanced Access

Only after policy/security review:

- Accessibility;
- advanced UI interaction;
- deeper device integrations.

---

## 31. Testing Requirements

Test all combinations:

### Permission

- first request;
- allow;
- deny;
- deny twice;
- revoke from Settings;
- permission unavailable on Android version;
- app restart;
- process death;
- device reboot.

### Notification

- known contact;
- unknown sender;
- no sender;
- sensitive notification;
- multiple notifications;
- notification removed;
- quiet hours;
- headphones;
- locked screen.

### Voice

- microphone allowed;
- microphone denied;
- recognition failure;
- TTS failure;
- interrupted speech;
- user stops agent.

### Phone

- known contact;
- duplicate contact names;
- unknown contact;
- raw number;
- permission denied;
- call failure;
- user cancellation.

### Tool execution

- success;
- timeout;
- unsupported;
- permission required;
- user action required;
- confirmation required;
- partial failure;
- verification failure.

---

## 32. Definition of Done

A capability is **WORKING** only when all are true:

- real Android/API integration exists;
- permission state is checked;
- explanation exists;
- denial is handled;
- errors are handled;
- sensitive actions have appropriate confirmation;
- execution is verified;
- UI reflects the real state;
- voice reflects the real state;
- no fake success state exists;
- tests cover the important paths;
- Android version limitations are documented;
- privacy implications are documented.

If any major requirement is missing, mark the capability **PARTIAL**, not WORKING.

---

## 33. Cursor / Coding Agent Instructions

Any coding agent working on ZARVIS must follow these rules.

### Before coding

1. Inspect the existing Android architecture.
2. Inspect ToolPipeline.
3. Inspect current permission handling.
4. Inspect current voice/TTS implementation.
5. Inspect current notification implementation.
6. Inspect authentication and user/session context.
7. Inspect existing feature status documents.
8. Search for duplicate or conflicting permission logic.
9. Identify the correct Android API for each capability.
10. Check Android and Google Play policy constraints before implementing advanced access.

### While coding

- preserve existing working functionality;
- do not rewrite unrelated modules;
- use the capability registry;
- use least privilege;
- keep permission checks centralized;
- do not bypass Android;
- add structured tool results;
- add logging without sensitive content;
- handle lifecycle/process death;
- support revocation;
- keep UI, voice and backend state synchronized.

### After coding

Run:

- Kotlin/Java compilation;
- unit tests;
- Android lint where available;
- relevant integration tests;
- static permission/API audit;
- duplicate permission-request audit;
- capability status audit.

Update:

- `ZARVIS_FEATURE_STATUS.md`;
- relevant architecture documentation;
- implementation report.

Never mark a feature WORKING without evidence.

---

## 34. Final Product Goal

The final experience should feel like:

> **“ZARVIS understands what I want to do, explains what access it needs, tells me why it needs it and what the privacy risk is, lets me decide, performs the task using only the access I granted, verifies the result, and respectfully tells me what happened.”**

That is the target architecture for a trustworthy **ZARVIS Personal Digital Agent**.

---

## 35. Important Platform Constraint

This document intentionally does **not** promise unrestricted access to every Android application or setting.

Android security, permission models, system APIs, application APIs, Android version differences, device manufacturers and Google Play policies can limit what an application can legitimately automate.

The implementation must always choose the strongest **supported and policy-compliant** route and clearly communicate limitations to the user.

---

**Document status:** Ready to be used as the permission-aware architecture baseline for future ZARVIS engineering work.
