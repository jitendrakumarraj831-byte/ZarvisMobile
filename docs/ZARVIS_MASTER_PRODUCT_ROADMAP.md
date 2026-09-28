# ZARVIS MOBILE — MASTER A→Z PRODUCT & EXECUTION BLUEPRINT

> **Status:** Permanent product baseline  
> **Repository:** `jitendrakumarraj831-byte/ZarvisMobile`  
> **Branch:** `docs/zarvis-permission-aware-agent`  
> **Primary rule:** Build in the exact order defined here. Do not jump ahead to later feature families while the earlier foundation is incomplete.  
> **First implementation priority:** **Android Mobile Access & Permission-Aware Agent Foundation.**

---

## 1. Product Vision

ZARVIS is intended to become a **personal AI digital assistant and agent**, not merely a chat UI.

The target experience is:

**Natural language → Intent → Plan → Required capability → Required permission → Risk explanation → User decision → Execute → Verify → Explain result → Learn/remember where appropriate**

ZARVIS should help with:

- talking and voice interaction;
- understanding files, images and documents;
- research and current information;
- study and learning;
- writing and communication;
- creative work;
- personal organization;
- reminders and tasks;
- phone/device actions;
- business workflows;
- developer work;
- shopping and travel research;
- personal knowledge and memory;
- integrations;
- privacy and security controls.

The user remains in control of permissions, connected accounts and sensitive actions.

---

# 2. NON-NEGOTIABLE PRODUCT PRINCIPLES

1. **No fake capabilities.**
2. **No fake execution.**
3. **No fake verification.**
4. **No silent permission escalation.**
5. **Least privilege by default.**
6. **Explain why access is needed before requesting it.**
7. **Permission and action confirmation are separate.**
8. **Android remains the security authority.**
9. **If a capability is unavailable, say so and provide the strongest legitimate fallback.**
10. **Every feature has a real status: WORKING, PARTIAL, PLANNED, or UNSUPPORTED.**
11. **Sensitive actions require appropriate confirmation.**
12. **UI, voice and task state must reflect actual backend/tool state.**
13. **Preserve existing working APIs and functionality unless a migration is deliberate and tested.**
14. **Do not request broad access when a scoped Android API can solve the task.**
15. **Privacy-sensitive data must not be uploaded or retained unnecessarily.**

---

# 3. MASTER EXECUTION ORDER

This is the permanent build order.

## PHASE 1 — ANDROID MOBILE ACCESS FOUNDATION
**Do this first. Nothing else is allowed to take priority over this phase.**

Build the permission-aware Android capability layer for:

1. Microphone
2. Contacts
3. Phone / Calling
4. Notifications
5. Files / Document Picker
6. Photos
7. Camera
8. Location
9. Calendar
10. Alarms / reminders where supported
11. Bluetooth / nearby-device flows where supported
12. Android system settings flows
13. Permission Center
14. Permission state verification
15. Permission revocation detection
16. Permission explanations
17. Risk classification
18. Action confirmation policy
19. Android lifecycle/process-death recovery
20. Tool result + verification contracts

### Phase 1 completion gate

Do not move to Phase 2 until:

- permissions are centralized;
- capability registry exists;
- permission state is checked from Android, not only local flags;
- denial is handled gracefully;
- revocation is detected;
- UI shows real status;
- voice reports real status;
- sensitive actions have confirmation;
- tool results are structured;
- tests cover allow/deny/revoke/failure paths;
- no privileged action bypasses Android.

The detailed implementation baseline is:

`docs/ZARVIS_PERMISSION_AWARE_AGENT_ARCHITECTURE.md`

---

# PHASE 2 — PERSONAL AI CORE + CONVERSATION MEMORY

Build the core intelligence layer.

## 2.1 Conversation

- persistent conversations;
- conversation titles;
- message history;
- follow-up context;
- multi-turn reasoning;
- regenerate;
- stop/cancel;
- retry;
- conversation search;
- archive/delete.

## 2.2 Personal Memory

- explicit memory;
- preferences;
- user profile;
- projects;
- recurring context;
- remember;
- forget;
- memory review;
- memory privacy controls;
- per-workspace memory.

Never treat sensitive personal information as automatically reusable without appropriate controls.

## 2.3 Personal Context

ZARVIS should understand:

- current task;
- previous steps;
- relevant documents;
- current project;
- active agent;
- pending confirmation;
- recent tool results.

---

# PHASE 3 — NATURAL VOICE AI

Build a complete voice agent loop.

### Required flow

**Listen → Understand → Think → Work → Respond → Speak → Interrupt/Stop**

Features:

- Hindi;
- English;
- Hinglish;
- supported regional languages;
- speech recognition;
- TTS;
- voice selection;
- spoken replies;
- interrupt;
- stop;
- retry;
- playback controls;
- voice-only mode;
- text fallback;
- TTS failure must never destroy a successful text response;
- speaking state must reflect real playback.

Future option:

- wake-word functionality, only if technically and policy compliant.

---

# PHASE 4 — RESEARCH AGENT

ZARVIS should be able to research rather than merely answer from static knowledge.

Features:

- web search;
- current information;
- multi-source research;
- deep research;
- source extraction;
- source comparison;
- fact extraction;
- citation support;
- source quality/context;
- research outline;
- research report;
- concise answer mode;
- detailed report mode;
- compare products/services/options.

Rules:

- never invent sources;
- clearly distinguish current web information from model knowledge;
- preserve source URLs/references where applicable;
- show uncertainty when evidence is incomplete.

---

# PHASE 5 — STUDY & EDUCATION AGENT

Features:

- PDF/book teacher;
- chapter explanation;
- question solving;
- image-based question understanding;
- MCQs;
- quizzes;
- flashcards;
- revision plans;
- exam preparation;
- notes;
- summaries;
- doubt solving;
- English learning;
- speaking practice;
- vocabulary;
- grammar;
- personalized study plans.

Flow:

**Upload/Ask → Understand → Explain → Practice → Evaluate → Revise**

---

# PHASE 6 — DOCUMENT & FILE AGENT

Support:

- PDF;
- DOC/DOCX;
- spreadsheets where supported;
- images/OCR;
- scanned documents;
- forms;
- invoices;
- quotations;
- reports;
- resumes;
- applications;
- letters.

Actions:

- summarize;
- extract;
- compare;
- explain;
- rewrite;
- find information;
- create structured output;
- answer questions from files.

Android should prefer scoped file/document selection rather than broad storage access.

---

# PHASE 7 — WRITING & COMMUNICATION AGENT

ZARVIS should create and transform:

- emails;
- WhatsApp drafts;
- SMS drafts;
- applications;
- complaints;
- resumes;
- cover letters;
- proposals;
- business messages;
- social posts;
- captions;
- blogs;
- YouTube scripts;
- replies;
- translations;
- professional rewrites;
- grammar corrections.

Communication execution must respect the platform's actual API and user confirmation requirements.

---

# PHASE 8 — CREATIVE STUDIO

Features:

- image understanding;
- image generation where supported;
- image editing where supported;
- poster concepts;
- social creatives;
- logo concepts;
- thumbnails;
- presentation content;
- ad copy;
- reel/short scripts;
- story creation;
- campaign concepts.

If image generation/editing is not connected, show the real availability instead of a fake button.

---

# PHASE 9 — LIFE ORGANIZER

Features:

- tasks;
- reminders;
- calendar;
- appointments;
- shopping list;
- bills;
- recurring tasks;
- routines;
- habits;
- goals;
- weekly planning;
- daily planning;
- daily briefing.

The task system must be durable and account-owned.

---

# PHASE 10 — REAL TASK & AUTOMATION ENGINE

This is the execution backbone.

## Task lifecycle

```
QUEUED
  ↓
RUNNING
  ↓
WAITING
  ↓
CONFIRMATION_REQUIRED
  ↓
RUNNING
  ↓
VERIFYING
  ↓
COMPLETED

Alternative:
FAILED / CANCELLED / BLOCKED
```

Features:

- durable task records;
- scheduling;
- retries;
- pause;
- resume;
- cancel;
- idempotency;
- ownership checks;
- progress;
- logs;
- verification;
- failure recovery;
- user notifications;
- dependency handling;
- confirmation checkpoints.

### Required architecture

**Plan → Schedule → Collect → Process → Generate → Execute → Verify → Notify**

Never claim a workflow executed merely because a task record was created.

---

# PHASE 11 — PHONE & DEVICE AGENT

After Phase 1 access foundation is stable, activate real device actions.

Features:

- open supported apps;
- contact lookup;
- phone calling;
- notification understanding;
- spoken notification announcements;
- file selection;
- camera launch;
- location-based features;
- system settings flows;
- supported device actions.

Third-party app capability states:

- API_AVAILABLE
- INTENT_AVAILABLE
- SHARE_FLOW_AVAILABLE
- SYSTEM_FLOW_AVAILABLE
- ACCESSIBILITY_ALLOWED_AND_SUPPORTED
- USER_ACTION_REQUIRED
- NOT_SUPPORTED

Never promise unrestricted control of every Android app.

---

# PHASE 12 — NOTIFICATION INTELLIGENCE

Features:

- notification reader where user enables it;
- sender recognition;
- app recognition;
- important notification detection;
- spoken notification mode;
- quiet hours;
- headphones mode;
- lock-screen policy;
- sensitive-app exclusions;
- preview/no-preview controls.

Example:

> “Jitendra ji, Deepak ji का नया message आया है।”

Only say a sender name when the notification actually provides it.

Sensitive content should have conservative defaults.

---

# PHASE 13 — BUSINESS AGENT

Useful for personal businesses and professional workflows.

Features:

- customer enquiries;
- leads;
- follow-ups;
- quotations;
- invoices;
- catalog;
- customer notes;
- appointment preparation;
- sales summaries;
- expense summaries;
- marketing drafts;
- social content;
- customer communication drafts;
- business reports.

Execution must be connected to real business systems before being labelled automatic.

---

# PHASE 14 — FINANCE ASSISTANT

Start with safe, user-provided/manual data.

Features:

- expense tracking;
- budgets;
- monthly analysis;
- EMI/loan calculations;
- savings goals;
- subscription tracking;
- bill reminders;
- financial document explanation.

Do not imply access to bank accounts unless a real, authorized integration exists.

Financial actions must have strong confirmation and security controls.

---

# PHASE 15 — SHOPPING AGENT

Features:

- product research;
- specifications;
- price comparison;
- review summaries;
- warranty information;
- buying checklist;
- budget-based filtering;
- alternatives;
- product comparison.

For current prices/availability, use live sources.

Do not fabricate stock, price or review data.

---

# PHASE 16 — TRAVEL AGENT

Features:

- destination research;
- transport research;
- hotel research;
- itinerary;
- budget planning;
- places to visit;
- packing list;
- local information;
- booking preparation.

Actual booking must only be reported as complete when the connected booking flow confirms it.

---

# PHASE 17 — UNIVERSAL TRANSLATOR

Support:

- text translation;
- voice translation;
- conversation translation;
- Hindi ↔ English;
- regional languages where supported;
- message explanation;
- reply drafting;
- document translation where supported.

Preserve meaning and context rather than translating word-by-word when that harms natural language.

---

# PHASE 18 — COMMUNICATION & EMAIL AGENT

Features:

- email summaries;
- important-message identification;
- reply drafts;
- follow-up reminders;
- meeting preparation;
- communication context;
- attachment understanding;
- draft organization.

Do not claim an email was sent without confirmation from the connected provider.

---

# PHASE 19 — MEETING AGENT

Features:

- meeting preparation;
- agenda;
- notes;
- transcript summary;
- action items;
- follow-up email;
- deadlines;
- task creation.

Future integrations may include supported calendar/video services.

---

# PHASE 20 — DEVELOPER AGENT

Required lifecycle:

**Analyze → Plan → Confirm → Implement → Test → Verify → Report**

Features:

- repository analysis;
- bug analysis;
- code generation;
- code changes;
- tests;
- documentation;
- debugging;
- GitHub workflows;
- pull requests;
- deployment assistance;
- project memory.

Security rules:

- no shared credential expansion;
- use per-user authorization where possible;
- never claim tests passed when they were not run;
- never claim deployment succeeded without provider evidence;
- high-impact code changes require confirmation.

---

# PHASE 21 — SKILLS & MULTI-AGENT SYSTEM

Create a common skill registry.

Core skills:

- Chat;
- Voice;
- Research;
- Study;
- PDF;
- Documents;
- Writing;
- Translation;
- Creative;
- Phone;
- Notifications;
- Tasks;
- Business;
- Finance;
- Shopping;
- Travel;
- Meetings;
- Developer.

Possible architecture:

```
ZARVIS Orchestrator
        |
        +-- Research Agent
        +-- Study Agent
        +-- Document Agent
        +-- Voice Agent
        +-- Phone Agent
        +-- Task Agent
        +-- Business Agent
        +-- Developer Agent
        +-- Creative Agent
        +-- Personal Memory
        |
        v
Shared Tool / Policy / Verification Layer
```

Specialized agents must not bypass the common policy and permission layer.

---

# PHASE 22 — PERSONAL DASHBOARD

Dashboard should show real information:

- today's tasks;
- reminders;
- recent conversations;
- active agents;
- running tasks;
- saved documents;
- recent research;
- usage/credits;
- quick actions;
- pending confirmations;
- permission alerts.

No fake activity numbers.

---

# PHASE 23 — PRIVACY & SECURITY CENTER

Provide:

- Permission Center;
- Memory Center;
- connected accounts;
- data controls;
- export where implemented;
- delete controls;
- privacy modes;
- activity history;
- active sessions;
- security settings;
- sensitive-data controls;
- notification privacy;
- account controls.

Security must be understandable to normal users, not only developers.

---

# PHASE 24 — FAMILY / SHARED WORKSPACE

Future feature family:

- family tasks;
- shopping lists;
- shared calendar;
- reminders;
- shared documents;
- member permissions;
- shared workspace;
- role-based access.

Each member's data must remain appropriately separated.

---

# PHASE 25 — INTEGRATIONS HUB

Potential integrations:

- Google;
- Microsoft;
- GitHub;
- Drive/cloud storage;
- Calendar;
- Email;
- WhatsApp/business APIs where officially supported;
- productivity tools;
- payment/billing systems.

Each integration must have:

- connection status;
- permissions/scopes;
- revoke/disconnect;
- data-access explanation;
- error state;
- reauthorization flow.

---

# PHASE 26 — SMART HOME / IOT

Longer-term feature family:

- smart lights;
- devices;
- routines;
- supported home platforms;
- scenes;
- status queries.

Only supported APIs/protocols should be used.

---

# 4. CROSS-CUTTING AGENT ARCHITECTURE

All feature families should converge on one execution architecture:

```
User
  ↓
Natural Language / Voice / File
  ↓
Intent Understanding
  ↓
Agent Orchestrator
  ↓
Plan
  ↓
Skill Selection
  ↓
Capability Check
  ↓
Permission Check
  ↓
Risk Check
  ↓
Confirmation if required
  ↓
ToolPipeline
  ↓
External API / Android / Local Tool
  ↓
Verification
  ↓
Task + Activity State
  ↓
Response
  ↓
Voice / UI
  ↓
Memory update when appropriate
```

The LLM should propose actions; policy and tool layers decide whether they are allowed and executable.

---

# 5. CAPABILITY STATUS MODEL

Every feature/capability must have exactly one truthful state:

### WORKING
Implemented, connected, tested and verified.

### PARTIAL
Some real functionality exists but important pieces remain.

### PLANNED
Architecture/design exists but implementation is not active.

### UNSUPPORTED
The platform/API does not currently provide a legitimate route.

Never use marketing language to hide an implementation gap.

---

# 6. ERROR & FALLBACK MODEL

Every agent action should distinguish:

- permission required;
- permission denied;
- confirmation required;
- user action required;
- unsupported;
- authentication required;
- integration disconnected;
- timeout;
- provider error;
- tool error;
- verification failed;
- partial success;
- cancelled.

Example:

> “Jitendra ji, Contacts access नहीं मिला, इसलिए मैं Deepak ji को name से identify नहीं कर पाया। अगर आप चाहें तो number से आगे बढ़ सकते हैं।”

This is better than a generic “Something went wrong.”

---

# 7. SAFETY / CONFIRMATION MODEL

Permissions do not equal unlimited authorization.

Examples:

- Contacts permission ≠ permission to share contacts.
- Notification access ≠ permission to read everything aloud.
- Phone permission ≠ permission to call arbitrary numbers.
- File access ≠ permission to upload all files.
- Accessibility ≠ universal automation authorization.

Suggested action classes:

- READ_ONLY
- LOW_IMPACT
- EXTERNAL_COMMUNICATION
- FINANCIAL
- DESTRUCTIVE
- SECURITY_SENSITIVE

The higher the impact, the stronger the confirmation and verification requirements.

---

# 8. “DO IT FOR ME” MODE

A flagship experience.

User:

> “ZARVIS, मेरे लिए सबसे अच्छा option research करके पूरा काम कर दो।”

ZARVIS should:

1. Understand the goal.
2. Ask only essential clarifying questions.
3. Build a plan.
4. Identify skills.
5. Identify required permissions/integrations.
6. Explain access needs.
7. Ask for sensitive confirmation where necessary.
8. Execute real steps.
9. Track progress.
10. Verify.
11. Report exactly what happened.
12. Leave a resumable task/workspace.

Never turn “Do it for me” into fake background execution.

---

# 9. “CONTINUE MY WORK”

ZARVIS should preserve project/task context.

Example:

> “जहाँ कल छोड़ा था वहीं से शुरू करो।”

It should recover:

- project;
- previous plan;
- completed steps;
- pending steps;
- relevant files;
- decisions;
- errors;
- confirmations;
- connected tools.

It must not pretend to remember something that was not stored.

---

# 10. “WHAT SHOULD I DO NEXT?”

ZARVIS can use:

- active tasks;
- deadlines;
- user-defined goals;
- pending confirmations;
- recent project state;

to propose next actions.

Recommendations should be presented as options, not silently executed.

---

# 11. DATA & PRIVACY ARCHITECTURE

Use least privilege and data minimization.

Important rules:

- store only what is needed;
- isolate user data;
- enforce account ownership;
- avoid sensitive logging;
- encrypt sensitive secrets;
- revoke disconnected integrations;
- respect permission revocation;
- provide clear data controls;
- do not use one global credential when per-user authorization is required.

---

# 12. ANDROID-SPECIFIC RULES

Android is the first implementation priority.

The Android layer must handle:

- runtime permissions;
- special permissions;
- roles;
- system settings;
- lifecycle;
- process death;
- notification access;
- scoped file access;
- camera;
- microphone;
- contacts;
- phone;
- location;
- supported device actions.

No implementation may assume that a permission available on one Android version exists identically on another.

No implementation may bypass Android security.

---

# 13. TESTING STRATEGY

For every major capability test:

### Happy path
- request;
- allow;
- execute;
- verify;
- respond.

### Denied path
- request;
- deny;
- fallback;
- explain.

### Revoked path
- grant;
- revoke from Settings;
- return to app;
- detect;
- recover.

### Failure path
- API failure;
- timeout;
- tool failure;
- partial result;
- verification failure.

### Lifecycle
- background;
- foreground;
- process death;
- restart;
- reboot where relevant.

### Security
- wrong user;
- wrong task owner;
- missing permission;
- missing confirmation;
- stale authorization;
- disconnected integration.

---

# 14. DEFINITION OF DONE FOR THE WHOLE PRODUCT

ZARVIS is considered production-ready only when:

- core Android access is real and permission-aware;
- agent orchestration is real;
- task execution is durable;
- memory is controlled by the user;
- voice loop is reliable;
- research has honest sources;
- file handling is real;
- device actions are verified;
- developer actions are authorized and verified;
- billing/credits cannot be abused;
- user ownership is enforced;
- sensitive actions have confirmation;
- UI reflects real backend state;
- error states are honest;
- tests cover critical paths;
- documentation matches implementation.

---

# 15. PERMANENT DEVELOPMENT RULE

**Do not implement all features simultaneously.**

Use this exact order:

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
18. Email / Communication Agent
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

### Critical gate

**Phase 1 — Android Mobile Access is the immediate next engineering milestone.**

Until Phase 1 is completed and verified, later feature work must not weaken or bypass the permission architecture.

---

# 16. CODING-AGENT INSTRUCTIONS

Before modifying code:

1. Read this document.
2. Read `docs/ZARVIS_PERMISSION_AWARE_AGENT_ARCHITECTURE.md`.
3. Inspect current Android architecture.
4. Inspect ToolPipeline.
5. Inspect permissions.
6. Inspect voice/TTS.
7. Inspect notification handling.
8. Inspect authentication/session ownership.
9. Inspect existing feature-status documentation.
10. Search for duplicate implementations before adding new abstractions.

While coding:

- preserve working functionality;
- avoid unrelated rewrites;
- centralize capability/permission decisions;
- use structured results;
- add tests;
- keep UI truthful;
- do not bypass Android;
- do not add fake buttons or fake execution;
- do not mark features WORKING without evidence.

After coding:

- compile;
- test;
- lint where available;
- run security checks;
- run relevant Android flows;
- update feature status;
- update implementation report;
- document limitations.

---

# 17. MASTER FEATURE CHECKLIST

## Personal AI
- [ ] Chat
- [ ] Conversation history
- [ ] Context
- [ ] Memory
- [ ] Remember/forget
- [ ] Projects
- [ ] Workspaces

## Voice
- [ ] STT
- [ ] TTS
- [ ] Hindi
- [ ] English
- [ ] Hinglish
- [ ] Interrupt
- [ ] Stop
- [ ] Voice settings
- [ ] Spoken notifications

## Android Access
- [ ] Microphone
- [ ] Contacts
- [ ] Phone
- [ ] Notifications
- [ ] Files
- [ ] Photos
- [ ] Camera
- [ ] Location
- [ ] Calendar
- [ ] Alarms
- [ ] Bluetooth
- [ ] System settings
- [ ] Permission Center
- [ ] Revocation detection
- [ ] Risk explanation
- [ ] Confirmation policy

## Agents
- [ ] Research
- [ ] Study
- [ ] Documents
- [ ] Writing
- [ ] Creative
- [ ] Life Organizer
- [ ] Task Agent
- [ ] Phone Agent
- [ ] Notification Agent
- [ ] Business
- [ ] Finance
- [ ] Shopping
- [ ] Travel
- [Translation]
- [Email
- [ ] Meetings
- [ ] Developer
- [ ] Multi-Agent

## Platform
- [ ] Dashboard
- [ ] Privacy Center
- [ ] Security Center
- [ ] Integrations
- [ ] Family Workspace
- [ ] Smart Home / IoT

---

# 18. FINAL PRODUCT DEFINITION

The finished ZARVIS should feel like a **real personal digital agent**:

> **It understands what I want, plans the work, tells me what access it needs, explains why and what the privacy impact is, lets me decide, uses only the capabilities I granted, performs real work through legitimate tools, verifies what happened, remembers only what I allow, and clearly tells me the result.**

That is the permanent A→Z product direction.

**Immediate next step: PHASE 1 — ANDROID MOBILE ACCESS + PERMISSION INTELLIGENCE.**
