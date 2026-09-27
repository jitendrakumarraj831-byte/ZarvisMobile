# ZARVIS premium UI polish

Visual and interaction pass on the PR #76 branch. Product behavior, APIs, skills, ToolPipeline, authentication, billing, and phone execution were left in place. This pass does not make the pull request ready to merge.

## Pages redesigned

- Home is a command center: brand, ask card (text, voice, file), eight quick actions, nine feature cards, and an active-work list.
- Capabilities is a grouped hub (AI & Conversation, Work & Productivity, Phone & Device, Creative, Developer, Business) with availability and an Open or Android action.
- Feature detail pages use a hero, capability cards, example chips, numbered steps, and permission/limitation cards. Every chip and primary action opens Chat, Voice, Files, Phone Agent, or Developer.
- Chat keeps the existing thread and adds Listen beside Copy and Regenerate. Tool rows use the real pipeline outcome.
- Phone Agent, Tasks, Files, Research, Creative, Business, Developer, Plans, Work, and Settings use the same card language. Unsupported image generation, system settings, and a separate verify stage stay labeled unavailable.

## Card system

Shared classes live in `web/styles.css`:

`.z-card`, `.z-card-hero`, `.z-card-action`, `.z-card-feature`, `.z-card-capability`, `.z-card-status`, `.z-card-task`, `.z-card-tool`, `.z-card-insight`, `.z-card-stat`, `.z-card-settings`

Tokens cover color, spacing, radius, shadow, type, icon size, card padding, and motion. Cards share padding, radius, a quiet border, and a soft shadow. Action and feature cards lift on hover, press down, and keep a visible focus ring. Disabled and unavailable cards reduce emphasis. Loading uses `.z-skeleton`.

## Navigation

Desktop sidebar is unchanged in structure: ZARVIS, Start, Work, Account, with a teal active bar.

Mobile bottom navigation remains Home, Chat, Work, Tasks, Settings, using the existing SVG icons. The bar is a floating pill. Content padding and the composer sit above it, including the safe-area inset.

## Mobile and desktop

- Below 720px, quick actions are two columns. Below 380px they become one column so titles do not collide.
- Feature and work grids are two columns on small screens and three columns from 1100px. Settings stays a single column of rows.
- Content width stays capped so cards do not stretch across a 1440px window.
- `overflow-x: hidden` and `overflow-wrap: anywhere` limit sideways scroll from long titles.

This environment has no browser, so 360, 390, 412, 430, 1024, 1280, and 1440 were checked in CSS only.

## Motion and accessibility

Hover, press, page enter, message enter, and modal enter use a short rise. `prefers-reduced-motion: reduce` disables animation and transition. Focus uses `:focus-visible`. Icon buttons keep 44px targets and accessible names. Navigation is buttons, not emoji. Tool and task status text is the real status, not a color alone.

## Active work and honesty

Home activity is built only from `GET /tasks`, the in-memory conversation, a file that finished extraction, and a developer result from this session. If tasks fail to load, Home says so and offers Try again. If nothing exists, it says the workspace is ready. Tasks still say that status changes do not execute steps. Plans still omit prices and checkout. Phone Agent still says the browser cannot control the phone.

Tool cards map pipeline kinds (`success`, `confirmation_declined`, `execution_failed`, `verification_failed`, `skill_not_found`, `validation_failed`, `permission_denied`, `entitlement_denied`) to Completed, Needs confirmation, Couldn't complete, Unavailable, or Permission required. They appear after the turn returns. There is no fake running tool state.

## Files changed

- `web/index.html`
- `web/styles.css`
- `web/app.js`
- `web/feature-pages.js`
- `ZARVIS_PREMIUM_UI_POLISH_REPORT.md`

## Tests

- `node --check web/app.js`
- `node --check web/feature-pages.js`
- `node --check web/sw.js`
- Duplicate `id` scan of `web/index.html`: 80 ids, no duplicates
- Required composer, chat, task, file, developer, and home-ask ids are still present

Backend tests were not re-run. This pass does not change backend code.

## Issues found and fixed in this pass

- Home had no real activity surface. It now renders only data the client already has.
- Developer primary action prefilled Chat. It now opens the Developer workspace. Example prompts still prefill Chat.
- Listen did nothing while spoken replies were off. It now requests Gemini TTS for that reply without changing the setting.
- Task refresh wrote a plain sentence for empty and error. Both use the shared empty state.
- Developer Analyze and Implement now update only their own stage badge to Running, Completed, or Couldn't complete. Verify stays Not supported.

## Remaining limitations

- No browser pass, so clipping and keyboard-with-the-on-screen-keyboard were not observed on a device.
- No Android visual pass in this task.
- Chat still receives tool results after the model reply is complete. The card cannot show a live waiting state without a new event stream.
- There is no conversation list API. Recent chats are the current browser session only.
- Image generation, web phone control, task step execution, checkout, and a separate verify agent remain unavailable on purpose.
