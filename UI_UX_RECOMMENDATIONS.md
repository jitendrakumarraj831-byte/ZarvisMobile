# ZarvisMobile UI/UX Recommendations

Professional review of the current product. This document does not change the UI.

Scope reviewed:

- Web: Home, Chat, Capabilities, Activity, Plans, Settings, Rules & Protection, composer, confirm modal, voice orb, bottom navigation, desktop sidebar (`web/index.html`, `web/styles.css`, `web/app.js`)
- Android: Home, Conversation, Capabilities, Activity/Tasks, Plans, Settings, Developer Agent, Onboarding, glass bottom bar, shared components (`android/features/**`, `android/core/core-ui/**`, `android/app/.../NavGraph.kt`)

Design system this review stays inside:

- Web tokens in `:root` (`--bg`, `--text`, `--muted`, `--gradient`, `--radius`, `--font-display`, `--font-body`) and existing classes (`.nav-item`, `.zarvis-btn`, `.zarvis-card`, `.chat-page-header`, `.back-btn`, `.task-empty`, `.home-link-btn`)
- Android `ZarvisTheme`, `ZarvisSpacing`, `GlassSurface` / `ZarvisCard`, `ZarvisPrimaryButton` / `ZarvisSecondaryButton` / `ZarvisDestructiveButton`, `AiOrb`, `GlassBottomBar`

Every item below is **Approval: PENDING**. Nothing here should be implemented until an item is explicitly approved (`APPROVE UX-001`, or `APPROVE ALL LOW-RISK UX` for items whose Risk is Low).

---

### UX-001 — Stop Home from clipping its top when the page is taller than the screen

Category:
Layout

Current problem:
Home is a scrolling column, but it is also vertically centered. When the reactor, subtitle, primary chat card, and feature grid are taller than the visible area, the top of the page is pushed above the scrollport and cannot be reached. The short-screen rule only switches alignment to the start under 700px height and under 640px width, so typical phones (about 740–900px tall) still center an overflowing page.

Evidence:
`web/styles.css` — `.stage` sets `overflow-y:auto`; `.home-stage` sets `justify-content:center` (around the premium-home block). The exception is only `@media (max-height:700px) and (max-width:639px)`, which sets `.home-stage { justify-content:flex-start }`.

Recommended solution:
Set `.home-stage` to `justify-content:flex-start` at every breakpoint. Keep horizontal centering (`align-items:center`) and the existing padding. Do not add a new layout container.

Why:
The brand reactor and the “Chat with ZARVIS” card stay reachable. Users can scroll from a stable top instead of losing the hero above the fold.

Priority:
Critical

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Opening Home always starts at the reactor. Scrolling moves down through the chat card, feature grid, and the 01–02–03 trust row. Nothing required to use the product sits above the first scroll position.

Files likely affected:
`web/styles.css`

Approval:
PENDING

---

### UX-002 — Shorten the Home reactor on short phone heights so the chat card and first features stay in reach

Category:
Mobile

Current problem:
The reactor reserves a large fixed block before any action. Default `.orb-area` is `min(46vh, 340px)` with `min-height:270px`. Under 420px width it is still 300px tall. The existing short-height rule only drops it to 245px, and only when width is under 640px. On a phone under about 700px of usable height, the primary chat card and the first feature row sit below the bottom navigation.

Evidence:
`web/styles.css` — `.orb-area` (width/height/min-height), `.orb-area > .orb` (`clamp(164px, 47vw, 218px)`), `@media (max-width:420px)` orb block, `@media (max-height:700px) and (max-width:639px)`.

Recommended solution:
Inside the existing short-phone queries, cap `.orb-area` height at about 200px and the core orb at about 140px (roughly 12–16% shorter than the current 245px / 158px short-height pair, and clearly shorter than the 300px narrow-width pair). Reduce orbit ribbon sizes in the same query so they stay inside the smaller reactor. Leave desktop (`min-width:1024px`) orb sizes unchanged.

Why:
The primary action and the first feature row remain visible with one short scroll, without removing the reactor that identifies the product.

Priority:
High

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
On a phone shorter than 700px, the reactor, kicker, subtitle, and “Chat with ZARVIS” card fit above the bottom navigation. The feature grid begins immediately under that card. Desktop Home keeps the current larger reactor.

Files likely affected:
`web/styles.css`

Approval:
PENDING

---

### UX-003 — Make the Dim appearance actually change the existing color tokens

Category:
Consistency

Current problem:
Settings offers “Aurora Light” and “Dim” and stores the choice, but no stylesheet reads that choice. Selecting Dim updates a button state and nothing else. Android Settings has a working dark theme through `ZarvisTheme`. The web copy already promises a soft dim treatment, not a black screen, so the missing styles are a broken control rather than a missing product theme.

Evidence:
`web/app.js` — `setAppearance()` / `applyAppearance()` set `document.documentElement.dataset.appearance`. `web/index.html` — `#appearance-aurora-btn`, `#appearance-dim-btn`, copy in the Appearance panel. `web/styles.css` — `:root` tokens only; no `[data-appearance="dim"]` rules. Android contrast: `SettingsScreen.kt` `SettingsPage.Appearance` and `Theme.kt` `DarkColors`.

Recommended solution:
Add one `[data-appearance="dim"]` block that reassigns the existing `:root` tokens (`--bg`, `--bg-2`, `--surface`, `--text`, `--muted`, `--line`, `--shadow`). Shift surfaces toward a muted blue-slate and keep `--cyan`, `--blue`, `--violet`, `--pink`, and `--gradient` so cards, the reactor, and buttons stay recognizable. Do not add a second theme file or a black palette. Mirror the same token idea only; do not try to make web Dim identical to Android’s near-black `ZarvisSpaceBlack` scheme, because the web panel explicitly says Dim stays colorful.

Why:
The control does what it says. Aurora Light remains the default. Users who pick Dim get a lower-glare version of the same UI.

Priority:
Critical

Implementation scope:
Medium

Risk:
Low

Suggested UI behavior:
Aurora Light is the default and matches today’s colors. Dim darkens page, card, nav, and composer surfaces and lightens text using the same components. The active pill in Appearance matches the applied dataset. Preference stays in `localStorage` as it does now. `theme-color` in `web/index.html` should follow the active background so the browser chrome does not stay light blue on Dim.

Files likely affected:
`web/styles.css`, `web/app.js`, `web/index.html`

Approval:
PENDING

---

### UX-004 — Give Settings subpages one title row and a visible Back control

Category:
Navigation

Current problem:
Opening Voice, Language, Rules & Protection, or any other settings page leaves the hub header (“Settings” plus the description) on screen and adds a second Back control with no icon and no label. The hub Back control (`#settings-back-btn`) sits above the title because `.view-header` is not a row, so Settings looks like a stacked back button, a page title, and then another empty button. Chat already has the correct pattern: a single row with Back, title, and optional status.

Evidence:
`web/index.html` — `#view-settings .view-header` contains `#settings-back-btn`, then `h2`, then the intro. `#settings-panels` starts with `button.settings-panel-back` and no SVG child. `web/styles.css` — `.view-header` is not a flex row; `.back-btn` is 36×36; `.chat-page-header` is the row pattern. `web/app.js` — `openSettingsPage()` hides `#settings-grid` but does not hide `.view-header`.

Recommended solution:
While a settings panel is open, hide the hub `.view-header`. Turn `.settings-panel-back` into the same row as `.chat-page-header`: 44×44 Back button using the existing chevron SVG, the panel title (Voice, Rules & Protection, and so on), and no extra action unless that page already has one. Remove `#settings-back-btn` from the hub. Settings is already a primary destination in the bottom nav and sidebar, so a hub-level “Back to Home” fights that navigation.

Why:
Each settings page has one title and one way back to the hub. The hub itself matches Capabilities, Activity, and Plans, which do not show a back button.

Priority:
High

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Settings hub: title “Settings”, description, then the entry grid. No back button. Tapping an entry replaces the grid with one header row (Back + page title) and that page’s card. Back returns to the hub and restores focus to the entry that was opened. Bottom nav and sidebar still leave Settings entirely.

Files likely affected:
`web/index.html`, `web/styles.css`, `web/app.js`

Approval:
PENDING

---

### UX-005 — Use one name for Capabilities and Activity on web and Android

Category:
Consistency

Current problem:
The same destinations use different names. Web mobile bottom nav says “Features”; the desktop sidebar and the page title say “Capabilities”. Android bottom nav says “Features” and the screen title says “Capabilities”. Android Activity route title is “Tasks” while the tab says “Activity”. Web Activity is titled “Activity”.

Evidence:
`web/index.html` — `.bottom-nav` button text “Features”; `.sidebar-nav` text “Capabilities”; `#view-capabilities h2` “Capabilities”; `#view-activity h2` “Activity”. `NavGraph.kt` — `ZarvisNavItem(Routes.CAPABILITIES, "Features", …)` and `ZarvisNavItem(Routes.ACTIVITY, "Activity", …)`. `CapabilitiesScreen.kt` title “Capabilities”. `TasksScreen.kt` title “Tasks”.

Recommended solution:
Use “Capabilities” for the skills hub and “Activity” for the task list in navigation labels and screen titles on both clients. Keep the existing routes and icons. Do not rename the Android route constants.

Why:
The tab the user taps and the title they land on say the same thing. Switching between the website and the app does not require relearning labels.

Priority:
High

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Bottom nav, sidebar, and Android bar show Capabilities and Activity. Opening those screens shows the same words as the `h2` / headline. No change to what the screens list.

Files likely affected:
`web/index.html`, `android/app/src/main/kotlin/com/zarvismobile/app/navigation/NavGraph.kt`, `android/features/feature-tasks/src/main/kotlin/com/zarvismobile/feature/tasks/TasksScreen.kt`

Approval:
PENDING

---

### UX-006 — Keep Plans one tap away on phone widths

Category:
Navigation

Current problem:
Desktop sidebar includes Plans. The phone bottom nav does not. On a phone, Plans is only reached from the Home “Plans & quotas” link. Android also keeps Plans off the bottom bar and reaches it from a Home card, so a phone user who is already in Capabilities or Activity has no in-screen path to quotas.

Evidence:
`web/index.html` — `.sidebar-nav` has `data-view="plans"`; `.bottom-nav` has Home, Chat, Features, Activity, Settings and no Plans item. Home link is `button.home-link-btn[data-home-view="plans"]`. `web/app.js` — `setupBottomNav()` already navigates `data-home-view` through `setActiveView`. Android: Plans is `Routes.SUBSCRIPTION`, opened from `HomeScreen` “Manage subscription”, not from `BOTTOM_NAV_ITEMS`.

Recommended solution:
Do not add a sixth bottom-nav item. Reuse `.home-link-btn` in the Capabilities and Activity `.view-header` blocks with `data-home-view="plans"`. On Android, add a `TextButton` “Plans & quotas” in the Capabilities header and the Activity header, calling the existing subscription navigation callback (pass `onNavigateToSubscription` into those screens from `NavGraph.kt`).

Why:
Plans stays a secondary destination, which matches the five-item phone bar, and is still available without returning to Home.

Priority:
High

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Phone and tablet web: Capabilities and Activity headers show “Plans & quotas →” beside the title, using the current pill button. Tap opens the existing Plans view and highlights no bottom-nav item (Plans is not a tab). Android: the same label sits under the screen title and opens the existing Plans screen. Desktop sidebar is unchanged.

Files likely affected:
`web/index.html`, `android/features/feature-home/src/main/kotlin/com/zarvismobile/feature/home/CapabilitiesScreen.kt`, `android/features/feature-tasks/src/main/kotlin/com/zarvismobile/feature/tasks/TasksScreen.kt`, `android/app/src/main/kotlin/com/zarvismobile/app/navigation/NavGraph.kt`

Approval:
PENDING

---

### UX-007 — Add a visible Back row on Android screens that hide the bottom bar

Category:
Mobile

Current problem:
Conversation opened from Home, Developer Agent, and Plans are full-screen routes. The bottom bar hides, and none of these screens draw an Up control. Settings subpages already show “‹ Back”, but the Settings hub, which is also pushed off the bar, does not. System Back works, and it is easy to miss.

Evidence:
`NavGraph.kt` — `showBottomBar` is true only for Home, Chat, Capabilities, and Activity. `Routes.CONVERSATION`, `DEVELOPER`, `SUBSCRIPTION`, and `SETTINGS` hide it. `ConversationScreen.kt` and `DeveloperScreen.kt` start with content, not a back row. `SubscriptionScreen.kt` starts at “Plans & Quotas”. `SettingsScreen.kt` hub has no back row; `SettingsSubPage` does (`TextButton` “‹ Back”).

Recommended solution:
Reuse the Settings subpage header row (Back text button + title) at the top of Conversation, Developer, Plans, and the Settings hub. Wire Back to `popBackStack()`. On the Chat tab (`Routes.CHAT`), keep the bottom bar and do not add a second Back control. Conversation should also use the web chat title treatment: “Chat with ZARVIS” plus the existing `StatusPulseBadge`, so the pushed screen and the Chat tab look like one product.

Why:
Leaving a full-screen flow is visible. Gesture navigation remains available. The Chat tab stays a root destination.

Priority:
High

Implementation scope:
Medium

Risk:
Low

Suggested UI behavior:
From Home, opening chat, a skill, Developer, Plans, or Settings shows a top row: Back, then the screen title. Back returns to the previous screen. The Chat tab still shows the glass bottom bar and no Back button. Settings subpages keep their current Back, which returns to the hub rather than leaving Settings.

Files likely affected:
`android/features/feature-conversation/src/main/kotlin/com/zarvismobile/feature/conversation/ConversationScreen.kt`, `android/features/feature-developer/src/main/kotlin/com/zarvismobile/feature/developer/DeveloperScreen.kt`, `android/features/feature-subscription/src/main/kotlin/com/zarvismobile/feature/subscription/SubscriptionScreen.kt`, `android/features/feature-settings/src/main/kotlin/com/zarvismobile/feature/settings/SettingsScreen.kt`, `android/app/src/main/kotlin/com/zarvismobile/app/navigation/NavGraph.kt`

Approval:
PENDING

---

### UX-008 — Raise icon-only and compact controls to a 44px hit area without enlarging the icon

Category:
Accessibility

Current problem:
Several controls are smaller than a 44×44 CSS-pixel (or 48dp) touch target. The visual size can stay small; the hit area cannot. This shows up on the web back buttons, attachment remove, waveform stop, copy chip, task actions, compact home links, and on the Android bottom bar, whose row is only icon plus a few pixels of padding and which disables the ripple.

Evidence:
`web/styles.css` — `.chat-back-btn, .back-btn` are 36×36; `.attachment-remove` is 28×28; `.waveform-stop` is 20×20; `.widget-copy-btn` uses `padding:4px 10px`; `.task-action-btn` uses `padding:6px 11px`; `.home-link-btn` is `min-height:34px` and 31px under 420px; `.option-btn` / `.zarvis-btn` use 8px vertical padding; `.capability-run-btn` is `min-height:40px`. `GlassBottomBar.kt` — `padding(horizontal = 10.dp, vertical = 6.dp)` and `indication = null`.

Recommended solution:
Keep icon glyphs at their current pixel size. Expand the clickable box to at least 44×44 on web (`min-width` / `min-height`, extra padding) and at least 48dp on Android (`Modifier.heightIn(min = 48.dp)` plus horizontal padding on each `GlassBottomBar` item). Restore the default click indication on the bar so a tap is visible. Do not change label type size in this item.

Why:
Thumb taps land on Back, remove-file, stop-speech, and nav items without hitting a neighbor. The visual density of the glass bar stays the same.

Priority:
High

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Back, remove, stop, copy, task actions, billing/language pills, and each bottom-nav item accept a tap anywhere in a 44×44 (web) or 48dp (Android) box. Icons and labels do not grow. The Android bar shows the existing Material ripple on press.

Files likely affected:
`web/styles.css`, `android/core/core-ui/src/main/kotlin/com/zarvismobile/core/ui/components/GlassBottomBar.kt`

Approval:
PENDING

---

### UX-009 — Raise supporting text off the 8–10px range

Category:
Typography

Current problem:
Labels, feature descriptions, trust steps, quick-action lead-in, settings row subtitles, and protection-rule body copy are set between 8px and 10.5px. That is below a comfortable reading size on a phone, and several of those strings are the only explanation of what a control does. Display type (hero title, page `h2`) is already in a healthy range and should stay.

Evidence:
`web/styles.css` — `.home-section-eyebrow` 8.5px; `.home-feature-copy small` 9.5px (9.2px under 420px); `.home-trust-row` 9px (8px under 420px); `.home-kicker` 10px (8px under 420px); `.quick-actions-lead` 9px; `.nav-item` 10px (9px under 420px); `.settings-entry small` 10.5px; `.protection-rule small` and `.protection-note span` 9.5px; `.hero-status` 9px; `.task-status-badge` 9px.

Recommended solution:
Set a floor in the existing rules: supporting sentences at 12px, metadata (eyebrows, status pills, badges) at 11px with `letter-spacing` reduced slightly so uppercase labels still fit. Bump `.nav-item` label to 11px. Do not change `--font-display` sizes for `.hero-title`, `.view-header h2`, or the reactor wordmark.

Why:
Feature cards, protection rules, and status pills can be read without zooming. Hierarchy stays: titles remain larger than descriptions.

Priority:
High

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Feature-card descriptions, settings subtitles, and protection copy read at 12px. Eyebrows and status pills read at 11px and stay uppercase. Page titles and the reactor wordmark are unchanged. On a 360px-wide screen, feature cards may grow slightly in height; the two-column grid stays.

Files likely affected:
`web/styles.css`

Approval:
PENDING

---

### UX-010 — Keep the composer from triggering browser zoom

Category:
Mobile

Current problem:
The chat field and the settings voice `<select>` use a font size under 16px. Mobile Safari zooms the page when a field under 16px is focused. The web shell sets `body { position:fixed; overflow:hidden }`, so that zoom fights the fixed app frame and can leave the composer or bottom nav misaligned until the next reload.

Evidence:
`web/styles.css` — `.text-input { font-size:13.5px }`, `.text-input-block { font-size:13px }`, `body { position:fixed; inset:0; overflow:hidden }`. `web/index.html` — `#text-input`, `#voice-select`.

Recommended solution:
Set `.text-input` and `.text-input-block` to `font-size:16px` on viewports under 1024px. Leave button and card type sizes alone. Placeholder color stays `--muted` / the current placeholder color.

Why:
Focusing the composer keeps the layout stable. Typed text matches the size users expect in a mobile field.

Priority:
Critical

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Tapping the composer or the voice selector on a phone does not zoom the viewport. The field remains one line tall at 44px until UX-011 is also approved. Desktop type size may stay 16px as well so the rule is one declaration.

Files likely affected:
`web/styles.css`

Approval:
PENDING

---

### UX-011 — Let the composer grow for the prompts Home already inserts

Category:
Interaction

Current problem:
Home feature cards insert a full sentence into a single-line field. The web field is `type="text"` at a fixed 44px height. Android `ZarvisComposer` sets `singleLine = true`. Long prompts scroll sideways inside the field, so the user cannot see the request they are about to send. That conflicts with the Home copy that says the prompt is ready to edit.

Evidence:
`web/index.html` — `#text-input` `type="text"`; feature cards `data-feature-prompt` (several are full sentences). `web/styles.css` — `.text-input { height:44px }`. `web/app.js` — `setupHomeFeatures()` assigns `el.input.value` and focuses it. `ZarvisTextField.kt` — `ZarvisComposer` `singleLine = true`.

Recommended solution:
Change `#text-input` to a `<textarea rows="1">` inside the existing `.command-bar`, auto-growing up to four lines (max-height about 96px) with the same borderless styling. Submit on Enter, and allow Shift+Enter to insert a newline. On Android, set `singleLine = false`, `maxLines = 4`, and submit from the existing send `IconButton` (keyboard action Send). Keep mic, attach, and send in the same bar.

Why:
A prefilled research or developer prompt can be read and edited before it is sent. The bar still collapses to one line for short messages.

Priority:
High

Implementation scope:
Medium

Risk:
Medium

Suggested UI behavior:
Empty composer is one line, placeholder “Ask Zarvis…”. Pasting or prefilling a long prompt grows the field up to four lines, then scrolls inside the field. Enter sends. Shift+Enter adds a line. Send still stops a running turn when the button is in `.stop-mode`. The attachment chip stays above the bar.

Files likely affected:
`web/index.html`, `web/styles.css`, `web/app.js`, `android/core/core-ui/src/main/kotlin/com/zarvismobile/core/ui/components/ZarvisTextField.kt`

Approval:
PENDING

---

### UX-012 — Trap focus in the confirm dialog and style destructive confirms only when the action is destructive

Category:
Accessibility

Current problem:
Account deletion opens `#confirm-modal`, which has `role="alertdialog"` and labels, but focus is not moved into the dialog, Escape does not close it, the scrim does not cancel, and focus is not returned to the button that opened it. The confirm button always uses `.zarvis-btn-danger`, so any future non-destructive confirm would look like Delete. Escape is already used elsewhere to cancel a busy chat turn, and that path should keep working when the dialog is closed.

Evidence:
`web/index.html` — `#confirm-modal`, `#confirm-modal-confirm` class `zarvis-btn zarvis-btn-danger`. `web/app.js` — `showConfirmModal()` toggles `hidden` and binds confirm/cancel clicks only. Escape handler near line 283 calls `cancelCurrentTurn()` when `isBusy()`, and does not check the modal.

Recommended solution:
On open, focus Cancel. Cycle Tab between Cancel and Confirm. Escape and scrim click run the existing close path and do not delete. On close, return focus to the control that called `showConfirmModal`. Add `zarvis-btn-danger` only when the confirm label is a destructive action (today: “Delete”). Other confirms use `.zarvis-btn-primary`.

Why:
Keyboard and screen-reader users stay inside the dialog until they choose. A destructive action is visually distinct from a normal confirm.

Priority:
High

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Delete account opens the dialog with focus on Cancel. Tab moves between Cancel and Delete. Escape, scrim click, and Cancel dismiss with no request. Delete runs the existing account deletion. After close, focus returns to “Delete account”. A busy chat turn still cancels on Escape when the dialog is not open.

Files likely affected:
`web/app.js`, `web/index.html`, `web/styles.css`

Approval:
PENDING

---

### UX-013 — Point assistive tech at the new message, the active language, and the mic control

Category:
Accessibility

Current problem:
The whole conversation is one polite live region, so a new reply can cause the entire thread to be announced again. The document language stays `en` after the user selects हिंदी, so a Hindi voice may not be used. The mic and send controls expose only `title`, which is unreliable for assistive tech, while the attach control already has `aria-label`. The activity dot is a 7px circle with no text, inside the Activity nav button, so the button name does not change when work is in progress.

Evidence:
`web/index.html` — `<html lang="en">`, `#conversation aria-live="polite"`, `#mic-btn` title only, `#send-btn` title only, `#upload-btn` has `aria-label`, `.nav-badge` spans `#activity-badge` and `#activity-badge-mobile`. `web/app.js` — `applyLanguage()` updates copy and does not set `document.documentElement.lang`; `fetchTasks()` toggles badge `hidden` from the active task count.

Recommended solution:
Remove `aria-live` from `#conversation`. Add a visually hidden status node (one existing class, clipped off-screen) that announces only the latest assistant or error line. In `applyLanguage()`, set `document.documentElement.lang` to `en` or `hi`. Give `#mic-btn` and `#send-btn` `aria-label` values from the existing `COPY` strings, and update the send label when the button enters `.stop-mode` (“Stop”). When the activity badge is shown, append “, activity in progress” to the Activity nav button’s accessible name via `aria-label`, and clear it when the badge hides.

Why:
A reply is announced once. Hindi mode is exposed to the platform. Mic, stop, and in-progress activity are available without relying on color or a `title` tooltip.

Priority:
High

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Sending a message announces the new reply or the error bubble, not the older thread. Switching to हिंदी sets the page language to Hindi immediately. VoiceOver/TalkBack names the mic “Speak” (or the Hindi copy) and names Send “Send” or “Stop” to match the icon on screen. Activity’s button name gains “activity in progress” while the cyan dot is visible.

Files likely affected:
`web/index.html`, `web/app.js`, `web/styles.css`

Approval:
PENDING

---

### UX-014 — Mark the Android bottom bar selection once, and stop double-speaking the label

Category:
Accessibility

Current problem:
Each Android nav item puts the label in both the icon `contentDescription` and the visible `Text`. TalkBack speaks the destination twice. The item also has no selected state, so the active tab is only a color change.

Evidence:
`GlassBottomBar.kt` — `Icon(..., contentDescription = item.label)` and `Text(item.label)`. Selection is color only (`animateColorAsState`). `indication = null` is covered separately in UX-008.

Recommended solution:
Set the icon `contentDescription` to `null`. Add `semantics { selected = selected; role = Role.Tab }` on the item `Column`. Keep the visible label.

Why:
The bar is one tab list. The selected tab is programmatically selected, and the name is spoken once.

Priority:
High

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Swiping through the bar announces “Home, tab” and “selected” on the active item only. Icons stay decorative. Visual color change is unchanged.

Files likely affected:
`android/core/core-ui/src/main/kotlin/com/zarvismobile/core/ui/components/GlassBottomBar.kt`

Approval:
PENDING

---

### UX-015 — Separate user and assistant turns on Android the way Chat already does on the web

Category:
Visual hierarchy

Current problem:
Android conversation turns render the user line and the assistant line as two full-width `ZarvisCard`s with the same surface. Web Chat uses a gradient bubble aligned to the end for the user and a light card aligned to the start for ZARVIS, including a small “Z” mark. On Android it is ambiguous who said which line, especially after several turns.

Evidence:
`ConversationScreen.kt` — `TurnBubble()` wraps `turn.userText` and `turn.assistantText` in identical `ZarvisCard`s. Web reference: `web/styles.css` `.bubble.user` and `.bubble.assistant`.

Recommended solution:
In `TurnBubble`, align the user text to `Alignment.End` with `MaterialTheme.colorScheme.primary` as the container and `onPrimary` as the text, max width about 88%. Align the assistant text to `Alignment.Start` on `ZarvisCard` / `GlassSurface`, max width about 88%. Use `bodyLarge` for both. Do not add avatars or a new bubble component library. If `assistantText` is null while the voice state is executing, keep the existing `StatusPulseBadge` instead of an empty card.

Why:
A thread can be scanned by alignment and color using colors the theme already defines. Web and Android conversations read as the same exchange.

Priority:
High

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
User text sits on the trailing edge on a primary-colored bubble. ZARVIS sits on the leading edge on a card. Long text wraps inside the bubble. Error copy, when present, uses `colorScheme.error` on the assistant bubble. Dark theme uses the same roles so contrast follows `ZarvisTheme`.

Files likely affected:
`android/features/feature-conversation/src/main/kotlin/com/zarvismobile/feature/conversation/ConversationScreen.kt`

Approval:
PENDING

---

### UX-016 — Show a stable loading and empty state on Activity instead of a blank list

Category:
Interaction

Current problem:
Web Activity clears the list before the request returns, so a refresh flashes an empty page. Failure has no dedicated empty state on that screen (the capabilities list does). Android Activity shows a plain sentence when there are no tasks and no progress indicator while `isLoading` is true, unlike Capabilities, which centers `CircularProgressIndicator`.

Evidence:
`web/app.js` — `refreshActivity()` sets `el.activityTaskList.innerHTML = ""` before `await fetchTasks()`, then appends `.task-empty` only when the array is empty. `web/styles.css` — `.task-empty`. `TasksScreen.kt` — empty copy when `tasks.isEmpty() && !isLoading`; `uiState.error` is a bare `Text`; no loading branch. `CapabilitiesScreen.kt` — loading, error, and content branches.

Recommended solution:
On web, leave existing cards in place until the new list is ready, and set the refresh button label to “Refreshing…” with `disabled` and `aria-busy="true"` on `#activity-task-list`. If the request fails, show a `.task-empty` line: “Couldn't load activity right now.” plus the existing refresh button. On Android, mirror the Capabilities `when` branches: progress indicator, error text in `colorScheme.error`, empty sentence inside a `ZarvisCard`, otherwise the task rows.

Why:
Refresh does not look like data loss. Failure and emptiness are different, and both clients use the same structure.

Priority:
Medium

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
First visit with no tasks shows the current empty sentence inside the existing empty style. Pulling or tapping Refresh keeps the previous cards, disables the button, and then replaces the list. A failed load shows the error sentence and leaves Refresh available. Android shows a centered progress indicator only on the initial load.

Files likely affected:
`web/app.js`, `android/features/feature-tasks/src/main/kotlin/com/zarvismobile/feature/tasks/TasksScreen.kt`

Approval:
PENDING

---

### UX-017 — Confirm before clearing the local session

Category:
Interaction

Current problem:
“Clear local session” on web reloads immediately and drops the conversation. It uses the same danger button style as “Delete account”, but delete is the only action that asks for confirmation. Android clears tokens and navigates home with the same immediacy. The protection copy says destructive actions should confirm; session clearing is not account deletion, and it still destroys the on-device session.

Evidence:
`web/index.html` — `#settings-clear-session-btn` class `zarvis-btn zarvis-btn-danger`. `web/app.js` — `clearLocalSession()` removes tokens and calls `location.reload()` with no modal. `SettingsScreen.kt` — `ZarvisDestructiveButton("Clear local session")` calls `viewModel.clearLocalSession()` and `onSessionCleared()` directly. Delete already uses `showConfirmModal` on web and `AlertDialog` on Android.

Recommended solution:
Style the session button as `.zarvis-btn-secondary` on web and `ZarvisSecondaryButton` on Android. Before running the existing clear function, open the existing confirm dialog with title “Clear local session?”, body that states the account is not deleted and this device will start a fresh session, and confirm label “Clear session”. On web, pass that label so UX-012 can keep it non-danger if both are approved; if UX-012 is not approved, add a non-danger class on this button only inside `showConfirmModal` when `confirmLabel !== "Delete"`.

Why:
A mis-tap does not wipe the session. Delete remains the red action. The confirmation pattern already exists.

Priority:
Medium

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Tap “Clear local session” and a dialog appears. Cancel leaves the session. Confirm runs today’s clear-and-reload (web) or clear-and-return-home (Android). The button is not red.

Files likely affected:
`web/index.html`, `web/app.js`, `android/features/feature-settings/src/main/kotlin/com/zarvismobile/feature/settings/SettingsScreen.kt`

Approval:
PENDING

---

### UX-018 — Describe Developer Agent as the chat handoff the public web actually performs

Category:
Consistency

Current problem:
The Home “Developer Agent” card tells the user that analysis and authorized implementation happen through a protected developer workflow. On the public web, that card only opens Chat and prefills a sentence. There is no developer view in `web/index.html`. `web/app.js` still looks for `#view-developer` and related controls that are not in the page. Android does have a real read-only Developer screen, reached by a plain text button that does not match the other Home cards.

Evidence:
`web/index.html` — feature card `data-feature-key="developer"` and the `<small>` copy about the protected workflow. `web/app.js` — `setupHomeFeatures()` sends every `[data-feature-prompt]` card to Chat; `setupDeveloper()` returns immediately when `#developer-analyze-btn` is missing. `HomeScreen.kt` — `TextButton` “Open Developer Mode”. `DeveloperScreen.kt` — read-only analysis, with an explicit note that pull requests are not enabled.

Recommended solution:
On web, rewrite that card’s `<small>` so it matches the other feature cards: it opens Chat with an editable request to analyze a repository the user will name. Do not mention a separate implementation screen. Leave `setupDeveloper()` unused rather than mounting a hidden developer form in the public UI. On Android, replace the text button with a `ZarvisCard` titled “Developer Agent”, subtitle “Read-only repository analysis”, and a `TextButton` “Open” that calls the existing `onNavigateToDeveloper`.

Why:
The public web does not advertise a workflow it does not show. Android’s entry matches the other Home cards and the screen’s real capability (analyze, not implement).

Priority:
High

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Web: tapping Developer Agent opens Chat with the existing prefilled sentence focused at the end. The card description no longer promises a separate protected implementation screen. Android: Home shows a card consistent with “What can you do?” and “Subscription”. Opening it shows the current analyze form.

Files likely affected:
`web/index.html`, `android/features/feature-home/src/main/kotlin/com/zarvismobile/feature/home/HomeScreen.kt`

Approval:
PENDING

---

### UX-019 — Add the web Rules & Protection page to Android Settings

Category:
Consistency

Current problem:
Web Settings includes a Rules & Protection page: confirmation before destructive actions, no continuous microphone, files only when attached, and a note not to claim protections that are not implemented. Android Settings has Privacy, Security, Data, and Developer, and no equivalent page. The rules themselves are product copy, not new enforcement.

Evidence:
`web/index.html` — `data-settings-page="protection"` and `[data-settings-panel="protection"]` (`.protection-hero`, `.protection-rule`). `SettingsScreen.kt` — `SettingsPage` enum has no protection entry. Android already confirms account deletion with `AlertDialog` and starts listening from an orb tap (`ConversationScreen.kt`).

Recommended solution:
Add a `SettingsPage` entry, icon `Icons.Filled.Shield` or the existing `Security` icon if Shield is not already imported, titled “Rules & Protection”. Body is `ReadOnlyCard`s using the same six rules already written in the web panel. Do not add toggles. The status line can say “These rules describe the controls this build actually has.”

Why:
Both clients explain the same safety boundaries. Android does not gain fake switches.

Priority:
Medium

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Settings hub lists Rules & Protection near Security. Opening it shows stacked read-only cards and Back to the hub. No switch changes behavior.

Files likely affected:
`android/features/feature-settings/src/main/kotlin/com/zarvismobile/feature/settings/SettingsScreen.kt`

Approval:
PENDING

---

### UX-020 — Retire the always-on “Online” dot and use the chat status pill

Category:
Interaction

Current problem:
The chat header shows a green dot labeled “Online” on every visit. Nothing checks the backend before painting it. The orb status pill already reports Ready, Listening, Executing, and Error. Two status indicators can disagree, and a green dot implies a live connection that was not verified.

Evidence:
`web/index.html` — `.chat-live-dot` with `aria-label="Online"` inside `.chat-page-header`. `web/styles.css` — `.chat-live-dot` is always `background:var(--green)`. Status lives in `#hero-status` / `#hero-status-label`, driven by `data-state` on the orb.

Recommended solution:
Remove `.chat-live-dot` from the header. Keep `#hero-status` as the only status while the hero is visible. When messages hide the hero (`#view-chat.has-messages`), move that same pill into the header’s trailing slot (the element already exists; show it in the header and hide the in-hero copy so it is not duplicated).

Why:
Status reflects the turn state the app already tracks. The header does not claim the service is online.

Priority:
Medium

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Before the first message, the status pill sits under the hero subtitle, as it does now, and the header has Back and the title only. After messages exist, the hero hides and the same pill (Ready, Listening, Error, …) sits at the end of the header. Color still comes from `[data-state]` rules.

Files likely affected:
`web/index.html`, `web/styles.css`, `web/app.js`

Approval:
PENDING

---

### UX-021 — Quiet decorative motion on small screens and honor reduced motion on Android

Category:
Animation

Current problem:
Home runs many infinite animations at once: aura, core glow, orb float, three orbits, five dots, five particles, CTA sheen, and arrow pulse, plus blurred glass on the nav and cards. Web already collapses animation when `prefers-reduced-motion: reduce` is set. Android `AiOrb` always runs infinite pulse, glow, and rotation, including while idle, and does not read the system animator scale. On a low-end phone the Home reactor and the listening orb keep doing work after the user has asked the system to reduce motion.

Evidence:
`web/styles.css` — keyframes `home-aura`, `core-aura`, `orb-float`, `orbit-a/b/c`, `dot-pulse`, `particle-pulse`, `cta-sheen`, `arrow-pulse`, and the `prefers-reduced-motion` block at the end of the motion section. `AiOrb.kt` — `rememberInfiniteTransition` for pulse, glow, and rotation with no animator-scale check.

Recommended solution:
On web, inside the existing `@media (max-width:420px)` block, set `.dot, .particle, .orbit, .home-stage .chat-launch-card::before` to `animation:none`. Keep `orb-float` and the status/listening animations. On Android, if `Settings.Global.ANIMATOR_DURATION_SCALE` is `0f`, draw `AiOrb` in a static frame (no `infiniteTransition`). Use the platform setting only; do not add a motion library.

Why:
Small phones keep the reactor and drop the extra orbiting layers. Users who disable animations get a still orb that still changes color by voice state.

Priority:
Medium

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
On a narrow phone, the core orb still floats slowly and the listening state still pulses. Dots, particles, orbit ribbons, and the CTA sheen are still. With Android animator duration set to off, the orb is a static gradient that recolors for listening, error, and success. Web `prefers-reduced-motion` behavior stays as it is.

Files likely affected:
`web/styles.css`, `android/core/core-ui/src/main/kotlin/com/zarvismobile/core/ui/components/AiOrb.kt`

Approval:
PENDING

---

### UX-022 — Draw bottom-nav and sidebar icons with the existing stroke SVGs

Category:
Consistency

Current problem:
Primary navigation uses text glyphs (`⌂`, `◌`, `✦`, `▤`, `◇`, `⚙`). Those characters change shape and alignment between Android, Windows, and iOS, and they do not match the 2px stroke icons already used for Back, mic, attach, and send. Settings mixes the same glyphs with an emoji shield. Android uses Material icons, which is appropriate on that platform; the gap is inside the web UI.

Evidence:
`web/index.html` — `.nav-item span` glyph labels in both `#sidebar-nav` and `#bottom-nav`; settings icons such as `◉`, `文`, `◈`, and `🛡` on `.settings-entry-icon`. Stroke icons already exist on `#chat-back-btn`, `#mic-btn`, `#upload-btn`, and `#send-btn`.

Recommended solution:
Replace the six nav glyphs with inline SVGs in the same 24×24, `stroke="currentColor"`, `stroke-width="2"` style as the composer icons. Keep the accessible name in the second `<span>` (“Home”, “Chat”, and so on) and mark the SVG `aria-hidden="true"`. Leave Android on Material icons. Do not add an icon font or package.

Why:
Nav icons align on a shared grid, inherit the active white color, and no longer depend on which emoji font the device ships.

Priority:
Medium

Implementation scope:
Medium

Risk:
Low

Suggested UI behavior:
Each nav item shows a 18px stroke icon above the label on phones and beside the label in the sidebar. The active item still uses the gradient pill and white icon. Settings row icons can stay as they are in this change; only primary nav is in scope.

Files likely affected:
`web/index.html`, `web/styles.css`

Approval:
PENDING

---

### UX-023 — Collapse the empty Chat hero on short screens so quick actions and the composer stay on screen

Category:
Mobile

Current problem:
Before the first message, Chat stacks a header, a second orb, a greeting, a title, a subtitle, a status pill, a lead-in, and wrapping quick-action chips above the composer and the bottom nav. On a short phone that stack pushes the chips and the field below the fold. The hero is already removed once `.has-messages` is set, so the crowding is only the empty state.

Evidence:
`web/index.html` — `#view-chat` children: `.chat-page-header`, `.hero` (`#hero-greeting`, `#hero-title`, `#hero-subtitle`, `#hero-status`), `#quick-actions-lead`, `#categories`. `web/styles.css` — `#view-chat.has-messages .hero` (and the lead/categories) set `display:none`. No short-height rule targets the empty chat hero. `.composer` and `.bottom-nav` are outside the scrolling stage.

Recommended solution:
In the existing `@media (max-height:700px)` query, hide `.hero-greeting` and `.hero-subtitle`, and tighten `.hero .orb` / `.orb-wrap` from 74px to about 56px. Keep the title, the status pill, and the quick actions. Do not hide the composer.

Why:
The empty chat state still introduces ZARVIS and still offers starter actions, and the field is on screen when the keyboard is closed.

Priority:
Medium

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
On a short phone, empty Chat shows header, a smaller orb, the title, the status pill, and as many quick actions as fit above the composer. Greeting and subtitle return when the height is above 700px. After the first message, today’s rule still hides the whole hero.

Files likely affected:
`web/styles.css`

Approval:
PENDING

---

### UX-024 — Let onboarding move back one page

Category:
Mobile

Current problem:
Android onboarding can skip or go forward. It cannot return to the previous page. The page indicator dots are 8dp and not buttons, so they are not a back affordance either. There is no web onboarding counterpart.

Evidence:
`OnboardingScreen.kt` — header action is `ZarvisGhostButton` “Skip”; footer action is `ZarvisPrimaryButton` “Next” / “Get started”. `PageIndicator` uses `Surface` `size(8.dp)` with no click. `OnboardingViewModel` is only referenced for `skip`, `next`, and page index.

Recommended solution:
When `pageIndex > 0`, show a second `ZarvisGhostButton` “Back” opposite Skip, calling a `previous()` function on the existing view model that decrements the index and does not clear completion. Keep the dots decorative (`contentDescription` unset, row `semantics` of “Page n of n”).

Why:
A mis-tap on Next does not force the user to skip the rest of onboarding.

Priority:
Low

Implementation scope:
Small

Risk:
Low

Suggested UI behavior:
Page 1 shows Skip only. Later pages show Back on the start side and Skip on the end side. Back reveals the previous title and body. Next and Get started behave as they do now. Dots still reflect the index and are not focused.

Files likely affected:
`android/features/feature-onboarding/src/main/kotlin/com/zarvismobile/feature/onboarding/OnboardingScreen.kt`, `android/features/feature-onboarding/src/main/kotlin/com/zarvismobile/feature/onboarding/OnboardingViewModel.kt`

Approval:
PENDING

---

## UI/UX Selection Report

| ID | Screen | Recommendation | Priority | Effort | Risk | Approval |
|----|--------|----------------|----------|--------|------|----------|
| UX-001 | Home | Start Home scroll at the top instead of vertically centering overflow | Critical | Small | Low | PENDING |
| UX-002 | Home | Shorten the reactor on short phone heights | High | Small | Low | PENDING |
| UX-003 | Settings / Appearance | Apply Dim by overriding existing color tokens | Critical | Medium | Low | PENDING |
| UX-004 | Settings | One Back + title row on subpages; no Back on the hub | High | Small | Low | PENDING |
| UX-005 | Navigation | Use Capabilities and Activity on both clients | High | Small | Low | PENDING |
| UX-006 | Plans | Link to Plans from Capabilities and Activity headers | High | Small | Low | PENDING |
| UX-007 | Android pushed screens | Visible Back on Conversation, Developer, Plans, and Settings | High | Medium | Low | PENDING |
| UX-008 | Controls | 44px / 48dp hit areas; keep icon size | High | Small | Low | PENDING |
| UX-009 | Typography | Floor supporting copy at 12px and metadata at 11px | High | Small | Low | PENDING |
| UX-010 | Composer | 16px field text so mobile browsers do not zoom | Critical | Small | Low | PENDING |
| UX-011 | Composer | Grow to four lines for prefilled prompts | High | Medium | Medium | PENDING |
| UX-012 | Confirm modal | Focus trap, Escape, restore focus; danger style only for Delete | High | Small | Low | PENDING |
| UX-013 | Chat / language / Activity | Announce the latest reply, set `lang`, name mic and activity | High | Small | Low | PENDING |
| UX-014 | Android bottom nav | Selected tab semantics; speak the label once | High | Small | Low | PENDING |
| UX-015 | Android Chat | User and assistant bubbles with existing theme colors | High | Small | Low | PENDING |
| UX-016 | Activity | Keep the list during refresh; match empty, loading, and error | Medium | Small | Low | PENDING |
| UX-017 | Settings | Confirm before clearing the local session | Medium | Small | Low | PENDING |
| UX-018 | Developer Agent | Web card matches the chat handoff; Android uses a home card | High | Small | Low | PENDING |
| UX-019 | Rules & Protection | Read-only protection page on Android Settings | Medium | Small | Low | PENDING |
| UX-020 | Chat | Drop the always-green Online dot; reuse the status pill | Medium | Small | Low | PENDING |
| UX-021 | Home / voice orb | Fewer decorative loops on narrow screens; static orb when motion is off | Medium | Small | Low | PENDING |
| UX-022 | Navigation | Stroke SVGs for web nav icons | Medium | Medium | Low | PENDING |
| UX-023 | Chat | Shorter empty hero under 700px height | Medium | Small | Low | PENDING |
| UX-024 | Onboarding | Back to the previous page | Low | Small | Low | PENDING |

---

### Recommended First UI/UX Improvements

These are the highest-impact, lowest-risk items. They are still pending. Approving this section in prose is not approval; use the IDs.

1. **UX-001** — Home scroll origin. Small CSS change, fixes a page that can hide its own hero.
2. **UX-010** — 16px composer text. Stops mobile browser zoom inside a fixed shell.
3. **UX-003** — Dim token overrides. The control already exists and currently does nothing.
4. **UX-004** — Settings subpage header. Removes the blank Back button and the double title.
5. **UX-008** — Touch targets. Same components, larger hit areas.
6. **UX-012** and **UX-013** — Dialog focus and chat announcements. Both stay inside `app.js` and the current modal.
7. **UX-005** and **UX-015** — Shared names, and Android bubbles that match web Chat. Small, visible consistency.
8. **UX-018** — Developer card copy on the public web so it does not describe a screen the page does not contain.

Not in the first wave: **UX-011** (composer grows to multiple lines; medium risk because Enter-to-send behavior changes) and **UX-022** (nav icon swap; broader visual change). Both are worth doing after the items above.

`APPROVE ALL LOW-RISK UX` would include every row whose Risk is Low, including Medium and Low priority. It would not include UX-011.
