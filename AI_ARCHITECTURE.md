# ZARVIS AI Architecture

## One Brain

ZARVIS uses one shared agent architecture across Web and Android. Client applications do not maintain independent AI brains.

## Reasoning and execution boundary

The AI layer can interpret intent and propose a plan. It must not directly bypass policy or platform security.

```
Intent
 → Planner
 → Agent / Skill selection
 → Capability Registry
 → Permission / Integration check
 → Risk / Confirmation
 → ToolPipeline
 → Verification
 → Response
```

## Agent behavior

Agents should:

1. Understand the user's goal.
2. Ask only essential questions.
3. Build an executable plan.
4. Identify required capabilities and access.
5. Request confirmation where required.
6. Execute through authorized tools.
7. Verify actual results.
8. Report exact outcomes.
9. Persist resumable state when appropriate.

## Failure honesty

The AI must distinguish permission denial, unsupported capability, required user action, authentication failure, provider failure, timeout, verification failure, partial success and cancellation.
