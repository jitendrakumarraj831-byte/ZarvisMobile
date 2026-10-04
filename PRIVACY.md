# ZARVIS Privacy

ZARVIS privacy behavior follows the master blueprint.

## Data principles

- Collect only what a capability needs.
- Keep data scoped to the authorized account and task.
- Do not treat permission as unlimited authorization.
- Give users control over memory and integrations.
- Handle permission revocation and disconnected integrations.
- Avoid sensitive data in application logs.

## Android notification privacy

Notification access should support configurable privacy modes, including:

- Off
- App + type
- Contact + app
- Contact + app + preview
- Available content

Quiet hours, lock-screen behavior, headphones behavior and sensitive-content exclusions should be respected where supported.

OTP, banking and authentication alerts are not spoken by default.

## Truthful privacy UX

Every permission request should explain why access is needed, what access/data is involved, what ZARVIS will not do automatically, and how the user can revoke access.

## AI providers (third parties)

ZARVIS sends conversation content to an AI provider to answer. Gemini (Google) is the primary
provider. When the optional fallback is configured, a request that Gemini cannot serve for a
temporary reason (rate limit, exhausted quota, outage, timeout) may be sent to OpenRouter and to the
upstream model provider OpenRouter routes it to. Free models may be operated by providers that log
or train on prompts; the OpenRouter account's data-policy settings decide which providers may
receive a request.

- The fallback is off unless `OPENROUTER_API_KEY` is set, and `AI_FALLBACK_PROVIDER=none` switches it
  off explicitly.
- A fallback is never silent internally (the server log names the provider and the reason), but the
  user interface does not currently tell the user which model answered.
- Text to speech and web search are never sent to OpenRouter.
- Spoken replies: the text a person asks to hear is sent to Microsoft's speech service (the one behind
  Edge's Read Aloud, reached without an account or a key), not to Gemini and not to OpenRouter.
  Nothing else goes with it, but Microsoft sees the server's address. It is an unofficial service,
  used here without a contract or a guarantee: review Microsoft's terms and decide whether this
  fits your privacy notice before enabling it in production. `TTS_PROVIDER=none` switches spoken
  replies off. The server log records the engine, the voice and sizes, never the text or the audio,
  and no spoken audio is stored.
- Provider keys never leave the server and never appear in a log (see SECURITY.md).
- Operators must update the product's public privacy notice to name every AI provider in use, and the
  voice service, before enabling a fallback or spoken replies in production.
