# ZARVIS Android: the Queen theme

The Android app's look: a deep plum night with gold, rose and amethyst light, slowly turning gold rays, falling glitter and a crowned,
jewel-like orb. **Queen Dark** is the default appearance and **Queen Light** (lavender) is the same theme for daylight, chosen in
Settings › Appearance. The website keeps Aurora Glass ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)) until it moves to Queen in its own change.

The full design (all 22 Android boards, the navigation, the speed rules and the scan checklist) is on the design canvas
<https://claude.ai/artifact/SG5heBSrDENnAK1Ja9vWGx>, page **Android · Queen (sab pages)**.

Product rules do not change with the look: no fake capability or state, status words say what is really happening, every visible
string has Hindi, and text is at least 4.5:1 on whatever it is drawn on.

## Phases

| Phase | What | Status |
| --- | --- | --- |
| 1 | The palette, Material colour roles, the animated page, the orb, the tab bar with Chat as the gold orb in the middle, Queen Dark as the default, the Settings wording | Done |
| 2 | Sora/Orbitron type; the crown, gold lettering, gold section labels, jewel icons and badges; Home (A03); launch, welcome, start error, capability detail and Developer Agent on the Queen page; the Chat look (A04) and interrupted card; the gold skeleton, crown empty state and ruby error card (A22); Queen dialogs (A21); jewel Settings rows (A15); Lightweight mode | Done |
| Later | The items under *Not done yet* below | Open |

Phase 1 changed no behaviour. Phase 2 changes one: the Home orb ("Tap to speak") and the composer's mic open Chat already listening,
through ZARVIS's explanation and Android's permission like every other microphone start. Everything else keeps its content, order and
actions.

### Not done yet, and why

* **Replies streaming word by word.** The backend already streams (`/orchestrator/turn-stream`, which the website uses), but the Android
  orchestrator asks for the whole reply at once. Streaming means a new streaming client and a change in how the orchestrator handles a
  turn, which is behaviour, not look, so it is its own change.
* **Chat tab renamed Talk.** The Home orb now does what Talk would do. Renaming the tab changes what the emulator tests tap
  (`ChatSyncTest`, `ShellScreenshotTest` find it by the word "Chat") and would start the microphone on every tab tap.
* **Dialogs as bottom sheets.** They keep Material's dialog, restyled, because the emulator tests drive them through UI Automator by
  their exact words and a sheet changes when they appear and how Back closes them.
* **Offline banner.** The app has no connectivity state to show truthfully yet; failed loads already say so with Try again.
* **Appearance preview cards, entrance animations, chips marquee.** Smaller polish; the switches and chips work as they are.

## Palette (`core-ui/.../theme/Color.kt`)

| Role | Queen Dark | Queen Light |
| --- | --- | --- |
| Page (`background`) | `#14041F` plum night | `#FBF4FF` lavender |
| Surface / variant / highest | `#200A30` / `#2A0F3D` / `#36154D` | `#FFFFFF` / `#F8F0FF` / `#F4E9FD` |
| Text / secondary text | `#FFF7FB` / `#ECD3F5` | `#1A0B3B` / `#4C3D75` |
| Primary (selected tab, focus, links) | gold `#FDE68A`, ink `#2A0A36` on it | royal purple `#7E22CE`, white on it |
| Error / warning / success | `#FDA4AF` / `#FCD34D` / `#86EFAC` | `#B42318` / `#92400E` / `#065F46` |
| Text accents (`ZarvisAccents`) | cyan `#67E8F9`, violet `#E9D5FF`, pink `#F9A8D4`, gold `#FDE68A` | cyan `#155E75`, violet `#6D28D9`, pink `#9D174D`, gold `#92400E` |
| Glass card | `#3A1650` at 72% with a gold hairline | white at 78% with a purple hairline |

Jewels (decoration only, never words on the light page): gold `#FBBF24`, pale gold `#FDE68A`, amber `#F59E0B`, rose `#FB7185`,
orchid `#F472B6`, amethyst `#C084FC`, magenta `#D946EF`.

The action gradient under white text (primary buttons, the sent message) is royal purple `#7E22CE` → rose `#BE185D` → amber
`#B45309`: white is 6.98, 6.04 and 5.02 to 1 on its stops. `zarvisAuroraBrush()` is the jewel gradient (gold → orchid → amethyst
→ rose) for rings, edges and progress.

`PaletteContrastTest` checks every text colour on every surface in both themes, including the page's glows, rays and bokeh stacked
at their strongest (the worst spot is 5.1:1 in light and 5.3:1 in dark), ink on every gold, and white on the action gradient. CI runs it.

## The page (`ZarvisBackground`)

* Three still glows over the page colour: magenta at the top, amethyst on the right, gold at the bottom. They are painted once per
  size or theme change.
* On its own layer behind the content: 20 gold rays turning once a minute from the top centre, 18 pieces of glitter (diamonds and
  dots) falling and swaying, 5 large bokeh lights rising, and 7 four-point stars twinkling. One 60-second clock drives all of them,
  and every motion repeats a whole number of times per cycle, so the loop has no seam.
* Speed: the clock is read while drawing, so a frame repaints only that layer; nothing recomposes or re-lays out and the screen's
  own text and cards are not redrawn. The glitter, stars and bokeh are fixed lists (fixed seeds), so every screen shows the same
  sky and switching tabs does not reshuffle it.
* With Android's "Remove animations" on (or an animator scale of 0) the sky is one still frame. Android sends no frames while the
  app is in the background, so it costs nothing there.

Every screen draws the sky: Home, Chat, Capabilities, Work, Tasks, System Metrics, Plans & Quotas, Memory, Settings, Permissions, and
(since Phase 2) launch, welcome, start error, session ended, a capability's detail page and Developer Agent.

## Type and shared pieces

* **Type** (`Type.kt`): Sora for everything people read, Orbitron for the ZARVIS wordmark and the small gold section labels
  (`ZarvisDisplayStyles`). Both are the upstream variable fonts, unmodified (OFL 1.1, see THIRD_PARTY_NOTICES.md). Neither has
  Devanagari, so Hindi uses the phone's own Devanagari font, and a Hindi section label keeps Sora with no letter spacing.
* **`QueenComponents.kt`**: `QueenCrown` (bobs gently), `GoldText` (gold in Queen Dark, royal ink in Queen Light, with a shine that
  passes every few seconds), `SectionKicker`, `JewelIcon` / `Jewel`, `SkeletonBlock` / `SkeletonList`, `QueenEmptyState`,
  `QueenErrorCard`, `GoldDivider`.
* **Badges**: `StatusBadge` and `RiskBadge` are filled jewel pills with their own dark ink (sapphire running, gold waiting, emerald
  done, ruby a problem), so they read the same on both pages.
* **Lightweight mode** (Settings › Appearance): the sky, the crown, the shine, the skeleton sweep and the orb hold still, exactly as with
  Android's "Remove animations" (`zarvisReduceMotion()` answers true for either).

## The orb (`AiOrb`)

The state colours are the Queen jewels: idle gold → amethyst, listening orchid → gold, understanding and planning amethyst → orchid,
working gold, speaking amethyst → gold, done green, error rose. Over the turning sweep: a white-hot plasma core, a gold rim and a
ring of 48 gold ticks that turns the other way. It still moves only while listening, working or speaking, and its TalkBack words
are unchanged.

## Navigation

Tab bar: **Home · Capabilities · Chat · Tasks · Work**. Chat is the gold orb in the middle (`ZarvisNavItem(prominent = true)`),
with its label under it like every other tab, so it is still found by its text and still announces itself as a tab. The bar is a
plum (light: white) pill with a jewel edge; the current tab sits on a gold-tinted pill with a bolder label, and the orb wears a ring
while Chat is open. Screens opened from Work keep Work highlighted, and the bar hides while the keyboard is up (as before).

Talk: the crowned orb on Home and the composer's mic open Chat already listening (`conversation?listen=true`). The middle tab stays
**Chat**: opening Chat from the tab does not start the microphone.

## Screens (the 22 boards)

| Board | Screen (code) | Phase 2 |
| --- | --- | --- |
| A01 Launch | window background (`colors.xml`) and the startup screen in `MainActivity` | Done: crown, gold wordmark, gold progress line |
| A02 Welcome ×6 | `OnboardingScreen` | Done: the sky and the crown on each page |
| A03 Home | `HomeScreen` | Done: gold wordmark, crowned orb that starts listening, gold chips, jewel cards, recent-task rows with a skeleton |
| A04 Chat | `ConversationScreen` | Done: gradient sent bubble, glass replies with a jewel status badge, gold composer edge. Streaming: not yet |
| A05 Assist overlay | `AssistActivity` (follows the chosen appearance) | Not yet: Queen bottom sheet |
| A06 Start error, session ended | `MainActivity` | Done: the Queen page and the crown |
| A07 Capabilities | `CapabilitiesScreen` | Done: skeleton and error card. Not yet: jewel tiles per group |
| A08 Capability detail | `FeatureDetailScreen` | Done: the sky and a gold category label |
| A09 Tasks / Activity | `TasksScreen` | Done: jewel rows, jewel badges, skeleton, crown empty state, error card |
| A10 Work | `MoreScreen` | Not yet: jewel cards per destination |
| A11 Memory | `MemoryScreen` | Done: skeleton and error card |
| A12 System Metrics | `MetricsScreen` | Done: skeleton and error card. Not yet: gold meters |
| A13 Plans & Quotas | `SubscriptionScreen` | Done: skeleton. Not yet: crown on the current plan |
| A14 Developer Agent | `DeveloperScreen` | Done: the sky |
| A15 Settings | `SettingsScreen` | Done: a jewel per page |
| A16 Account | `SettingsScreen` (Account) | — |
| A17 Permissions & Device Access | `PermissionCenter` | Theme colours only |
| A18 Notifications | `NotificationSettings` | — |
| A19 Voice, Language, Appearance | `SettingsScreen` | Done: Lightweight mode switch. Not yet: preview cards |
| A20 AI, Privacy, Security, Data, Rules | `SettingsScreen` | — |
| A21 Dialogs | permission explanation, action confirmation | Done: jewel icon, gold edge, gold labels, gradient button (still dialogs, see above) |
| A22 States | loading, empty, error, chat interrupted | Done: gold skeleton, crown empty state, ruby error card, gold interrupted card. Offline banner: not yet |

## Fast and real-time rules

* First frame within 100 ms: show what is cached at once, refresh quietly after.
* While loading, a gold skeleton in the shape of the content, never an empty spinner.
* Chat replies stream word by word; the first word in about a second.
* A tap answers at once (press effect, haptic). Delete, pause and the like show their result immediately and roll back with a
  plain message if the server says no.
* Animation is transform, opacity or draw-phase only, at 60 fps; it stops with "Remove animations" (and in Lightweight mode, Phase 2).
* Prefetch the next screen's data where the path is obvious (Home → Tasks, Chat).
* Every list has its four states: loading, empty, error (with Try again) and offline.
