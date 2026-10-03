# ZARVIS Architecture

## Source of truth

The complete architecture is maintained in [ZARVIS_MASTER_PRODUCT_BLUEPRINT.md](./ZARVIS_MASTER_PRODUCT_BLUEPRINT.md).

## Shared Brain

Web and Android are first-class clients of one shared Brain.

```
User
  ↓
Input
  ↓
Intent
  ↓
ZARVIS Brain
  ↓
Plan
  ↓
Agent / Skill
  ↓
Capability + Permission + Risk
  ↓
Confirmation when required
  ↓
ToolPipeline
  ↓
Platform/API
  ↓
Verification
  ↓
Task / Activity State
  ↓
Response + Voice/UI
  ↓
Memory when appropriate
```

## Boundaries

- LLM proposes; policy decides.
- ToolPipeline executes authorized operations.
- Android remains the authority for Android permissions.
- Verification determines actual outcome.
- AI providers sit behind the AI Model Gateway ([AI_MODEL_GATEWAY.md](./AI_MODEL_GATEWAY.md)); nothing else names a vendor, a model or a key.
- Shared logic belongs in shared Brain/services.
- Web and Android adapters handle platform-specific APIs.

## Cross-device continuity

Only persisted project, conversation, plan, task, file, decision, confirmation and integration state may be resumed on another device. No fabricated continuity is allowed.
