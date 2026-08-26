# SECURITY

Companion to [MASTER_SPEC.md §15–§16 (Security & Permission Architecture)](./MASTER_SPEC.md#15-security-architecture).
This document is the security policy for the codebase and, once the product has real
users, the disclosure process.

## Threat model summary

| Actor | Concern | Mitigation |
|---|---|---|
| Malicious/modified client | Bypasses client-side permission/risk/entitlement checks | Backend re-enforces the full Tool pipeline server-side (§7); client checks are UX-only |
| Compromised AI provider response | Model attempts a tool call outside granted scope | Every tool call is validated against `SkillDefinition.inputSchema` and re-checked for permission/risk/entitlement before execution — the model's intent is never trusted as authorization |
| Malicious web content (Web Agent) | Prompt injection via fetched page content | Fetched content is treated as data, never as instructions; the Web Agent never executes instructions found inside fetched pages, and never bypasses CAPTCHA/auth/payment/anti-abuse controls (§12) |
| Leaked APK | Secrets extracted from the app binary | No provider API keys, GitHub credentials, or DB credentials are ever bundled in the APK (§10, §15) — all AI/GitHub calls proxy through the backend |
| Log/telemetry leakage | Sensitive data captured in logs/analytics | Central redaction facade strips known-sensitive fields before any log line is emitted (§15); analytics are aggregate/event-based only (§27) |
| Device-level abuse | App used to bypass Android security or surveil the user | Absolute constraints (§7 Phone Agent): never bypasses Android security, never secretly monitors the device/mic/camera, never captures OTPs/passwords, never bypasses app authentication |

## Defense-in-depth pipeline

Every tool execution — on-device or backend — passes through, in order:

1. **Tool Registry** — does this tool exist and is it currently enabled?
2. **Validation** — does the input match `SkillDefinition.inputSchema`?
3. **Permission** — is the required Android permission / OAuth scope granted?
4. **Risk** — LOW auto-proceeds; MEDIUM/HIGH require explicit user confirmation.
5. **Entitlement** — does the account's plan/trial/credit balance allow this?
6. **Confirmation** — for MEDIUM/HIGH risk, block on an explicit user "yes."
7. **Execution** — sandboxed, timeout-bound handler.
8. **Verification** — did the tool actually produce the claimed result?

No skill handler can skip a stage; the pipeline is implemented once
(`domain/tooling/ToolPipeline.kt` on Android, `backend/src/tooling` on the server) and
every skill runs through the same instance.

## Secrets

- AI provider keys, GitHub App/OAuth credentials, and database credentials live only in
  the backend's environment/secret manager. Local development uses `.env` files that are
  git-ignored (`backend/.env.example` documents the required keys with placeholder values).
- The Android app holds only short-lived access/refresh tokens issued by the backend,
  stored via Android Keystore-backed encrypted storage.

## Logging redaction

A shared redaction utility (mirrored on client and server) strips values for keys matching
`password|otp|token|secret|authorization|cardNumber|cvv|pin` (case-insensitive) before any
structured log line is written. Tool execution logs (`ToolExecution` records) store
schema-validated input/output with the same redaction applied — see
[MASTER_SPEC.md §24](./MASTER_SPEC.md#24-data-model-core-entities).

## Absolute constraints

The following are never configurable, never bypassed by a skill, and never overridden by a
user request interpreted as "implied permission":

- No bypassing Android OS security or app-level authentication.
- No secret device monitoring, no capturing OTPs/passwords/tokens meant for another app.
- No secretly recording microphone or camera.
- No bypassing CAPTCHA, payment security, or anti-abuse mechanisms on the web.
- No unauthorized surveillance of the device owner or any third party.
- No autonomous execution of a HIGH-risk action (financial transaction, account/security
  change, destructive operation) without an explicit, action-specific user confirmation —
  ambiguous conversation is never treated as standing authorization.

## Reporting a vulnerability

Once this product has a public release, security reports should go to a dedicated
security contact (to be published here before launch). Until then, file findings as
issues in this repository marked `security`, or contact the maintainer directly — do not
open a public issue for an exploitable vulnerability against a live deployment.
