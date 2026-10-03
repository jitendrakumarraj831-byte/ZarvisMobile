# ZARVIS Security

Security requirements are governed by [ZARVIS_MASTER_PRODUCT_BLUEPRINT.md](./ZARVIS_MASTER_PRODUCT_BLUEPRINT.md).

## Security principles

- Least privilege by default.
- Explicit user authorization for sensitive access.
- Account and ownership isolation.
- Never bypass Android security boundaries.
- Do not expose secrets in logs.
- Revoke disconnected integrations.
- Re-check permissions at execution time.
- Verify sensitive and external actions after execution.
- Keep capability status truthful.

## Permission is not action authorization

- Contacts access ≠ permission to share contacts.
- Notification access ≠ permission to read everything aloud.
- Phone access ≠ permission to call arbitrary targets.
- File access ≠ permission to upload everything.
- Accessibility ≠ universal automation.

## Risk classes

Actions are evaluated as LOW, MEDIUM, HIGH or VERY_HIGH risk. High-impact actions require appropriate confirmation and policy checks.

## Required result states

Tool execution should expose truthful states such as COMPLETED, DENIED, PERMISSION_REQUIRED, USER_ACTION_REQUIRED, CONFIRMATION_REQUIRED, UNSUPPORTED, and FAILED.

## AI provider keys and logs

- `GEMINI_API_KEY` and `OPENROUTER_API_KEY` are server-side only: never in the web client, the
  Android app, a response or an error message. The browser's Content-Security-Policy keeps
  `connect-src 'self'`; it never talks to an AI provider.
- Keys are sent only in request headers (never in a URL).
- The logger redacts by key name and by value: key-shaped strings (OpenRouter, Google, OpenAI-style,
  GitHub, `Bearer ...`, JWT) and the exact keys configured for this process are replaced even inside
  an upstream error message. Provider error bodies are not copied into messages.
- A present-but-invalid AI setting stops startup with a message that names the variable and never
  its value; an OpenRouter address must be https (http only for localhost) and must not contain
  credentials.
- A rejected provider key is never a reason to answer from another provider: it must stay visible.
- Local `.env` and `.env.*` files are git-ignored; only `backend/.env.example` (placeholders) is
  tracked.
