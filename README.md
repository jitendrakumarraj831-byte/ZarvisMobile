# ZARVIS Mobile

**ZARVIS is a personal AI digital assistant and agent platform for Web + Android.**

It is designed around one shared **ZARVIS Brain** that powers conversations, agents, memory, projects, tasks, tools, policy, permissions and verification across platforms.

## Product vision

ZARVIS should feel like **one intelligent personal agent available everywhere**:

**Understand → Plan → Ask for required access → Execute real work → Verify → Explain → Remember only when appropriate**

The product is not just a chatbot or dashboard. It is being built as a real agent platform with truthful capabilities and user-controlled permissions.

---

# 🧠 One ZARVIS Brain

Web and Android are **first-class clients of the same core system**.

```
                       ZARVIS BRAIN
                            │
              ┌─────────────┴─────────────┐
              │                           │
          WEB CLIENT                 ANDROID CLIENT
              │                           │
              └─────────────┬─────────────┘
                            │
                    Shared Agent Platform
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
        Memory            Agents            Tasks
          │                 │                 │
          └──────────── ToolPipeline ─────────┘
                            │
                     Policy + Security
                            │
                        Verification
```

The clients do not maintain separate AI brains.

## Web

The Web version is a full AI workspace for:

- Chat
- Work / Projects
- Agents
- Tasks
- Files
- Research
- Creative
- Business
- Developer workflows
- Activity
- Plans & Usage
- Settings

The responsive Web application should work across desktop, tablet and mobile browsers.

## Android

The Android version is the personal device agent.

It can progressively support authorized capabilities such as:

- Microphone and voice
- Contacts
- Phone/calling
- Notifications
- Camera
- Photos
- Files/document picker
- Location
- Calendar
- Alarms
- Bluetooth/nearby devices
- Supported Android system actions

Android permissions are controlled by Android. ZARVIS explains why access is needed, handles user decisions and verifies the real permission/tool result.

---

# Core product rules

1. **No fake capabilities.**
2. **No fake execution.**
3. **No fake verification.**
4. **No fake progress or activity.**
5. **No silent permission escalation.**
6. **Least privilege by default.**
7. **Permission and action confirmation are separate.**
8. **Every capability has a truthful status.**
9. **UI and voice states must reflect actual backend/tool state.**
10. **Sensitive actions require appropriate confirmation.**
11. **Android security cannot be bypassed.**
12. **Web and Android must use the shared Brain and common policy/tool architecture.**

Capability states:

- **WORKING** — implemented, connected, tested and verified
- **PARTIAL** — some real functionality exists
- **PLANNED** — designed but not active
- **UNSUPPORTED** — no legitimate current route

---

# Agent architecture

The common execution path is:

```
User
 ↓
Natural Language / Voice / File
 ↓
Intent
 ↓
ZARVIS Brain
 ↓
Plan
 ↓
Agent / Skill
 ↓
Capability Check
 ↓
Permission / Integration Check
 ↓
Risk Check
 ↓
Confirmation when required
 ↓
ToolPipeline
 ↓
Web API / Android API / Local Tool
 ↓
Verification
 ↓
Task / Activity State
 ↓
Response
 ↓
Voice / UI
 ↓
Memory when appropriate
```

The LLM proposes actions. Policy and tool layers decide whether they are allowed and executable. Platform security controls platform permissions. Verification determines what actually happened.

---

# A→Z implementation order

The permanent implementation order is:

1. Android Mobile Access + Permission Intelligence
2. Personal AI Core + Memory
3. Voice AI
4. Research
5. Study
6. Documents
7. Writing / Communication
8. Creative
9. Life Organizer
10. Real Task / Automation Engine
11. Phone / Device Agent
12. Notification Intelligence
13. Business Agent
14. Finance Assistant
15. Shopping Agent
16. Travel Agent
17. Universal Translation
18. Email / Communication Agent
19. Meeting Agent
20. Developer Agent
21. Skills + Multi-Agent
22. Personal Dashboard
23. Privacy + Security Center
24. Family Workspace
25. Integrations Hub
26. Smart Home / IoT

**Phase 1 is the current engineering gate. Later phases must not bypass or weaken its permission, policy and verification architecture.**

---

# Cross-device continuity

ZARVIS should allow real stored work to continue between platforms.

Example:

> Web: “Research this project.”

Later:

> Android: “जहाँ छोड़ा था वहीं से continue करो।”

The system may recover only state that was actually stored, such as:

- project
- conversation
- plan
- completed/pending steps
- files
- research
- decisions
- confirmations
- connected tools
- task state

No fake memory or fake continuity.

---

# Privacy and security

The architecture follows:

- least privilege
- data minimization
- account isolation
- ownership checks
- safe logging
- encrypted secrets
- integration revocation
- permission revocation handling
- user-controlled memory
- per-user authorization where required

Permission does not equal unlimited future authorization.

For example:

- Contacts access ≠ permission to share contacts
- Notification access ≠ permission to read everything aloud
- Phone access ≠ permission to call arbitrary targets
- File access ≠ permission to upload everything
- Accessibility ≠ universal automation

---

# Documentation

The complete product specification is maintained in the root master blueprint:

**[ZARVIS_MASTER_PRODUCT_BLUEPRINT.md](./ZARVIS_MASTER_PRODUCT_BLUEPRINT.md)**

That document contains:

- product vision
- shared Brain architecture
- Web specification
- Android specification
- page layouts
- content placement
- agent architecture
- permission model
- security model
- feature roadmap
- testing strategy
- UX states
- execution rules
- production definition of done

**Do not create separate permanent roadmap/spec/status documents unless explicitly requested. Update the master blueprint when the product architecture changes.**

---

# Development rule

Before changing code:

1. Read `ZARVIS_MASTER_PRODUCT_BLUEPRINT.md`.
2. Identify the current implementation phase.
3. Inspect existing Web and Android architecture.
4. Preserve working functionality.
5. Search for duplicate implementations.
6. Use the shared Brain, policy and ToolPipeline.
7. Keep platform-specific adapters isolated.
8. Add tests for important behavior.
9. Never mark a capability WORKING without evidence.
10. Verify Web, Android and cross-device behavior when relevant.

## Current milestone

**PHASE 1 — Android Mobile Access + Permission Intelligence**

The goal is to establish the secure, permission-aware foundation before activating later agent capabilities.

---

**ZARVIS — One Brain. Web + Android. Real Agent. Real Execution. Real Verification.**
