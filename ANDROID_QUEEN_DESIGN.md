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
| 1 | The palette, Material colour roles, the animated page, the orb, the tab bar with Chat as the gold orb in the middle, Queen Dark as the default, the Settings wording | This change |
| 2 | Per-screen layouts from the boards: Home's crown hero and chips row, Chat's word-by-word streaming and interrupted card, the gold skeleton/empty/error/offline states, dialogs as sheets, the Talk tab, a Lightweight mode, the Orbitron/Sora fonts | Next |

Phase 1 changes no behaviour: every screen keeps its content, order and actions, and only its colours, its page and the tab bar change.

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

Every screen that already used `ZarvisBackground` gets the sky: Home, Chat, Capabilities, Work, Tasks, System Metrics, Plans & Quotas,
Memory, Settings and Permissions. The others (welcome, start error and session ended, a capability's detail page, Developer Agent)
are on the plain Queen page colour until Phase 2.

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

Phase 2: the orb becomes **Talk**, opening Chat and starting to listen at once (the `conversation?listen=true` route already exists).
That changes the tab's label, so the emulator's `ShellScreenshotTest` and `UiStringTest` change with it.

## Screens (the 22 boards)

| Board | Screen (code) | Phase 2 layout |
| --- | --- | --- |
| A01 Launch | window background (`colors.xml`, now the Queen page) and the startup screen in `MainActivity` | crown and name rise in, gold progress line |
| A02 Welcome ×6 | `OnboardingScreen` | the sky behind each page, jewel icon per page |
| A03 Home | `HomeScreen` | crown hero over the orb, greeting with a gold shimmer, jewel category tiles, chips row |
| A04 Chat | `ConversationScreen` | gradient sent bubble, glass replies streaming word by word, gold composer edge |
| A05 Assist overlay | `AssistActivity` (now follows the chosen appearance) | Queen bottom sheet |
| A06 Start error, session ended | `MainActivity` | jewel icon, primary and outline buttons |
| A07 Capabilities | `CapabilitiesScreen` | jewel tiles per group, truthful status chips |
| A08 Capability detail | `FeatureDetailScreen` | the sky, status and permission card |
| A09 Tasks / Activity | `TasksScreen` | gold progress, status badges, swipe actions |
| A10 Work | `MoreScreen` | jewel cards per destination |
| A11 Memory | `MemoryScreen` | glass list, forget dialog |
| A12 System Metrics | `MetricsScreen` | gold meters |
| A13 Plans & Quotas | `SubscriptionScreen` | crown on the current plan |
| A14 Developer Agent | `DeveloperScreen` | the sky, repository card |
| A15 Settings | `SettingsScreen` | jewel icons per row |
| A16 Account | `SettingsScreen` (Account) | — |
| A17 Permissions & Device Access | `PermissionCenter` | status per permission, explain-first |
| A18 Notifications | `NotificationSettings` | — |
| A19 Voice, Language, Appearance | `SettingsScreen` | Appearance: Queen Dark / Queen Light preview cards |
| A20 AI, Privacy, Security, Data, Rules | `SettingsScreen` | — |
| A21 Dialogs | permission explanation, action confirmation, delete chat (and forget memory, sign out, delete account) | bottom sheets with a gold top edge |
| A22 States | loading, empty, offline/error, chat interrupted | gold skeleton, crown empty state, offline banner |

## Fast and real-time rules

* First frame within 100 ms: show what is cached at once, refresh quietly after.
* While loading, a gold skeleton in the shape of the content, never an empty spinner.
* Chat replies stream word by word; the first word in about a second.
* A tap answers at once (press effect, haptic). Delete, pause and the like show their result immediately and roll back with a
  plain message if the server says no.
* Animation is transform, opacity or draw-phase only, at 60 fps; it stops with "Remove animations" (and in Lightweight mode, Phase 2).
* Prefetch the next screen's data where the path is obvious (Home → Tasks, Chat).
* Every list has its four states: loading, empty, error (with Try again) and offline.
