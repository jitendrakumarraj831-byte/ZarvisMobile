# ZARVIS international product implementation report

This pass redesigns the web product around the capabilities that already execute, and wires the Android phone, voice, and session paths that the audit showed were incomplete. It does not add a second backend or invent skills.

## 1. Product architecture before / after

Before, the web app was a five-item shell plus capability detail pages. Phone, files, research, creative, business, and developer were descriptions that mostly dropped the user into Chat. Plans was missing from the phone navigation. Activity controls could throw after a successful API call.

After:

- Desktop sidebar: Home, Chat, Capabilities, Phone Agent, Tasks, Files, Research, Creative, Business, Developer, Plans, Settings.
- Phone bottom bar: Home, Chat, Work, Tasks, Settings. Work is the hub for the secondary destinations.
- Android bottom bar: Home, Chat, Capabilities, Tasks, Work. Work opens the same destinations.

Web and Android use the same names for those areas.

## 2. Design system

`web/styles.css` is a token-led system: background, surface, text, muted text, borders, one accent, success, warning, error, spacing, radius, shadow, type, motion, and z-index. Light is the default. Dim overrides the same tokens. Touch targets are at least 44px. Focus is visible. `prefers-reduced-motion` disables animation. The previous aurora, orbit, and particle home treatment is gone.

## 3. Home

Home leads with the name, one sentence, and an ask field. The user can type, speak, or attach a file from that field. Suggested actions open Chat with a real prompt or open Files / Phone Agent. The field submits through the existing composer path.

## 4. Chat

Messages are labeled You, ZARVIS, Action, or Status. Assistant messages can be copied or regenerated. A completed turn shows each tool call and its outcome. A `confirmation_declined` result has Confirm and continue, which retries the same utterance with `confirmed: true`. Stop still aborts the in-flight request. The stream remains the existing post-completion chunk stream.

## 5. Voice

States stay Ready, Listening, Understanding, Working, Speaking, Done, and Error. Starting the microphone cancels an in-flight turn instead of clearing the busy state underneath it. A recognition error no longer marks a finished turn idle while audio is still owed. Gemini voice names (Kore, Puck, Charon, Aoede, Fenrir) are stored and sent to `/tts/synthesize` and `/tts/synthesize-stream`. Android uses the same voice preference, requests the microphone, uses the saved language for recognition, and keeps the written reply if playback fails.

## 6. Phone Agent

The web page states what Android can do, what needs permission, what needs confirmation, and what is not supported. It does not offer a browser call button. Android runs `phone.open_app`, `phone.find_contact`, and `phone.call` only when the utterance is shaped like that command. A raw number requests Phone only. A contact name also requests Contacts. The existing confirmation dialog still gates the call.

## 7. Capabilities

The hub and detail pages remain, and their primary actions open the matching workspace. Phone details open Phone Agent. Live skills from `GET /skills` still have Run, which submits a real utterance.

## 8. Research

The research page starts search, compare, and outline prompts in Chat. Copy distinguishes live search from knowledge-only research skills. The thread shows tool activity separately from the answer. The client does not add sources the backend did not return.

## 9. Documents

Files is a workspace for the existing extract-then-ask flow. The page says Reading while the request is in flight and Ready only after text comes back. Unsupported type, empty file, and oversize responses use the server error code for images as well as PDF and DOCX.

## 10. Creative

Writing prompts call the existing creative skills. Image generation is labeled not supported. Analyzing an image the user already has goes through Files.

## 11. Business

Social post, customer reply, and invoice prompts call the existing draft skills. The page says drafts are not sent.

## 12. Developer Agent

The web developer workspace calls `POST /developer/analyze` and `POST /developer/implement`. Implement asks for confirmation in the product dialog and sends `confirmed: true` only after that. The stages on screen are Analyze (live), Plan (inside implement), Implement (live, PRO, shared GitHub token), and Verify (not a separate step). Android still has analyze, and it no longer treats ordinary chat as a local phone command before the request can reach this API.

## 13. Tasks

The task list is the activity API. Pause, resume, cancel, and retry refresh that list. The previous crash came from writing into a removed `#task-list`. The page says status changes do not execute steps. Task reads and mutations are limited to the owning account.

## 14. Settings

Account, AI & Voice, Language, Appearance, Notifications, Permissions, Privacy, Security, Rules & Protection, Data, Developer, and Subscription are separate pages. Language, appearance, spoken replies, Gemini voice, clear session, and delete account change real state. Notifications, export, and checkout say they are unavailable.

## 15. Plans

The screen shows the live plan, credits, and trial end. Monthly and yearly only change the billing-period label. There is no price and no upgrade button, because Play checkout is not connected.

## 16. Security changes

- Production without Play credentials uses a fail-closed verifier. Local and test runs still use the mock verifier.
- A verified purchase token is stored and cannot upgrade a second account.
- Credit deduction requires `balance >= cost` in Postgres and the in-memory store.
- Task get and status routes return 404 when the task belongs to another account.
- Gemini HTTP failures with 408, 429, or 5xx are classified as 503. The previous regular expression did not match those codes.
- Android no longer treats substrings such as "open this" or "call it a day" as phone commands.
- `phone.call` no longer requires Contacts for a raw number.
- Android requests runtime permissions before the microphone and before a phone skill.
- A TTS failure on Android no longer replaces the assistant text.
- Clearing the Android session no longer leaves Chat without an account. The next turn calls `ensureSession()`.
- Android sends and stores `conversationId`.

The shared `GITHUB_TOKEN`, guest trial minting, and stateless access tokens after account deletion are unchanged. Those need a credential model and a revocation store, not a UI change.

## 17. Feature activation matrix

| Feature | Web UI | Android UI | API | Skill / tool | Permission | Confirmation | Execution | Result | Error | Voice | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Chat | Yes | Yes | turn / turn-stream | Orchestrator | No | When a skill requires it | Yes | Message | Retry | Web voice turns; Android after each success | WORKING |
| Voice | Yes | Yes | TTS | Gemini | Mic on tap | No | Yes | Audio | Playback error keeps text | Yes | WORKING |
| Open app | Handoff | Chat | On device | phone.open_app | None | No | Android | Summary | Not found | Optional | WORKING on Android |
| Find contact | Handoff | Chat | On device | phone.find_contact | Contacts, requested | Yes | Android | Number | Permission or not found | Optional | PARTIAL |
| Call | Handoff | Chat | On device | phone.call | Phone; Contacts only for a name | Yes | Android | Calling | Denied or failed | Optional | PARTIAL |
| Research | Yes | Feature to Chat | Orchestrator | web.search, research.* | No | No | Yes | Answer plus tool row | Skill error | Optional | PARTIAL |
| Files | Yes | Feature explains gap | documents/extract | docs via next turn | File picker | No | Yes | Ready chip | Typed extract error | Optional | WORKING on web |
| Creative text | Yes | Feature to Chat | Orchestrator | creative.* | No | No | Yes | Draft | Skill error | Optional | WORKING |
| Image generation | Labeled unsupported | Labeled unsupported | None | None | — | — | No | — | — | — | NOT SUPPORTED |
| Business | Yes | Feature to Chat | Orchestrator | business.* | No | No | Draft only | Draft | Skill error | Optional | WORKING |
| Developer analyze | Yes | Yes | /developer/analyze | developer.analyze_repo | Account | No | Read-only | Summary | HTTP error | No | WORKING |
| Developer implement | Yes | Not exposed | /developer/implement | developer.implement | PRO | Yes | Branch and PR | PR link | Entitlement or GitHub | No | PARTIAL |
| Tasks | Yes | Yes | /tasks | automation.* creates rows | Account ownership | No | Status only | List | 404 / 409 | No | PARTIAL |
| Plans | Yes | Yes | /entitlements/me | — | Account | — | Read | Plan and credits | Load failure still shows tiers | No | PARTIAL |
| Delete account | Yes | Yes | DELETE /account | — | Session | Yes | Yes | Reload / home | Inline error | No | WORKING |

## 18. Files changed

Web: `web/index.html`, `web/styles.css`, `web/app.js`, `web/feature-pages.js`.

Backend: billing verifier and container, billing route, task routes, credit deduction, purchase-token claim, TTS voice selection, Gemini error status, tool pipeline charge failure.

Android: navigation and Work screen, home copy, conversation session/voice/TTS, settings voice, permission broker, device-command gate, phone-call permissions, orchestrator conversation id, TTS request voice.

Docs: this report and `ZARVIS_FEATURE_STATUS.md`.

## 19. Tests executed

- `node --check` on `web/app.js`, `web/feature-pages.js`, and `web/sw.js`.
- HTML id scan: no duplicate ids and no unclosed elements from the parser.
- `npx tsc --noEmit` in `backend`.
- `vitest run` in `backend`. New coverage passed: cross-account task 404, purchase-token replay 409, fail-closed verifier. Pipeline, task service, and billing verifier suites passed.

## 20. Tests not possible here

- Android Gradle compile and lint. `ANDROID_HOME` is unset and there is no SDK in this environment.
- Browser screenshots at the listed viewport sizes. No browser automation was available in this run.
- Postgres store tests. They skip unless `TEST_DATABASE_URL` is set.
- Live Gemini TTS and live GitHub analyze. This environment has no `GEMINI_API_KEY`, and `https://github.com/example/demo` returns 404.

## 21. Remaining limitations

- Turn streaming is still chunked after the model finishes.
- Workflow steps are tracked, not executed.
- Image generation does not exist.
- Web cannot control the phone.
- Android has no document picker. Files explains that and sends the user to the documents capability page.
- Production Play billing cannot grant PRO until service-account credentials are configured. That is intentional.
- One process-wide GitHub token still performs implementation for every PRO account.
- Guest signup is still unbounded.
- Access tokens are not revoked when an account is deleted. Refresh fails after deletion. The access token can live until it expires.

## 22. Known issues

These `vitest` failures were already present when this environment ran the suite. They are not caused by the ownership, billing, or credit changes:

- Skill catalogue expects every skill to be available on a trial. `developer.implement` requires PRO, so `upgradeRequired` is true.
- Developer analyze against `https://github.com/example/demo` returns GitHub 404 and the route surfaces 500.
- One creator/about utterance is answered by the fallback "I'm not sure which skill" line instead of the profile response.
- Greeting tests that first analyze a missing repository fail for the same GitHub 404.
- Gemini provider and TTS tests expect older model names or a single attempt. The current provider falls through candidate models.

## 23. Recommended next phase

1. Execute workflow steps, or remove step lists from the create API so Tasks cannot imply progress that never moves.
2. Replace the shared GitHub token with per-user authorization before implementation is offered broadly.
3. Add refresh-token storage and reject access tokens whose account row is gone.
4. Cap guest signup.
5. Add an Android document picker that calls the same extract route.
6. Connect Play Billing with real credentials. Keep the fail-closed verifier as the default.
