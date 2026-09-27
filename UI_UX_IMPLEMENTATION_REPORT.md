# UI/UX implementation report

This change keeps the existing web shell, Android navigation graph, voice pipeline, ToolPipeline, skill registry, authentication, and backend. It adds capability discovery and applies the pending UI recommendations from `UI_UX_RECOMMENDATIONS.md`.

## Before / after information architecture

Before:

- Web primary nav: Home, Chat, Capabilities (labeled Features on phones), Activity, Settings. Plans only in the desktop sidebar and one Home link.
- Home was a large reactor plus eight feature cards that jumped straight into Chat.
- Phone Agent existed only as Android skills (`phone.open_app`, `phone.find_contact`, `phone.call`) with no product page.
- Android bottom bar: Home, Chat, Features, Activity. Settings, Plans, and Developer were easy to miss. Pushed screens had no visible Back control.

After:

- Primary nav stays five items on phones: Home, Chat, Capabilities, Activity, Settings. Plans stays in the desktop sidebar and is linked from Capabilities and Activity.
- Home introduces ZARVIS, one sentence, Chat, Explore Capabilities, and four discovery cards (AI Workspace, Voice Assistant, Phone Agent, Tasks). The other capabilities live on the Capabilities hub.
- Each major capability has one detail page: what it does, why, how, examples, permissions, and limits.
- Phone Agent is a first-class page. Actions that are not implemented are marked Not supported and have no action button.

## Pages created

Web, one reusable stage `#view-feature` fed by `web/feature-pages.js`:

| Page | Title |
|---|---|
| workspace | AI Workspace |
| voice | Voice Assistant |
| phone | Phone Agent |
| research | Web & Research |
| documents | Documents & Files |
| creative | Creative Studio |
| business | Business |
| developer | Developer Agent |
| tasks | Tasks & Automation |

Android uses the same nine ids in `FeatureCatalog` and `FeatureDetailScreen`, route `feature/{featureId}`.

## Components created

Web (plain DOM, no new framework):

- Feature hub card, detail hero, workflow list, permission note, availability badge, example prompt, primary CTA
- All rendered by `window.ZarvisFeatures` in `web/feature-pages.js`

Android:

- `FeaturePage`, `PhoneAction`, `FeatureCatalog`
- `FeatureDetailScreen`

## Existing components reused

Web: `.zarvis-btn`, `.back-btn`, `.home-link-btn`, `.quick-action`, `.task-empty`, `.view-header`, bottom nav, sidebar, composer, confirm modal, settings panels, live skill cards from `GET /skills`.

Android: `ZarvisCard`, `ZarvisPrimaryButton`, `ZarvisSecondaryButton`, `GlassSurface`, `GlassBottomBar`, `AiOrb`, `ZarvisComposer`, existing Conversation, Developer, Tasks, Settings, and Subscription screens.

## UI recommendations implemented

| ID | What shipped |
|---|---|
| UX-001 | Home scroll alignment is `flex-start` |
| UX-002 | Short-phone reactor capped near 200px / 140px orb |
| UX-003 | Dim appearance overrides tokens and the main surfaces; `theme-color` follows it |
| UX-004 | Settings hub has no Back. Subpages use Back + title and hide the hub header |
| UX-005 | Nav and titles say Capabilities and Activity on web and Android |
| UX-006 | Plans links on Capabilities and Activity (web and Android) |
| UX-007 | Visible Back on Android Conversation (pushed), Developer, Plans, and Settings |
| UX-008 | Web controls use at least a 44px hit area. Android bar items use a 48dp minimum and a ripple |
| UX-009 | Supporting copy floored at 12px, metadata at 11px |
| UX-010 | Composer and block inputs use 16px type |
| UX-011 | Web composer is a textarea up to four lines. Enter sends, Shift+Enter inserts a line. Android composer allows four lines |
| UX-012 | Confirm dialog traps focus, closes on Escape and scrim, restores focus. Danger style only when `destructive` is true |
| UX-013 | Latest reply is announced from `#chat-announcer`. `lang` follows English/Hindi. Mic, Send/Stop, and Activity have names |
| UX-014 | Android nav icon is decorative. The item is a selected tab |
| UX-015 | Android user turns use the primary color and align to the end. Assistant turns use a card and align to the start |
| UX-016 | Activity keeps the current list until refresh returns. Failure has its own empty state. Android shows a spinner only when the list is empty |
| UX-017 | Clear local session asks for confirmation and is not styled as Delete |
| UX-018 | Home no longer promises a separate web implementation screen. Android Developer entry is a card |
| UX-019 | Android Settings includes a read-only Rules & Protection page |
| UX-020 | The always-green Online dot is gone. Chat status is the existing status pill in the header |
| UX-021 | Narrow web screens drop orbit, particle, and sheen loops. Android orb draws a static frame when animator duration scale is 0 |
| UX-022 | Web nav uses the existing stroke SVG style |
| UX-023 | Empty Chat hides greeting and subtitle under 700px height |
| UX-024 | Onboarding can go back one page |

## Phone Agent

Shown as available now on Android:

- Open apps. No runtime permission. Example: “Open WhatsApp”.
- Find contacts. Requires Contacts. Example: “Find Mom's number”.
- Make calls. Requires Phone, and Contacts when the target is a name. Confirmation stays in the existing medium-risk pipeline. Example: “Call 9876543210”.

Shown as not supported, with no button:

- System settings (Wi-Fi, Bluetooth, and similar).

The website explains that these skills run on the Android app. “Try Phone Agent” on the web opens Chat with an editable command. It does not pretend the browser can place a call.

## Android / web parity

Shared names: AI Workspace, Voice Assistant, Phone Agent, Web & Research, Documents, Creative Studio, Business, Developer Agent, Tasks & Automation, Capabilities, Activity, Plans.

Android keeps Material icons, system Back, and the glass bottom bar. Web keeps the sidebar at 1024px and the bottom bar below that.

## Accessibility

- Icon buttons use `aria-label`, not only `title`
- Confirm dialog is keyboard-operable
- Document language switches with the language control
- Chat announcements are one message, not the whole thread
- Android bottom bar exposes selected tab state once
- Reduced motion is honored on the web (existing rule) and on the Android orb when the system animator scale is off
- Hit targets meet 44px on web and 48dp on the Android bar

## Responsive

Home, composer, nav, and feature pages were checked in headless Chrome at 360×740 and 390×844. DOM after load contains the nine capability cards, Explore Capabilities, and the multiline composer. Additional CSS breakpoints cover 768px and the existing 1024px sidebar. 430px, 768px, 1024px, and 1440px use the same style rules; those four widths were not each given a separate screenshot in this run because headless Chrome was slow to start.

## Bugs fixed

- Settings subpage Back button had no icon, and the hub title stayed on screen
- Dim appearance stored a value and changed no colors
- Home could center overflowing content
- `setActiveView` no longer throws when optional metrics or developer nodes are absent
- Activity refresh no longer blanks the list before the request finishes
- Failed task fetch is an error state instead of an empty list (`fetchTasks` returns null when the response is not ok)
- Mobile nav said Features while the page said Capabilities
- Android conversation bubbles did not distinguish speakers
- Clear session ran immediately

## Tests and build

- `node --check web/app.js` and `node --check web/feature-pages.js` passed
- Rendered DOM from `web/index.html` includes 9 `.feature-hub-card` nodes and the Phone Agent copy
- Headless Chrome screenshots: `/tmp/zarvis-ui/home-360x740.png`, `/tmp/zarvis-ui/home-390.png`
- Android Gradle was not run. This environment has no Android SDK, so Kotlin changes are not compiler-verified here
- Backend tests were not re-run. No backend files were changed

Without a running API, Chat shows the existing connection error after startup. That is the current guest-session failure path, not a new empty screen.

## Remaining known issues

- Dim does not repaint every hardcoded hex in `styles.css`. Main surfaces, text, nav, cards, and the composer do change.
- The public web client still has no separate Developer implement form. Analysis starts in Chat. Android Developer remains read-only analysis.
- `automation.create_workflow` still tracks steps and does not execute them. The Tasks page says so.
- Web cannot run Phone Agent skills.
- Android document analysis is a chat prompt. The file picker remains on the web.
- Home still uses the existing reactor animation above 420px width.
- A failed skills request on Android still replaces the Capabilities body with the error, so the product cards are hidden until skills load. Home still opens Phone Agent, Voice, and Developer.

---

## 1. Files changed

- `web/index.html`
- `web/styles.css`
- `web/app.js`
- `web/feature-pages.js` (new)
- `android/app/src/main/kotlin/com/zarvismobile/app/navigation/NavGraph.kt`
- `android/features/feature-home/src/main/kotlin/com/zarvismobile/feature/home/HomeScreen.kt`
- `android/features/feature-home/src/main/kotlin/com/zarvismobile/feature/home/CapabilitiesScreen.kt`
- `android/features/feature-home/src/main/kotlin/com/zarvismobile/feature/home/FeatureCatalog.kt` (new)
- `android/features/feature-home/src/main/kotlin/com/zarvismobile/feature/home/FeatureDetailScreen.kt` (new)
- `android/features/feature-conversation/src/main/kotlin/com/zarvismobile/feature/conversation/ConversationScreen.kt`
- `android/features/feature-conversation/src/main/kotlin/com/zarvismobile/feature/conversation/ConversationViewModel.kt`
- `android/features/feature-tasks/src/main/kotlin/com/zarvismobile/feature/tasks/TasksScreen.kt`
- `android/features/feature-developer/src/main/kotlin/com/zarvismobile/feature/developer/DeveloperScreen.kt`
- `android/features/feature-subscription/src/main/kotlin/com/zarvismobile/feature/subscription/SubscriptionScreen.kt`
- `android/features/feature-settings/src/main/kotlin/com/zarvismobile/feature/settings/SettingsScreen.kt`
- `android/features/feature-onboarding/src/main/kotlin/com/zarvismobile/feature/onboarding/OnboardingScreen.kt`
- `android/features/feature-onboarding/src/main/kotlin/com/zarvismobile/feature/onboarding/OnboardingViewModel.kt`
- `android/core/core-ui/src/main/kotlin/com/zarvismobile/core/ui/components/GlassBottomBar.kt`
- `android/core/core-ui/src/main/kotlin/com/zarvismobile/core/ui/components/AiOrb.kt`
- `android/core/core-ui/src/main/kotlin/com/zarvismobile/core/ui/components/ZarvisTextField.kt`
- `UI_UX_IMPLEMENTATION_REPORT.md` (this file)

## 2. Features implemented

- Capability hub and nine detail pages on web and Android
- Phone Agent page with honest availability
- Home hierarchy: identity, Chat, Explore Capabilities, four discovery cards
- UX-001 through UX-024 as listed above
- Settings subpage header, Dim theme, confirm-dialog accessibility, session confirmation
- Android back rows, chat bubble roles, Activity loading/empty/error, Rules & Protection

## 3. Features intentionally not changed

- Backend routes, skill handlers, and Task Engine behavior
- Android on-device phone skills, permissions, and ToolPipeline
- Voice engines and the listen / speak state machine
- Authentication and guest session bootstrap
- Live skill cards and “Run” on the Capabilities list
- Billing. Plans still say pricing is coming soon
- Developer implementation API. The public clients do not gain a new implement button

## 4. Remaining limitations

See “Remaining known issues” above. The important product limits are unchanged and now written on the pages: no wake word, no browser phone control, no automatic workflow execution, and no silent repository writes.

## 5. Verification results

| Check | Result |
|---|---|
| JavaScript syntax | Passed |
| Rendered capability hub | 9 cards, including Phone Agent |
| Home at 360 and 390 | Hero, Chat, Explore Capabilities, discovery cards, bottom nav |
| Android compile | Not run — no Android SDK in this environment |
| Backend tests | Not run — backend untouched |
