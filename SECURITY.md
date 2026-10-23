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

Every phone action runs under the phone-automation policy, [AUTOMATION_SECURITY_POLICY.md](./AUTOMATION_SECURITY_POLICY.md)
(`shared/automation-policy.json`). It is default deny, has a pause switch, refuses sensitive apps and security screens, requires
confirmation, accepts one result report per handed-over action, and keeps an on-device history.

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
  an upstream error message. A provider's error body is cut to 300 characters (Gemini) or 600
  (OpenRouter, key-scrubbed first) inside an internal error message that only reaches the server log,
  where a provider that echoes request text could show it; clients only ever get fixed texts.
- A present-but-invalid AI setting stops startup with a message that names the variable and never
  its value; an OpenRouter address must be https (http only for localhost) and must not contain
  credentials.
- A rejected provider key is never a reason to answer from another provider: it must stay visible.
  `/health` lists the provider under `aiKeyRejected` (a name, never the key) until a request with the key
  succeeds, and the live smoke test warns.
- A key containing whitespace, a quote or a line break is refused before any request is made (an HTTP
  client would put the whole header into its error message), and no OpenRouter request follows a
  redirect: the key travels in a header and must not be sent anywhere an answer points.
- The OpenRouter model list that the server reads is untrusted input: ids must look like plain model ids
  (otherwise they are dropped), the body is capped at 8 MB and 3,000 entries, and an unreachable or
  malformed list changes nothing (the declared model is used).
- A model can name any tool; the orchestrator runs only the tools it offered in that turn.
- Local `.env` and `.env.*` files are git-ignored; only `backend/.env.example` (placeholders) is
  tracked.

## Sign in with Google

`POST /api/v1/auth/google` verifies the Google ID token on the server (RS256 against Google's published keys, issuer, audience = `GOOGLE_CLIENT_ID`, expiry, verified email) before anything is trusted. Google accounts are matched by their stable `sub`; an existing email account with the same Google-verified email is linked rather than duplicated; a calling guest is upgraded in place so its chats and credits are kept. Only name, email and photo are stored. ZARVIS never receives access to Gmail, Drive or contacts. Google-only accounts get a random unusable password. Chat and account data stay in ZARVIS's own database.
