# ZARVIS Android: the Queen theme

The Android app's look: since phase 5, **Queen Night**, a navy-black night lit violet and blue, with glass cards, a glowing lit-glass
orb and the ZARVIS gold kept for the brand (the wordmark, the plan and its credits). It began as a deep plum night with gold, rose and
amethyst light, turning gold rays, falling glitter and a crowned orb (phases 1–4). **Queen Night** is the default appearance and
**Queen Light** (lavender) is the same theme for daylight, chosen in Settings › Appearance. The website keeps Aurora Glass
([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)) until it moves to Queen in its own change.

The full design (all 22 Android boards, the navigation, the speed rules and the scan checklist) is on the design canvas
<https://claude.ai/artifact/SG5heBSrDENnAK1Ja9vWGx>, page **Android · Queen (sab pages)**. Its quieter successor, **Queen Pro**
(22 boards, page **Queen Pro · saaf, professional (sab features)**), is what the app draws since phase 4: see *Queen Pro* below.

Product rules do not change with the look: no fake capability or state, status words say what is really happening, every visible
string has Hindi, and text is at least 4.5:1 on whatever it is drawn on.

## Phases

| Phase | What | Status |
| --- | --- | --- |
| 1 | The palette, Material colour roles, the animated page, the orb, the tab bar with Chat as the gold orb in the middle, Queen Dark as the default, the Settings wording | Done |
| 2 | Sora/Orbitron type; the crown, gold lettering, gold section labels, jewel icons and badges; Home (A03); launch, welcome, start error, capability detail and Developer Agent on the Queen page; the Chat look (A04) and interrupted card; the gold skeleton, crown empty state and ruby error card (A22); Queen dialogs (A21); jewel Settings rows (A15); Lightweight mode | Done |
| 3 | Live chat progress from the turn stream; the Queen page header (`QueenPageHeader`) on every inner page; jewel cards on Work, Capabilities and Tasks; Metrics tiles and meters; Plans with the crowned plan card, localized; the chat's welcome with three starters; five equal tabs | Done |
| 4 | Queen Pro: one quiet page behind every inner screen, solid cards, one page structure (bar, intro, gold sections, rows), tinted status chips, pill buttons, a flat tab bar with five equal tabs, and the new controls listed under *Queen Pro* | Done |
| 5 | Queen Night: the navy page with violet and blue light, periwinkle primary, violet → indigo → blue action gradient, glass sheen on cards, the lit-glass orb, the calmer night sky, Home's new hierarchy (orb hero, Ask ZARVIS, quick actions) and the Chat refinements listed under *Queen Night* | Done |
| Later | The items under *Not done yet* below | Open |

Phase 1 changed no behaviour. Phase 2 changes one: the Home orb ("Tap to speak") and the composer's mic open Chat already listening,
through ZARVIS's explanation and Android's permission like every other microphone start. Everything else keeps its content, order and
actions.

### Not done yet, and why

* **Replies streaming word by word.** Since phase 3 the app reads `/orchestrator/turn-stream` and shows each stage the turn really
  reaches (sending, a slow-server note after 6 s, thinking, the tool being run, the action running on the phone). The words themselves
  still arrive at once with `done`: the providers stream text but not tool calls, so a word-by-word reply would need the backend to
  stream a turn that may still call a tool.
* **Chat tab renamed Talk.** The Home orb now does what Talk would do. Renaming the tab changes what the emulator tests tap
  (`ChatSyncTest`, `ShellScreenshotTest` find it by the word "Chat") and would start the microphone on every tab tap.
* **Dialogs as bottom sheets.** They keep Material's dialog, restyled, because the emulator tests drive them through UI Automator by
  their exact words and a sheet changes when they appear and how Back closes them.
* **Offline banner.** The app has no connectivity state to show truthfully yet; failed loads already say so with Try again.
* **Appearance preview cards, entrance animations, chips marquee.** Smaller polish; the switches and chips work as they are.

## Palette (`core-ui/.../theme/Color.kt`)

| Role | Queen Night (phase 5) | Queen Light |
| --- | --- | --- |
| Page (`background`) | `#070A18` navy-black night | `#FBF4FF` lavender |
| Surface / variant / highest | `#0F1329` / `#161B38` / `#1F2548` | `#FFFFFF` / `#F8F0FF` / `#F4E9FD` |
| Text / secondary text | `#F4F6FF` / `#C5CBEA` | `#1A0B3B` / `#4C3D75` |
| Primary (selected tab, focus, links, section labels, small actions) | periwinkle `#A5B4FC`, navy ink `#0A0F2E` on it | royal purple `#7E22CE`, white on it |
| Error / warning / success | `#FDA4AF` / `#FCD34D` / `#86EFAC` | `#B42318` / `#92400E` / `#065F46` |
| Text accents (`ZarvisAccents`) | cyan `#67E8F9`, violet `#DDD6FE`, pink `#F9A8D4`, gold `#FDE68A`, primary `#A5B4FC` | cyan `#155E75`, violet `#6D28D9`, pink `#9D174D`, gold `#92400E`, primary `#7E22CE` |
| Glass card | `#0F1329` with a periwinkle hairline (16%) and a white sheen (5%) over its top half | white with a purple hairline |

**Two jobs, two colours.** The primary marks what you can act on and where you are; gold marks ZARVIS itself: the wordmark, the
"ZARVIS" label over a reply, the plan and its credits. Nothing else is gold.

Night lights (decoration only, never words on the light page): violet `#8B5CF6`, blue `#3B82F6`, indigo `#6366F1`, sky `#60A5FA`,
lavender `#C4B5FD`, ice `#E0E7FF`. The Queen jewels (gold `#FBBF24`, pale gold `#FDE68A`, amber, rose, orchid, amethyst, magenta)
remain for the gold lettering and the crown.

The action gradient under white text (primary buttons, the sent message, the quick actions' icons) is violet `#7C3AED` → indigo
`#4F46E5` → blue `#2563EB`: white is 5.70, 6.29 and 5.17 to 1 on its stops. `zarvisAuroraBrush()` is the night's lights (lavender →
violet → blue → sky) for rings, edges and progress meters.

`PaletteContrastTest` checks every text colour on every surface in both themes, including the page's glows and nebula lights stacked
at their strongest (the worst spot is 6.6:1 for the night primary and 5.0:1 in light) and a card's sheen, navy ink on the night
primary, ink on every gold, and white on the action gradient. CI runs it.

## The page (`ZarvisBackground`)

* Three still glows over the page colour: violet at the top, blue on the right, indigo at the bottom left. They are painted once per
  size or theme change.
* On its own layer behind the content (since phase 5, a calmer night): 4 large nebula lights drifting slowly upwards, 22 specks of
  starlight shimmering in place, and 6 four-point stars twinkling. The gold rays and the falling glitter are gone. One 60-second
  clock drives all of them, and every motion repeats a whole number of times per cycle, so the loop has no seam.
* Speed: the clock is read while drawing, so a frame repaints only that layer; nothing recomposes or re-lays out and the screen's
  own text and cards are not redrawn. The glitter, stars and bokeh are fixed lists (fixed seeds), so every screen shows the same
  sky and switching tabs does not reshuffle it.
* With Android's "Remove animations" on (or an animator scale of 0) the sky is one still frame. Android sends no frames while the
  app is in the background, so it costs nothing there.

Since phase 4 (Queen Pro) only Home draws the sky (`ZarvisBackground(decorated = true)`). Every other page has the page colour with
one still violet glow at the top, so its text and controls are what you see.

## Type and shared pieces

* **Type** (`Type.kt`): Sora for everything people read, Orbitron for the name ZARVIS only (`ZarvisDisplayStyles`); since phase 4 the
  gold section labels are Sora 12/16 (`ZarvisProStyles.sectionLabel`). Both are the upstream variable fonts, unmodified (OFL 1.1, see THIRD_PARTY_NOTICES.md). Neither has
  Devanagari, so Hindi uses the phone's own Devanagari font, and a Hindi section label keeps Sora with no letter spacing.
* **`QueenComponents.kt`**: `QueenCrown` (bobs gently), `GoldText` (gold in Queen Dark, royal ink in Queen Light, with a shine that
  passes every few seconds), `SectionKicker`, `JewelIcon` / `Jewel`, `SkeletonBlock` / `SkeletonList`, `QueenEmptyState`,
  `QueenErrorCard`, `GoldDivider`, and since phase 3 `QueenPageHeader` (Back pill, a glass hero card washed with the page's jewel,
  its jewel icon, a gold kicker, the title in gold lettering as the page heading, one line on what the page is for, and chips that
  wrap), `QueenBackButton`, `QueenStatTile` and `GoldMeter` (decoration: the number is always written next to it).
* **Badges**: since phase 4 `StatusBadge` and `RiskBadge` are tinted pills (`TintPill`): the theme's text-safe accent on a 14% wash of
  itself (cyan running, gold waiting, green done, rose a problem); "Very high risk" is the one filled pill. PaletteContrastTest checks
  every chip on its own tint, on the page and on a card, in both themes.
* **Lightweight mode** (Settings › Appearance): the sky, the crown, the shine, the skeleton sweep and the orb hold still, exactly as with
  Android's "Remove animations" (`zarvisReduceMotion()` answers true for either).

## The orb (`AiOrb`)

Since phase 5 a lit glass sphere: a halo in the state's colour, the sphere lit from the top left into deep navy, a luminous arc of
energy turning inside it, a white-hot core, a glass rim with a glint, a fine HUD ring of 48 lavender ticks turning the other way, and
an orbit with one bright satellite. State colours: idle violet → blue, listening cyan → blue (with two ripples leaving the sphere),
understanding and planning violet → indigo, working sky → indigo, speaking lavender → violet, done green, error rose. Each state
also has its own motion (pulse, glow and turn speeds). It moves while listening, working or speaking; while idle it holds still,
except Home's hero orb (`idleMotion = true`), which breathes slowly (a 3.2 s glow, a 24 s turn). Everything stops with "Remove
animations" or Lightweight mode. A press squeezes it slightly (layer scale only). Its TalkBack words are unchanged; without
`onClick` it is decoration (the empty chat, empty lists, the welcome pages, the launch screen) and says nothing.

## Navigation

Tab bar: **Home · Skills · Chat · Tasks · Work** (Hindi: होम · क्षमताएँ · चैट · कार्य · काम). The English tab says Skills because
"Capabilities" did not fit five tabs on a 360dp phone: it pushed Work's label out to "…". The page keeps the title Capabilities, and
every tab now gets an equal share of the bar. Since phase 4 the bar is flat across the bottom with a hairline on top, and the five
tabs are equal (Chat is no longer an orb). Since phase 5 the hairline glows violet and blue in its middle, and the current tab's
icon sits on a violet → blue pill while its label turns the primary and bolder. Screens opened from Work keep Work highlighted, and the bar hides while the keyboard is up (as before).

Talk: the crowned orb on Home and the composer's mic open Chat already listening (`conversation?listen=true`). The middle tab stays
**Chat**: opening Chat from the tab does not start the microphone.

## Screens (the 22 boards)

| Board | Screen (code) | Phase 2 |
| --- | --- | --- |
| A01 Launch | window background (`colors.xml`) and the startup screen in `MainActivity` | Done: crown, gold wordmark, gold progress line |
| A02 Welcome ×6 | `OnboardingScreen` | Done: the sky and the crown on each page |
| A03 Home | `HomeScreen` | Done: gold wordmark, crowned orb that starts listening, gold chips, jewel cards, recent-task rows with a skeleton |
| A04 Chat | `ConversationScreen` | Done: gradient sent bubble, glass replies with a jewel status badge, gold composer edge; phase 3: gold title and New chat chip, a crowned welcome with three starter requests, the pending reply's live stage with gold dots, "Stopped" on a replaced request |
| A05 Assist overlay | `AssistActivity` (follows the chosen appearance) | Not yet: Queen bottom sheet |
| A06 Start error, session ended | `MainActivity` | Done: the Queen page and the crown |
| A07 Capabilities | `CapabilitiesScreen` | Done: skeleton and error card; phase 3: Queen header that scrolls with the list, jewel cards per product page and per skill |
| A08 Capability detail | `FeatureDetailScreen` | Done: the sky and a gold category label |
| A09 Tasks / Activity | `TasksScreen` | Done: jewel rows, jewel badges, skeleton, crown empty state, error card; phase 3: Queen header with chips, a status stripe per card, buttons off while a Pause or Cancel is on its way |
| A10 Work | `MoreScreen` | Done (phase 3): Queen header, jewel card per destination with its live number, gold section labels |
| A11 Memory | `MemoryScreen` | Done: skeleton and error card; phase 3: Queen header, gold section labels |
| A12 System Metrics | `MetricsScreen` | Done: skeleton and error card; phase 3: jewel stat tiles ("850 ms" / "1.2 s"), a success meter, a bar per turn against the slowest, status chips that wrap |
| A13 Plans & Quotas | `SubscriptionScreen` | Done: skeleton; phase 3: crowned current-plan card with the credits large and the trial end as a date, Free and Pro jewel cards, every word in Hindi too, Try again when it cannot load |
| A14 Developer Agent | `DeveloperScreen` | Done: the sky |
| A15 Settings | `SettingsScreen` | Done: a jewel per page; phase 3: Queen header on the list and on every page, language and look as chips that open their pages, the open page survives rotation |
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

## Queen Pro (phase 4)

The same Queen colours with less noise, so every page reads as one product. Approved on the design canvas (page **Queen Pro**).

* **One page structure.** Back (a 48dp round button) next to the title (22/28; a tab's own page has no Back and 28/34), one line on
  what the page is for, chips that wrap, then sections: a gold label (`QueenSection`) over a card of rows (`QueenListCard`,
  `QueenRow`, `QueenRowDivider`). A row is an icon tile, a title, one line of detail and a control on the right (switch, chip, or a
  chevron when the whole row opens something), at least 64dp tall.
* **Surfaces.** Cards are solid (`#200A30` with a gold hairline in Queen Dark, white with a purple hairline in Queen Light), 16dp
  corners. Buttons are pills: the action gradient for the one main action, an outline for the second, and an outline in the danger
  colour for anything that deletes; the dialog that asks first (`QueenConfirmDialog`) has the filled danger pill.
* **Notes and small print.** `QueenNote` (a soft tinted box with an icon) for what a setting means or a safety promise;
  `QueenFootnote` for small print; `QueenOutlineAction` for a small gold action such as Try again or Stop.
* **New controls** (each built on what the app already does):
  * Chat: the orb sits next to the field as the microphone; while listening, a card says "Speak now" with **Cancel, send nothing**;
    while a reply is read aloud, **Stop** ends it and keeps the text (`ConversationViewModel.stopSpeaking`).
  * Assistant panel: **Read my screen**, **Go back** and **Go home** send those requests; reading and tapping still ask first.
  * Skills: a search and four filters (All, On this phone, In Chat, Website only). Where a capability is used comes from
    `shared/feature-catalog.json` (`SkillsCatalog`), never from the screen.
  * Tasks: grouped into Needs you, In progress and Finished (`StatusLabels.taskGroup`); the tab's page is titled Tasks; an empty list
    offers Open Chat.
  * Home: Phone Agent and Phone action safety (with its live On / Paused) under "On this phone"; the safety row and the Phone Agent
    page open Phone action safety directly.
  * Work: "In the app" replaces "Available now", so a screen that exists is not read as tested on a phone.
  * Memory: a character count under the field. Usage & metrics is the page's title. Developer Agent says Yes / No and follows the
    app's language.
  * Settings: the account on top and three groups (You · Safety & privacy · Advanced). Permissions & Device Access is grouped by what
    Android reports (`AccessGroup`: Allowed, Not on yet, No permission held, Not available here).

## Queen Night (phase 5)

The reference for this phase was a futuristic assistant on a black/navy page with purple-blue light, a glowing orb and glass cards.
It refines Queen Pro rather than replacing it: the same components, page structure, tabs and features, retuned.

* **Home: the first screen in the order it is used.** The gold wordmark with "AI ASSISTANT" under it and Settings (a glass round
  button); "What should we do?" and one line on what ZARVIS does; the orb as the hero (176dp, breathing slowly), "Tap to speak"; the
  Ask ZARVIS field (its mic opens Chat listening, like the orb); then **Quick actions**, four to a row when every label fits its tile
  (the widest, "Automation", is 68dp in Sora at 11sp, scaled by the phone's font size), otherwise two side by side, so no label is
  ever cut inside a word: the seven categories, each sending its request to Chat as its chip did (TalkBack reads the exact request
  as the tile's action), and **All skills**, which opens the Skills tab. The orb is 152dp so that on a 360 × 720dp phone the first
  row of quick actions ends above the tab bar (checked on the emulator's screenshots). Below
  the first screen: the error card when loading failed (next to what failed, no longer at the bottom), Recent tasks with See all, On
  this phone (Phone Agent, Phone action safety with its live On / Paused), and the plan.
* **Removed from Home, still in the app.** The three "Try" requests (Open the camera, the water reminder, the birthday wish) were a
  second, smaller copy of the categories; they stay where they help most, on the empty Chat. "What can you do?" is now Quick actions.
* **Ask ZARVIS.** The field says "Ask ZARVIS anything…" on Home and in Chat (`CHAT_COMPOSER_HINT`); the hint is one line at 14sp,
  so the empty field stays one line tall next to Chat's orb.
* **Chat.** New chat and Delete on the top row; under them, on its own line (hidden while typing), ZARVIS's avatar (a small lit
  sphere) with the title and the language line, so the title never shares 95dp with the buttons; the avatar is over each reply
  too; Delete is a 48dp trash button named "Delete",
  still asking first; Read aloud / Stop and Try again are outlined pills with icons; listening is a cyan-edged card with a mic, a reply
  being read aloud a card with a sound wave and Stop; the orb by the field is 64dp; the empty chat shows the still orb instead of
  the crown; the pending reply's dots and edge are in the primary.
* **Work.** Each row's "In the app" / "Website only" badge sits under its description, with the live number beside it, instead of
  on the right, where it left the description about 100dp and six lines.
* **Everywhere.** Section labels, small actions, chips, dialogs' edges, the selected Skills filter and the launch progress line use
  the primary; empty lists, the launch screen, the start error (in its error colours) and the welcome pages show the orb.
* **Tests that hold the shape.** `ConversationLifecycleTest` scrolls Home's lazy list to the "Creative" tile; `SettingsUiTest` opens
  Settings by its content description; `ChatSyncTest` taps the tabs by their words, so nothing on Home is a clickable "Chat" or
  "Home". `PaletteContrastTest` holds the new values.
