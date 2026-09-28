# ZARVIS Master Specification

This file is a root-level navigation/compatibility document.

The authoritative product and technical specification for ZARVIS is:

**[ZARVIS_MASTER_PRODUCT_BLUEPRINT.md](./ZARVIS_MASTER_PRODUCT_BLUEPRINT.md)**

Do not maintain conflicting requirements here. When architecture, product behavior, security, permissions, UX, or execution rules change, update the master blueprint first.

## Product identity

ZARVIS is a Web + Android personal AI assistant and agent platform built around one shared ZARVIS Brain.

**Core flow:** Understand → Plan → Check access → Confirm when required → Execute → Verify → Explain → Remember appropriately.

## Platform model

- Web: full AI workspace.
- Android: personal device agent with native Android capabilities.
- Shared Brain: intent, planning, memory, agents, tasks, policy, tools, verification and cross-device state.
- Platform adapters: Web APIs and Android APIs remain implementation-specific.

See the master blueprint for the complete A→Z specification.
