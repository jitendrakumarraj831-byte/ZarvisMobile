# ZARVIS MOBILE — MASTER A→Z PRODUCT BLUEPRINT

> **Permanent Product + UX + Architecture + Web + Android + Agent + Execution Specification**
>
> Repository: `jitendrakumarraj831-byte/ZarvisMobile`  
> Branch: `main`
>
> **Authority:** This is the single source of truth for ZARVIS product direction, shared AI brain, Web platform, Android platform, feature scope, page architecture, content placement, agent system, permissions, execution, UX states, testing and implementation order.
>
> **Core rule:** Web and Android are both first-class products. They share one ZARVIS Brain and common backend/tool/policy architecture, while each platform exposes the capabilities appropriate to it.
>
> **Build rule:** Implement in the exact phase order below. Do not jump ahead. Do not create fake functionality.

---

# 0. PRODUCT NORTH STAR

ZARVIS is a **personal AI digital assistant and agent**, not merely a chat interface or dashboard.

The final experience is:

**User request → Intent → Plan → Agent/Skill → Capability → Permission/Integration → Risk → User decision → Execute → Verify → Explain → Remember only when appropriate**

ZARVIS should work naturally across:

- Web browser
- Desktop browser
- Mobile browser
- Android app

The user should feel that they are using **one ZARVIS**, not separate products.

## Non-negotiable principles

1. No fake capabilities.
2. No fake execution.
3. No fake verification.
4. No fake progress.
5. No silent permission escalation.
6. Least privilege by default.
7. Explain access before requesting it.
8. Permission and action confirmation are separate.
9. Android remains the security authority.
10. Every feature has a truthful status: WORKING, PARTIAL, PLANNED or UNSUPPORTED.
11. UI, voice and task state must reflect real backend/tool state.
12. Preserve existing working APIs unless a deliberate migration is tested.
13. Prefer scoped platform APIs over broad access.
14. Sensitive data must not be uploaded, logged or retained unnecessarily.
15. Web and Android must never develop conflicting versions of the same core feature.

---

# 1. THE ZARVIS BRAIN — THE MOST IMPORTANT ARCHITECTURAL RULE

## 1.1 One Brain, multiple clients

ZARVIS must have one shared **ZARVIS Brain**.

```
                         ZARVIS
                           │
                    ┌──────┴──────┐
                    │ ZARVIS BRAIN │
                    └──────┬──────┘
                           │
      ┌────────────────────┼────────────────────┐
      │                    │                    │
    WEB CLIENT       ANDROID CLIENT       FUTURE CLIENTS
      │                    │                    │
      │                    │                    │
      └────────────────────┼────────────────────┘
                           │
                    SHARED PLATFORM
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
   Agent System        ToolPipeline        Policy Layer
       │                   │                   │
       ├── Memory          ├── Web APIs       ├── Risk
       ├── Context         ├── Android APIs   ├── Permission
       ├── Projects        ├── Files          ├── Confirmation
       ├── Tasks           ├── Integrations   └── Ownership
       └── Skills          └── Verification
```

### The Brain owns

- identity/context
- intent understanding
- planning
- agent orchestration
- skill selection
- conversation context
- memory
- projects/workspaces
- task state
- tool routing
- policy decisions
- risk classification
- confirmation requirements
- verification
- response generation
- AI model/provider routing, capability checks and fallback (the AI Model Gateway, see [AI_MODEL_GATEWAY.md](./AI_MODEL_GATEWAY.md))
- capability status
- cross-device continuity

### The clients own

**Web**
- browser UI
- desktop workspace
- responsive layout
- web-compatible tools
- browser permissions
- desktop productivity workflows

**Android**
- native phone/device access
- Android runtime permissions
- notification access
- contacts/calling
- camera/microphone
- scoped files/photos
- location
- calendar/alarms
- supported system actions
- Android lifecycle/process recovery

The client must never create a second independent AI brain.

## 1.2 AI Model Gateway

The Brain does not depend on one AI vendor. Every model call goes through one gateway that chooses
a provider and model by what the request needs and by what each configured model *declares* it can
do: text, streaming, tool calling, image input, structured output, long context, coding, reasoning.

- No client, skill or agent names a vendor, a model or a key.
- A model is never made to work by dropping tools or an image. A request nothing can serve fails
  honestly.
- A fallback to another provider happens only for a temporary, provider-side failure, once, and is
  never silent internally.
- A fallback never hides a real defect: rejected credentials, invalid requests, application errors
  and cancelled turns do not fall back.
- One user turn is one generation. A fallback is not a second generation, a second charge or a
  second tool execution.
- Web search keeps its real sources (Gemini with Google Search grounding) and voice keeps its own
  provider; neither is ever answered by a model that did not do the work.

Status: implemented for Gemini (primary) and OpenRouter (optional fallback). OpenRouter has not yet
been verified against the live API.

---

# 2. CROSS-DEVICE CONTINUITY

A user may start on Web and continue on Android, or start on Android and continue on Web.

Example:

**Web:** “Research this project and prepare a report.”

Later:

**Android:** “जहाँ छोड़ा था वहीं से continue करो।”

ZARVIS should recover only real stored context:

- project
- conversation
- plan
- completed steps
- pending steps
- files
- research sources
- decisions
- errors
- confirmations
- connected tools
- task state

Likewise:

**Android → Web**

A device task or conversation can become a Web workspace when appropriate.

Never claim cross-device continuity if the required state was not actually persisted.

---

# 3. WEB VERSION — FULL AI WORKSPACE

The Web version is a **first-class product**, not a simplified Android mirror.

Its advantage is screen size, productivity, multi-panel workflows and rich document/research/developer experiences.

## 3.1 Web primary navigation

Recommended desktop navigation:

1. Home
2. Chat
3. Work
4. Agents / Capabilities
5. Tasks
6. Files
7. Research
8. Creative
9. Business
10. Developer
11. Activity
12. Plans & Usage
13. Settings

On smaller screens, navigation collapses into a compact responsive structure.

## 3.2 Web Home

Purpose: personal AI command center.

Content order:

1. ZARVIS identity
2. contextual greeting
3. main Ask ZARVIS field
4. voice
5. file/image attachment
6. quick actions
7. active work
8. pending confirmations
9. recent activity
10. agent/capability shortcuts

Examples:

- “Research this for me.”
- “Summarize this PDF.”
- “Continue my project.”
- “Create a quotation.”
- “Prepare an email.”
- “Find the latest information.”
- “Open my developer workspace.”

No fake statistics or fake activity.

## 3.3 Web Chat

### Header
- conversation title
- selected agent
- connection state
- tool/agent state
- actions

### Main conversation
- user messages
- ZARVIS responses
- planning state
- tool activity
- permission explanation
- confirmation cards
- progress
- verification
- results
- citations where applicable

### Composer
- text
- microphone
- attachments
- send
- stop/cancel

### Real states

- thinking
- planning
- permission required
- confirmation required
- executing
- waiting
- verifying
- completed
- failed
- partial
- cancelled
- disconnected

Animations must represent real state, not fake activity.

## 3.4 Web Work / Projects

This is one of the most important Web-only productivity areas.

Each project/workspace can contain:

- project overview
- goal
- active agent
- conversations
- files
- tasks
- research
- generated outputs
- decisions
- activity timeline
- pending actions
- integrations
- project memory
- continue-work action

This is where long-running work should live.

## 3.5 Web Tasks

Show:

- queued
- running
- waiting
- confirmation required
- verifying
- completed
- failed
- cancelled
- blocked

Actions:

- pause
- resume
- retry
- cancel
- open result
- continue work

A task record is not proof of execution.

## 3.6 Web Files

Support where implemented:

- PDF
- DOC/DOCX
- spreadsheets
- images
- scanned documents
- OCR
- generated files

Actions:

- upload
- inspect
- summarize
- compare
- extract
- ask questions
- organize
- create output

Use real file processing only.

## 3.7 Web Research

Workspace should support:

- search
- current information
- multi-source research
- source list
- source comparison
- citations
- extracted facts
- research notes
- report generation
- concise/detailed modes

Never invent sources.

## 3.8 Web Creative Studio

Possible real capabilities:

- image understanding
- image generation where connected
- image editing where connected
- posters
- thumbnails
- social content
- presentations
- scripts
- campaigns

Unavailable capabilities must show their real state.

## 3.9 Web Developer Agent

Desktop is the primary workspace for:

- repository analysis
- code analysis
- debugging
- code generation
- code changes
- tests
- GitHub
- pull requests
- deployment workflows
- project memory

Lifecycle:

**Analyze → Plan → Confirm → Implement → Test → Verify → Report**

Never claim a test or deployment succeeded without actual evidence.

---

# 4. ANDROID VERSION — PERSONAL DEVICE AGENT

Android is not simply the Web UI inside a phone.

Its unique purpose is:

> **ZARVIS + the user's authorized Android device capabilities**

Android should provide:

- voice-first interaction
- native microphone
- contacts
- calling
- notifications
- camera
- photos
- files
- location
- calendar
- alarms
- Bluetooth/nearby-device flows
- supported system settings
- device-aware tasks
- permission intelligence

Android navigation should remain focused:

1. Home
2. Chat
3. Capabilities
4. Tasks
5. Work

Settings contains Permission/Device Access.

---

# 5. PLATFORM FEATURE MATRIX

Every major feature must have a documented platform state.

| Capability | Web | Android | Shared Brain |
|---|---|---|---|
| Chat | Yes | Yes | Yes |
| Memory | Yes | Yes | Yes |
| Projects | Yes | Yes | Yes |
| Research | Yes | Yes | Yes |
| Documents | Yes | Yes | Yes |
| Voice | Browser support | Native support | Yes |
| Tasks | Yes | Yes | Yes |
| Developer | Full workspace | Limited/mobile workflows | Yes |
| GitHub | Yes | Limited where appropriate | Yes |
| Contacts | Browser/Integration dependent | Native permission | Policy |
| Calling | Android bridge/integration | Native | Policy |
| Notifications | Limited/browser notifications | Native notification access | Policy |
| Camera | Browser permission | Native | Policy |
| Location | Browser permission | Native | Policy |
| Files | Browser picker | Android document picker | Yes |
| Photos | Browser picker | Android media APIs | Yes |
| Calendar | Integration | Android integration | Yes |
| Bluetooth | Browser/platform dependent | Native supported flows | Policy |
| System settings | Limited | Android flows | Policy |

**Important:** “Limited” or “Integration dependent” is a truthful capability state, not a promise of universal access.

---

# 6. PAGE-BY-PAGE INFORMATION ARCHITECTURE

Every page must have one clear purpose.

## Home
High-frequency actions + current personal context.

## Chat
Conversation + agent execution + confirmations + results.

## Work
Long-running projects + agents + files + resumable work.

## Agents / Capabilities
Discover what ZARVIS can really do.

## Tasks
Durable execution, schedules and progress.

## Files
Documents, images and file actions.

## Research
Search, sources and reports.

## Creative
Creation workflows.

## Business
Business workflows.

## Developer
Code/repository workflows.

## Activity
Real tool/task history.

## Plans & Usage
Plan, credits, billing and usage state.

## Settings
All configuration, permissions, privacy, memory and integrations.

Do not scatter the same setting across multiple pages without a strong UX reason.

---

# 7. AGENT PAGE STANDARD

Every major agent uses the same predictable layout.

1. Agent identity
2. What it does
3. Ask / Start task
4. Quick actions
5. Required permissions/integrations
6. Current work
7. Recent results
8. Files/context
9. Activity
10. Settings
11. Limitations

Agents:

- Personal AI
- Research
- Study
- Documents
- Writing
- Creative
- Life Organizer
- Tasks
- Phone
- Notifications
- Business
- Finance
- Shopping
- Travel
- Translation
- Email
- Meetings
- Developer
- Multi-Agent

All agents use the same Brain, policy, ToolPipeline and verification layer.

---

# 8. SETTINGS INFORMATION ARCHITECTURE

Use separate focused pages.

## General
- account
- language
- appearance
- accessibility

## Voice
- voice
- TTS
- speech recognition
- playback
- auto-speak
- interruption

## Language
- app language
- response language
- Hindi
- English
- Hinglish
- supported regional languages

## AI
- model/provider where supported
- response behavior
- reasoning options where exposed
- fallback behavior

## Notifications
- notification mode
- spoken notifications
- quiet hours
- headphones
- lock-screen
- preview policy
- sensitive-app exclusions

## Permissions / Device Access
- microphone
- contacts
- phone
- notifications
- camera
- photos
- files
- location
- calendar
- alarms
- Bluetooth
- accessibility
- usage access
- default assistant
- supported system settings

Every permission screen explains:

- why access is needed
- what data/access is involved
- what will NOT happen automatically
- how to revoke access

## Privacy
- data controls
- sensitive data
- activity
- connected accounts
- export/delete where implemented

## Memory
- remembered items
- projects
- memory controls
- forget/delete
- workspace memory

## Security
- sessions
- authentication
- connected credentials
- security events
- account controls

## Developer
- developer mode
- safe diagnostics
- integration diagnostics
- advanced agent settings

---

# 9. MASTER AGENT ARCHITECTURE

All clients and agents converge here:

`User → Input → Intent → ZARVIS Brain → Plan → Agent/Skill → Capability → Permission/Integration → Risk → Confirmation → ToolPipeline → External API/Android/Local Tool → Verification → Task/Activity State → Response → Voice/UI → Memory`

Security boundary:

`LLM → Intent → Policy Engine → Capability Registry → Permission Manager → ToolPipeline → Platform/API → Verification`

The LLM proposes.

The policy layer decides.

The tool layer executes.

Android enforces Android permissions.

The user controls sensitive authorization.

Verification determines whether something actually happened.

---

# 10. PHASE 1 — ANDROID MOBILE ACCESS + PERMISSION INTELLIGENCE

**Immediate implementation priority.**

Capability registry:

- microphone
- contacts
- phone_call
- notification_read
- notification_speak
- camera
- files
- photos
- location
- bluetooth
- alarms
- calendar
- accessibility
- usage_stats
- default_assistant
- screen_interaction

Each capability defines:

- required access
- Android/API requirements
- risk
- data exposure
- supported actions
- unsupported actions
- confirmation requirement
- denial behavior
- fallback
- revocation handling
- settings destination

## Permission flow

`Intent → Capability Planner → Permission Intelligence → Explain purpose/privacy → Allow / Not Now / Learn More → Android/System flow → verify actual state → ToolPipeline → execute → verify → text + voice`

Android is the security authority.

Never trust only a locally stored permission flag.

## Risk

- LOW
- MEDIUM
- HIGH
- VERY_HIGH

Risk descriptions must be factual.

## Permission ≠ action authorization

Contacts permission does not authorize sharing contacts.

Notification access does not authorize speaking every notification.

Phone permission does not authorize arbitrary calls.

File access does not authorize uploading everything.

Accessibility does not mean universal automation.

## Structured tool result

Every Android tool returns:

- success
- status
- capabilityId
- userSafeMessage
- retryable
- verificationEvidence

Statuses:

`COMPLETED | DENIED | PERMISSION_REQUIRED | USER_ACTION_REQUIRED | CONFIRMATION_REQUIRED | UNSUPPORTED | FAILED`

---

# 11. ANDROID ACCESS SCOPE

Implement and verify:

1. Microphone
2. Contacts
3. Calling
4. Notifications
5. Files/document picker
6. Photos
7. Camera
8. Location
9. Calendar
10. Alarms
11. Bluetooth/nearby devices
12. supported system settings
13. Permission Center
14. revocation detection
15. lifecycle/process-death recovery

Prefer scoped Android APIs and document pickers.

Never bypass Android security.

---

# 12. NOTIFICATION PRIVACY

Modes:

- Off
- App + type
- Contact + app
- Contact + app + preview
- available content

Controls:

- quiet hours
- lock-screen behavior
- headphones
- sensitive-app/content exclusions

Never invent sender names.

OTP, banking and authentication alerts should not be spoken aloud by default.

---

# 13. A→Z AGENT ROADMAP

## Cross-cutting — AI Model Gateway (a provider-independent Brain)
**Implemented:** one ModelGateway with Gemini (primary) and OpenRouter (optional fallback), declared
per-model capabilities, one controlled fallback hop, structured errors, correlation ids and log
redaction (see [AI_MODEL_GATEWAY.md](./AI_MODEL_GATEWAY.md)).

**Planned (not built; must not be presented as working):** choosing the model in Settings → AI; a
verified capability catalogue (probed or maintained) instead of operator declarations; a shared
(database) quota and cooldown state across serverless instances; provider and model on the usage
ledger; cost- and task-aware routing between models; telling the user, truthfully, when a fallback
model answered; live verification of OpenRouter in Preview and Production.

## Phase 1 — Android Access + Permission Intelligence
Permission, capability, risk, confirmation, revocation, lifecycle and verification foundation.

## Phase 2 — Personal AI Core + Memory
Conversations, context, multi-turn interaction, projects, workspaces, explicit memory, remember/forget, memory review.

## Phase 3 — Voice AI
STT, TTS, Hindi, English, Hinglish, playback, interruption, text fallback, truthful speaking state.

## Phase 4 — Research
Web search, current information, multi-source research, citations, comparisons, reports, uncertainty.

## Phase 5 — Study
PDF teacher, questions, quizzes, flashcards, revision, exam preparation, notes, language learning.

## Phase 6 — Documents
PDF, DOC/DOCX, spreadsheets where supported, OCR, extraction, comparison, reports, forms, invoices.

## Phase 7 — Writing & Communication
Email, message drafts, applications, complaints, resumes, proposals, social content, scripts, translation and rewriting.

## Phase 8 — Creative
Image understanding, generation/editing where connected, posters, thumbnails, presentations, ads, scripts.

## Phase 9 — Life Organizer
Tasks, reminders, calendar, appointments, lists, bills, routines, goals and daily planning.

## Phase 10 — Real Task & Automation Engine

Lifecycle:

`QUEUED → RUNNING → WAITING → CONFIRMATION_REQUIRED → RUNNING → VERIFYING → COMPLETED`

Alternative:

`FAILED | CANCELLED | BLOCKED`

Required:

- durable records
- scheduling
- retries
- pause/resume
- cancel
- idempotency
- ownership
- progress
- verification
- recovery
- notifications
- dependencies
- confirmation checkpoints

## Phase 11 — Phone & Device Agent
Supported apps, contacts, calls, notification understanding, file selection, camera, location and system flows.

Third-party states:

- API_AVAILABLE
- INTENT_AVAILABLE
- SHARE_FLOW_AVAILABLE
- SYSTEM_FLOW_AVAILABLE
- ACCESSIBILITY_ALLOWED_AND_SUPPORTED
- USER_ACTION_REQUIRED
- NOT_SUPPORTED

## Phase 12 — Notification Intelligence
Reader, sender/app recognition, important notifications, spoken notifications, quiet hours, headphones and exclusions.

## Phase 13 — Business
Enquiries, leads, follow-ups, quotations, invoices, catalog, customer notes, appointments, reports and marketing.

## Phase 14 — Finance
Expenses, budgets, analysis, EMI/loan calculations, savings, subscriptions, bills and financial document explanation.

Never imply bank access without a real authorized integration.

## Phase 15 — Shopping
Products, specifications, prices, reviews, warranty, alternatives and buying checklists.

Use live sources for current data.

## Phase 16 — Travel
Destinations, transport, hotels, itineraries, budgets, local information, packing and booking preparation.

## Phase 17 — Translation
Text, voice, conversation, Hindi/English, supported regional languages, message explanation and document translation.

## Phase 18 — Email / Communication
Summaries, important messages, reply drafts, follow-ups, meetings and attachments.

Never claim sending without provider confirmation.

## Phase 19 — Meeting
Preparation, agendas, notes, transcript summaries, action items, follow-up and deadlines.

## Phase 20 — Developer
Repository analysis, bugs, code, tests, GitHub, pull requests, deployment assistance and project memory.

Lifecycle:

**Analyze → Plan → Confirm → Implement → Test → Verify → Report**

## Phase 21 — Skills + Multi-Agent
Shared skill registry and specialized agents using common policy/permission/verification.

## Phase 22 — Personal Dashboard
Tasks, reminders, conversations, active agents, running work, documents, research, usage, confirmations and permission alerts.

## Phase 23 — Privacy + Security Center
Permissions, memory, connected accounts, data controls, activity, sessions, security and sensitive-data controls.

## Phase 24 — Family Workspace
Shared tasks, lists, calendars, reminders, documents, roles and member permissions.

## Phase 25 — Integrations Hub
Google, Microsoft, GitHub, cloud storage, calendar, email, officially supported business messaging APIs, productivity and billing systems.

Each integration requires connection status, scopes, revoke/disconnect, data explanation, errors and reauthorization.

## Phase 26 — Smart Home / IoT
Supported devices, routines, scenes and status through legitimate APIs/protocols.

---

# 14. “DO IT FOR ME” MODE

ZARVIS should:

1. understand the goal
2. ask only essential questions
3. build a plan
4. select skills
5. identify permissions/integrations
6. explain access
7. request sensitive confirmation
8. execute real steps
9. track progress
10. verify
11. report exactly what happened
12. leave resumable work

No fake background execution.

---

# 15. “CONTINUE MY WORK”

Recover only stored:

- project
- plan
- completed steps
- pending steps
- files
- decisions
- errors
- confirmations
- connected tools
- task state

---

# 16. ERROR + FALLBACK MODEL

Distinguish:

- permission required
- permission denied
- confirmation required
- user action required
- unsupported
- authentication required
- disconnected
- timeout
- provider error
- tool error
- verification failed
- partial success
- cancelled

Always explain the next legitimate option.

---

# 17. SAFETY + CONFIRMATION

Action classes:

- READ_ONLY
- LOW_IMPACT
- EXTERNAL_COMMUNICATION
- FINANCIAL
- DESTRUCTIVE
- SECURITY_SENSITIVE

Higher-impact actions require stronger confirmation and verification.

Permission is never unlimited future authorization.

---

# 18. DATA + PRIVACY

- least privilege
- data minimization
- account isolation
- ownership checks
- avoid sensitive logs
- encrypt secrets
- revoke disconnected integrations
- respect permission revocation
- clear data controls
- per-user authorization where required

---

# 19. TRUTHFUL PRODUCT STATUS

### WORKING
Real, connected, tested and verified.

### PARTIAL
Some real functionality exists but important pieces remain.

### PLANNED
Designed but not active.

### UNSUPPORTED
No legitimate current route.

Web UI, Android UI, API, voice and documentation must use the same status.

---

# 20. TESTING MATRIX

Every capability:

### Happy
Request → allow → execute → verify → respond

### Denied
Request → deny → fallback → explain

### Revoked
Grant → revoke → return → detect → recover

### Failure
API/tool/timeout/partial/verification failure

### Lifecycle
Background → foreground → process death → restart → reboot where relevant

### Security
Wrong user, wrong owner, missing permission, missing confirmation, stale authorization, disconnected integration.

Also test **Web ↔ Android continuity**:

- same account
- same conversation state
- same project state
- same task state
- same memory rules
- correct platform capability boundaries

---

# 21. WHOLE-PRODUCT DEFINITION OF DONE

ZARVIS is production-ready only when:

- Web is a complete first-class AI workspace
- Android is a real first-class device agent
- both use the shared ZARVIS Brain
- cross-device continuity is real
- Android access is permission-aware
- orchestration is real
- tasks are durable
- memory is user-controlled
- voice is reliable
- research has honest sources
- file handling is real
- device actions are verified
- developer actions are authorized and verified
- billing/credits are safe
- ownership is enforced
- sensitive actions require confirmation
- UI reflects actual backend state
- errors are honest
- critical paths are tested
- documentation matches implementation

---

# 22. PERMANENT CODING-AGENT RULES

Before coding:

1. Read this file completely.
2. Identify the current phase.
3. Inspect existing Web and Android architecture.
4. Inspect the shared Brain/orchestration path.
5. Inspect ToolPipeline, permissions, voice/TTS, notifications and authentication.
6. Search for duplicate implementations.
7. Preserve working APIs and behavior.
8. Do not implement later phases early.
9. Complete the active phase's A→Z UI/UX together with its real functionality.
10. Do not advance to the next phase until the current phase receives an A→Z PASS after final verification.
11. Repeat verification after every critical/high-priority fix.

While coding:

- build real functionality
- keep shared logic centralized
- keep platform-specific adapters isolated
- keep permissions centralized
- use structured results
- add tests
- keep UI truthful
- avoid unrelated rewrites
- never bypass Android
- never add fake execution
- never mark WORKING without evidence

After coding:

- compile
- test
- lint where available
- run Web flows
- run Android flows
- test cross-device state
- run security checks
- verify UI states
- verify voice states
- update this master document when architecture/status changes

**Do not create separate permanent roadmap/spec/status MD files unless explicitly requested. Keep authoritative product documentation in this root master file.**

---



---

# 22A. STRICT PHASE GATE — A→Z WORKING VERIFICATION + UI COMPLETION

This is a **non-negotiable execution rule** for every phase.

A phase is NOT complete merely because code compiles or the main feature appears on screen.

## Required phase lifecycle

```
PHASE N
  ↓
Deep-scan existing implementation
  ↓
Read applicable architecture/security requirements
  ↓
Implement feature end-to-end
  ↓
Implement A→Z UI/UX for the feature
  ↓
Connect real backend/tools/APIs
  ↓
Run automated tests
  ↓
Run integration tests
  ↓
Run platform-specific tests
  ↓
Run failure / denial / revoke / lifecycle tests
  ↓
Run security + ownership tests
  ↓
Run real-device verification where applicable
  ↓
Deep-scan for remaining bugs/regressions
  ↓
Fix ALL discovered critical/high-priority issues
  ↓
Repeat verification
  ↓
A→Z PASS
  ↓
Update feature status + documentation
  ↓
ONLY THEN start PHASE N+1
```

## A→Z implementation requirement

Every phase must be completed across **both capability and experience**.

For each feature, verify:

### A. Product behavior
- User goal is clearly defined.
- Real end-to-end flow exists.
- Empty/loading/thinking/planning states work.
- Success state works.
- Partial/failure/cancelled states work.
- Permission/confirmation states work where applicable.
- Recovery/resume behavior works where applicable.

### B. Backend / Brain
- Shared Brain integration is real.
- Intent and planning path is connected.
- Correct agent/skill is selected.
- Capability checks are enforced.
- Permission/integration checks are enforced.
- Policy/risk checks are enforced.
- ToolPipeline executes the real operation.
- Verification is real.
- Task/activity state is persisted where required.

### C. Web UI
- Complete A→Z responsive UI exists.
- Desktop, tablet and mobile layouts are checked.
- All buttons/actions are connected.
- Loading, empty, error and success states exist.
- Accessibility and keyboard/focus behavior are checked where applicable.
- UI status matches actual backend state.
- No placeholder/fake statistics/activity remain.

### D. Android UI
- Complete A→Z native/mobile UI exists where the capability applies.
- Permission explanation UI works.
- Allow / Not Now / Learn More flows work where applicable.
- Android system permission state is verified.
- Denied/revoked permission states are handled.
- Background/foreground/process-death behavior is checked.
- Voice and text fallback behavior is checked where applicable.

### E. Cross-device continuity
Where the feature is shared:
- Web can create/persist the relevant state.
- Android can recover the relevant persisted state.
- Android-created state can be recovered on Web where applicable.
- No state is fabricated.
- Platform-specific limitations remain truthful.

## Phase PASS criteria

A phase may be marked **PASS** only when:

- feature implementation is real
- A→Z UI is implemented
- real integrations/tools are connected
- automated tests pass
- integration tests pass
- platform tests pass
- relevant real-device tests pass
- negative/failure/security tests pass
- no known critical blocker remains
- high-priority regressions are fixed or explicitly documented with approval
- capability status is truthful
- documentation matches implementation
- changed behavior has been verified after the final fix

**If verification fails, the phase remains FAILING and the next phase must not begin.**

## No “UI now, functionality later” for the active phase

The active phase must receive its **complete functional UI and complete working implementation together**.

Later phases may remain Planned, but the current phase cannot be declared complete with mock screens, dead buttons, placeholder agents, fake progress or disconnected controls.

## Phase handoff record

At the end of each phase, the coding agent must produce a concise verification report containing:

- Phase name
- Features implemented
- Web UI verified
- Android UI verified
- Backend/Brain verified
- Integrations/tools verified
- Permission/security verified
- Automated test result
- Integration test result
- Real-device result where applicable
- Cross-device result where applicable
- Bugs found
- Bugs fixed
- Known limitations
- Final PASS/FAIL status
- Evidence/commands used for verification

Only a **PASS** status authorizes the next phase.


# 23. MASTER EXECUTION ORDER

```
1. Android Mobile Access + Permission Intelligence
        ↓
2. Personal AI Core + Memory
        ↓
3. Voice AI
        ↓
4. Research
        ↓
5. Study
        ↓
6. Documents
        ↓
7. Writing / Communication
        ↓
8. Creative
        ↓
9. Life Organizer
        ↓
10. Real Task / Automation Engine
        ↓
11. Phone / Device Agent
        ↓
12. Notifications
        ↓
13. Business
        ↓
14. Finance
        ↓
15. Shopping
        ↓
16. Travel
        ↓
17. Translation
        ↓
18. Email / Communication
        ↓
19. Meeting Agent
        ↓
20. Developer Agent
        ↓
21. Skills + Multi-Agent
        ↓
22. Personal Dashboard
        ↓
23. Privacy + Security Center
        ↓
24. Family Workspace
        ↓
25. Integrations
        ↓
26. Smart Home / IoT
```

**Important:** “Web-first-class” does not mean implementing every later feature before Phase 1. It means that every phase must be designed so its final implementation works correctly across the appropriate Web and Android surfaces using the shared Brain. **Each phase is a hard gate: A→Z implementation + A→Z UI + real integration + full verification must PASS before the next phase begins.**

---

# 24. FINAL PRODUCT DEFINITION

The finished ZARVIS should feel like **one intelligent personal agent available everywhere**:

> **It understands what I want, plans the work, knows which platform capabilities are available, tells me what access it needs, explains why and the privacy impact, lets me decide, performs real work through legitimate tools, verifies what happened, synchronizes useful state across Web and Android, remembers only what I allow, and clearly tells me the result.**

**Immediate engineering milestone: PHASE 1 — ANDROID MOBILE ACCESS + PERMISSION INTELLIGENCE.**

**This root-level file is the single authoritative ZARVIS A→Z product, UX, shared-brain architecture, Web specification, Android specification and execution blueprint.**
