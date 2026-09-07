# PRIVACY

User-facing companion to [MASTER_SPEC.md §17 (Memory) and §27 (Privacy Strategy)](./MASTER_SPEC.md#27-privacy-strategy).
This document describes the product's data handling in plain language. It will be
finalized with legal review before any public launch; until then it is the binding
internal policy engineering builds against.

## What ZARVIS MOBILE stores about you

| Data | Stored? | Retention |
|---|---|---|
| Conversation turns (current session) | Yes, to maintain context | Cleared when you clear the conversation, or after a session-timeout window |
| Long-term memory ("remember this...") | Only when you explicitly approve it | Until you delete it or delete your account |
| Tasks and their step history | Yes, so you can see progress/results | Until you delete the task or your account |
| Documents/files you share for a task | Only for the duration needed to complete that task, unless you save the result | Transient by default |
| Usage/credit history | Yes (billing-relevant) | Retained as required for billing/audit, summarized in Settings |
| Account/profile (email, plan) | Yes | Until account deletion |
| Voice audio | Processed for speech-to-text; raw audio is not retained beyond transcription | Not retained |

## What we never do automatically

- We never permanently store sensitive categories (financial details, health information,
  credentials-adjacent data) from a conversation without your explicit "remember this"
  approval for that specific item.
- We never use your conversation or document content to train models without a separate,
  explicit opt-in (not enabled in this build).
- We never send your data to an AI provider or external service beyond what a specific
  skill needs to complete the task you asked for.

## Your controls

Available today in the architecture (Settings → Memory & Data), enforced by the backend,
not just hidden by client UI:

- **View** everything the assistant remembers about you.
- **Delete** an individual memory item.
- **Clear** the current conversation.
- **Clear all data** (memories, task history) while keeping your account.
- **Export** your data.
- **Delete your account**, which cascades to memory, tasks, and usage history (subscription
  records are retained only as required for billing/legal compliance).

## Analytics

Product analytics are aggregate and event-based only — e.g. "a task in category X
succeeded," "a screen was viewed," latency/error counts. We do not log raw conversation
content, document content, or file contents as analytics events. See
[SECURITY.md](./SECURITY.md) for the technical redaction mechanism that enforces this.

## Third parties

AI provider calls, web research, and document processing are proxied through our backend
(see [AI_ARCHITECTURE.md](./AI_ARCHITECTURE.md)) so no third-party service receives your
account credentials. Structured web-research results always carry their source URL so you
can verify claims independently.

## Changes to this policy

Because this repository is under active development, this document may change as features
ship. [MASTER_SPEC.md](./MASTER_SPEC.md) is updated first for any change in data-handling
behavior, and this file is kept in sync with it — see the root instruction in
MASTER_SPEC.md that the spec and implementation must never silently diverge.
