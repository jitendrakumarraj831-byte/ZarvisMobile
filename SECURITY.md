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

## Sign in with Google

`POST /api/v1/auth/google` verifies the Google ID token on the server (RS256 against Google's published keys, issuer, audience = `GOOGLE_CLIENT_ID`, expiry, verified email) before anything is trusted. Google accounts are matched by their stable `sub`; an existing email account with the same Google-verified email is linked rather than duplicated; a calling guest is upgraded in place so its chats and credits are kept. Only name, email and photo are stored. ZARVIS never receives access to Gmail, Drive or contacts. Google-only accounts get a random unusable password. Chat and account data stay in ZARVIS's own database.
