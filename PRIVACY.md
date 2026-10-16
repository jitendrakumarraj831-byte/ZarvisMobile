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

## Where your data goes (as built)

What each kind of data does in the current code, so that the product's public privacy notice can say the
same. "Server" is the ZARVIS backend. Checked against the code on 2026-10-14; what a third party does
with data once it has it is that third party's policy, and was not verified here (see the end of this
section).

| Data | Where it goes | Does ZARVIS keep it? |
|---|---|---|
| Messages you send, and the text of anything you attach | The server, then Gemini (Google). OpenRouter and the model provider behind it, and then an OpenAI-compatible endpoint (OpenAI's by default), only when those optional fallbacks are configured (see below). | The conversation is stored in ZARVIS's database. |
| A photo: from the camera sheet, the Android photo picker, or "Attach an image" | The server (`POST /api/v1/documents/extract` or `/api/v1/files/upload`, 4 MB limit), which holds it in memory and sends the picture to Gemini's vision model (or to an OpenRouter vision model if one is declared) to describe it. | The picture is **not** stored by the server. The description text is: in the conversation if it is attached to a message, or in Files if it is saved there (Files keeps text only). |
| A PDF or DOCX | The server reads it in memory (never written to disk); the extracted text then goes where message text goes. | Only the extracted text, as above. |
| Metadata inside a photo (EXIF, including location when the camera recorded it) | A photo taken with the web camera sheet is re-encoded in the browser and carries none. A photo **picked from the gallery or a file** on the web is sent as it is, metadata included, to the server and on to the vision model. The Android app re-encodes the photo in memory before sending (from the code; not run on a device in this review). | Not stored with the picture, because the picture is not stored. |
| A reply read aloud ("Spoken replies") | When `GEMINI_API_KEY` is set, the text to be spoken goes to Google's Gemini speech model. If that fails before any sound (and `TTS_FALLBACK_PROVIDER` is not `none`), the same text goes to Microsoft's speech service instead. Without the key, it goes to Microsoft's service only. With `TTS_PROVIDER=elevenlabs` (or `elevenlabs` in `TTS_FALLBACK_PROVIDER`) and `ELEVENLABS_API_KEY` set, the text goes to ElevenLabs as well, in the configured order. | No. The server keeps no audio and logs no spoken text. |
| A web search | Google (Gemini with Google Search grounding); OpenRouter as the search's own fallback (see below). | The query is part of the conversation. |
| Your voice, when you dictate | The browser's or the phone's own speech recogniser handles the audio, and depending on the browser or device that may be a cloud service of its vendor. The ZARVIS server has no endpoint that accepts audio and receives only the recognised text. | No audio reaches ZARVIS. |
| Logs | Structured and redacted: keys, tokens and credential-shaped strings are removed. Message, document, photo and spoken text are not logged. A provider's error reply is cut to 300 or 600 characters inside an internal error message that can reach the server log; a provider that echoes part of a request into an error could therefore put a fragment of it there. Voice errors log only a code and a status. | Per the host's log retention. |

Not verified here, because the sites could not be reached from the review environment: what Google,
Microsoft and OpenRouter do with data they receive (retention, human review, use to improve products),
and whether that differs between free and paid Gemini plans. Read Google's Gemini API terms and the
data policy of the plan the production key belongs to before publishing the notice.

## AI providers (third parties)

ZARVIS sends conversation content to an AI provider to answer. Gemini (Google) is the primary
provider. When the optional fallbacks are configured, a request that Gemini cannot serve (rate limit,
exhausted quota, outage, timeout, a model that is not offered) may be sent to OpenRouter and to the
upstream model provider OpenRouter routes it to, and, if that fails too, to the OpenAI-compatible
endpoint named by `OPENAI_BASE_URL` (OpenAI's API by default; the operator chooses the service). Free models may be operated by providers that log
or train on prompts; the OpenRouter account's data-policy settings decide which providers may
receive a request.

- Each fallback is off unless its key is set (`OPENROUTER_API_KEY`; `OPENAI_API_KEY` together with
  `OPENAI_MODEL`). `AI_FALLBACK_PROVIDER` lists which may receive a request, in order
  (`AI_FALLBACK_PROVIDER=openai` keeps text off OpenRouter, web search included), and
  `AI_FALLBACK_PROVIDER=none` switches every fallback off.
- **Which OpenRouter models may receive a request.** With the live model list on (the default), the
  server asks OpenRouter which models exist (`GET /models/user` with the key, else the public
  `GET /models`; no user content is sent) and may send a request to any listed free model that can serve
  it, not only to the one named in `OPENROUTER_MODEL`; paid models only if `OPENROUTER_ALLOW_PAID=true`.
  Which upstream provider runs a model is OpenRouter's decision. `OPENROUTER_DATA_COLLECTION=deny` asks
  OpenRouter to use only providers that do not store or train on prompts (it also applies to web search);
  it can leave no free model available. Unset, the OpenRouter account's own privacy settings decide.
  `OPENROUTER_DISCOVERY=false` returns to sending requests only to the one named model.
- A fallback is never silent internally (the server log names the provider and the reason), but the
  user interface does not currently tell the user which model answered.
- Text to speech is never sent to OpenRouter.
- **Web search is not routed through the gateway** and has its own fallback. A search query goes to
  Gemini (with Google Search grounding) first. If `OPENROUTER_API_KEY` is set and
  `AI_FALLBACK_PROVIDER` does not leave OpenRouter out, the query is sent to OpenRouter's web-search
  model when Gemini fails for any reason, and it goes there directly when no Gemini key is set.
  `AI_FALLBACK_PROVIDER=none` (or a chain without `openrouter`, such as `openai`) keeps a search query
  on Gemini. A search query is never sent to the OpenAI-compatible endpoint.
- Spoken replies: the text a person asks to hear is sent to Microsoft's speech service (the one behind
  Edge's Read Aloud, reached without an account or a key), not to OpenRouter. Nothing else goes with
  it, but Microsoft sees the server's address. It is an unofficial service, used here without a
  contract or a guarantee: review Microsoft's terms and decide whether this fits your privacy notice
  before enabling it in production.
- **Spoken replies, main and fallback voice.** By default, when `GEMINI_API_KEY` is set, the text is
  sent to Google's Gemini speech model first, under the same key as chat (Google then sees that text,
  as it does for chat). When it fails before any sound (for example its free quota is spent), the same
  text goes to Microsoft's service instead. The response says which voice spoke (`X-Zarvis-TTS: gemini`
  or `edge`) and the server log records the fall back, never the text. To use only Google's voice, set
  `TTS_FALLBACK_PROVIDER=none` (the text then goes nowhere else); to keep the text on Microsoft's
  service only, set `TTS_PROVIDER=edge` and `TTS_FALLBACK_PROVIDER=none` (`TTS_PROVIDER=edge` alone puts
  Microsoft first and Google behind it). `TTS_PROVIDER=none` switches spoken replies off. The
  server log records the engine, the voice and sizes, never the text or the audio, and no spoken
  audio is stored.
- Provider keys never leave the server and never appear in a log (see SECURITY.md).
- Operators must update the product's public privacy notice to name every AI provider in use, and the
  voice service, before enabling a fallback or spoken replies in production.
