# ZARVIS web design system

One stylesheet (`web/styles.css`), one icon sprite (`web/index.html`, Lucide drawings under ISC, see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)), no framework and no web fonts. The look is **Aurora Glass**: bright
aurora washes, cyan → blue → violet → pink gradients and glass surfaces, with a dark (dim) theme of the same tokens. This file says
what the system is and how to extend it without adding a second one. Behaviour and data are in
[WORKSPACE.md](WORKSPACE.md); product rules (no fake state, truthful status words) are in [README.md](README.md).

## Rules

1. **Tokens first.** A colour, space, radius, size or duration comes from a token in the *Tokens* block at the top of
   `styles.css`. Components read tokens; they do not carry their own colour. The exceptions are the always-dark code
   block (`--code-*`, `--tok-*`) and brand gradients.
2. **Two themes, one place.** Light is `:root`, dark is `[data-appearance="dim"]`. System mode picks one of them before the
   first paint (`theme-init.js`). A theme value is defined exactly once per theme; a late `:root` override is a bug.
   `web/tests/css.test.js` fails if a second block defines the theme, if a `var(--x)` has no definition, if a token is
   unused, or if a rule styles a class nothing renders.
3. **No inline styles.** The page's CSP forbids them. State is a class or a `data-*` attribute (`data-state`, `data-tone`,
   `aria-pressed`, `aria-selected`) and CSS reads it.
4. **Text is set as text.** UI is built with `textContent` or the small `h()` helpers, never `innerHTML` with data. The one
   exception is `ZarvisLogic.formatReplyHtml`, which escapes everything before it adds its own fixed set of tags.
5. **Every state is drawn.** Each list or card has a loading (`skeleton`), empty (`empty-state` with a next step), error
   (`empty-state ws-error` with *Try again*) and, where it makes sense, offline state, and says only what is true.
6. **Every visible string has Hindi** (`web/i18n.js`, exact English key, or a pattern for text with numbers). Text the user,
   a website or the model wrote is marked `data-user-text` and is never translated.

## Tokens

| Group | Tokens |
| --- | --- |
| Surfaces and text | `--bg --surface --surface-2 --surface-3 --glass --text --text-2 --text-3 --line --line-2` |
| Brand | `--cyan --blue --violet --pink --primary --primary-ink --primary-soft --grad --grad-aurora --glow --aurora-1..3 --p-tint --p-tint-line` |
| Status (each with `-soft`) | `--ok --warn --err --info`: text on its own soft background is at least 4.5:1 |
| Depth | `--shadow-1..3 --focus --card-bg --card-border --card-shadow` |
| Shape and space | `--r-sm --r-md --r-lg --r-xl --r-pill`, `--s1..--s9` (4, 8, 12, 16, 20, 24, 32, 40, 56 px) |
| Type | `--font-body --font-display --font-mono`, `--fs-xs --fs-sm --fs-md --fs-lg --fs-xl --fs-2xl --fs-3xl` (12, 13, 15, 17, 20, 26, 32 px), `--chat-fs` (user text-size setting) |
| Layout | `--sidebar-w --topbar-h --appbar-h --nav-h --content-w --chat-w --safe-b --gutter` |
| Motion | `--ease --t-fast --t-med --t-slow` (140, 240, 420 ms) |
| Code | `--code-bg --code-text --tok-com --tok-str --tok-num --tok-kw --tok-lit --tok-tag --tok-attr` (each at least 4.5:1 on `--code-bg`) |

Fonts are system fonts (Segoe UI Variable where Windows has it, then `system-ui`, Roboto, Noto Sans, Noto Sans Devanagari, Nirmala UI),
so Hindi and English render natively with no download. Per-element tone variables (`--tone`, `--tone-a`, `--tone-b`, `--tone-soft`) are set by `.tone-*` classes
(`blue violet cyan pink amber green coral`) and read by icon tiles and chips.

### Aurora Glass colour rules

* **Two gradients, two jobs.** `--grad` (blue `#2563eb` → violet `#6d28d9` → pink `#be185d`) is the one under white text and
  icons: primary buttons, the sent-message bubble, the avatar, the tab bar's Chat orb. Every stop is at least 4.5:1 with white.
  `--grad-aurora` (cyan `#06b6d4` → `#3b82f6` → `#8b5cf6` → pink `#ec4899`) is decoration only: progress and trend bars, the
  waveform, rings and hairlines. Nothing is ever written on it.
* **Ink, not fills, for words and icons.** In light mode `--cyan --blue --violet --pink` are the dark "ink" shades (`#0e7490`,
  `#1d4ed8`, `#6d28d9`, `#be185d`); in dim they are the light ones (`#67e8f9`, `#a5c4ff`, `#c9b8ff`, `#f9a8d4`). The bright fills
  appear only inside gradients.
* `web/tests/contrast.test.js` computes the contrast of every text token on every surface (glass and translucent backgrounds
  are blended first), of each status colour on its own soft background, of white on every `--grad` stop and of the icon accents
  (3:1), in both themes. A token change that breaks one fails the suite.

## App shell

The sidebar, the phone top bar, the desktop top bar, the phone tab bar and the phone menu drawer are styled in one section at
the end of `styles.css` (*App shell (Aurora Glass)*), and nowhere else. Phone (under 700px): top bar and a glass tab bar
whose centre Chat button is a `--grad` orb in an aurora ring; the sidebar is a drawer. Tablet (700–1099px): an icon rail.
Desktop: the full sidebar, which *Collapse* turns into the same rail (`body.sidebar-rail`). The current page is a tinted glass
pill with an aurora bar on its leading edge, never colour alone (the label is bolder and `aria-current` is set).

## Components

| Component | Classes | States and notes |
| --- | --- | --- |
| Button | `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-danger`, size `.btn-sm` | hover, `:focus-visible` ring (`--focus`), `:disabled`, busy label ("Running…"); 44px minimum under 1100px or on a coarse pointer |
| Icon button | `.icon-btn` (+ `.icon-btn-sm`) | always has `aria-label` and `title` |
| Link | `.link-btn`, `.inline-link` | a button that goes to another page; `data-go="work:tasks"` is handled once, globally |
| Fields | `.input`, `.select`, `.search-field` | label or `aria-label` always; validation text in `.alert.alert-error[role=alert]` |
| Switch | `.switch[aria-pressed]` | the hit area is 44px even though the track is smaller |
| Segmented control | `.segmented` + `.seg[aria-pressed]` | filters, view toggles (Tasks list/board), billing period |
| Tabs | `.ws-tabs` / `.ws-subtabs` + `[role=tab]` | arrow keys, Home/End; `.scroll-fade[data-fade]` fades the edge that has more |
| Chip | `.chip` (+ `.tone-*`) | quick prompts |
| Badge | `.z-badge` + `-ok -warn -err -info -off` | status words are the server's (WORKING, PARTIAL, PLANNED, UNSUPPORTED, lifecycle names) |
| Notice | `.notice[data-tone=ok|warn|err]`, `.alert` | `role="status"` for results that arrive later (payment) |
| Panel, card | `.panel`, `.ws-card`, `.dash-card`, `.plan-card`, `.stat-tile`, `.cap-item`, `.capability-item` | one surface style (`--card-*`) |
| Rows | `.ws-row` (files, notes), `.dash-row` (Home), `.settings-row`, `.timeline-item` | the whole row is one button when it opens something |
| Task card / board | `.task-card`, `.task-board` > `.task-col` | one card for list and board (`compact` folds the steps) |
| Execution card | `.exec-card` and its stages | a stage is drawn only after its real event |
| Message | `.bubble`, `.reply-*` (headings, lists, tables, quotes, code), `.tok-*` | tables scroll in `.reply-table-wrap` (focusable, named); code colours are fixed classes |
| Dialog, drawer | `#form-modal`, `#confirm-modal`, `#viewer-overlay`, the phone menu | focus moves in and is trapped, Esc closes, focus returns, the page behind is inert |
| Toast | `#toast` (`role=status`) | for acknowledgements only; anything about money or data loss stays on the page; a long message wraps (never an ellipsis) and `placeToast()` keeps it above the Chat message box or the Home message card |
| Offline banner | `#offline-banner` (`role=status`, sticky) | the app bar and the chat header stick below it through `--banner-h` (its height, set by the page, 0 while online) |
| Loading | `.skeleton`, `.ws-skeleton`, `aria-busy` | |
| Empty / error | `.empty-state`, `.ws-error` | always a sentence of what is true and, when there is one, the next step |
| Breadcrumb | `.crumbs` / `.crumb` | one trail per page; on a phone only "‹ parent" (44px) |

## Motion

CSS only. Page and card entrances, hover lift, the orb (breathing, ripples, drifting sparks), the waveform and the streaming caret are the
animation. Everything is disabled under `prefers-reduced-motion: reduce`, nothing moves while the tab is in the background
(`body.page-hidden`), and the aurora is painted once. The Home orb is the one decoration that loops while the page is idle (about ten
layers), which is why **Lightweight mode** exists.

### Lightweight mode (`html[data-perf="lite"]`)

Set before first paint by `theme-init.js` (`window.ZarvisPerf.apply`), from the saved choice in Settings > Appearance > Performance
(`zarvis.perf`: `auto` | `lite` | `full`). **Automatic** turns it on when the browser reports `navigator.connection.saveData`, an
effective connection of `slow-2g`/`2g`/`3g`, `navigator.deviceMemory <= 2`, or `prefers-reduced-data: reduce`, and follows the connection
if it changes while the page is open. It removes backdrop blur everywhere (`!important`, one rule) and the decorative loops (the idle
orbs, the brand orb, the chat avatar, the tab-bar mic glow); the bars become solid (`--glass` and `--nav-bg` resolve to `--surface`), and
the Chat orb still moves while it is listening or speaking, because that motion is a state, not decoration. Nothing is removed from the
page. `web/tests/themeInit.test.js` runs `theme-init.js` in a stub browser; `quality.e2e.cjs` checks the switch, the reload, the
computed blur and orb animation, and the Save-Data path.

The Hindi dictionary (`i18n.js`, about 160 KB) is part of the same idea: it is fetched only when Hindi is in use
(`theme-init.js` starts it early for a saved Hindi choice; choosing Hindi fetches it on the spot) and is not precached.

## Accessibility conventions

Landmarks and one `h1` per page; skip link; visible focus on every control; accessible names on every icon button;
`aria-live` regions for asynchronous status (`#chat-announcer`, `#toast`, payment result, list counts such as "3 projects
shown"); scrollable regions are focusable and named; touch targets are at least 44px under 1100px. The Playwright quality
suite runs axe (serious/critical) on every page in light, dark and Hindi, on the data-rich pages, and on the phone menu.

## Android uses the same tokens

The native app (`android/core/core-ui/.../theme/Color.kt`, `Theme.kt`) mirrors this file's tokens, so the two clients read as one product.
When a token changes here, change it there (and the other way round). The values below are the Aurora Glass ones.

| Web token (light / dim) | Android |
| --- | --- |
| `--bg` `#f6f7ff` / `#070b1f` | `ZarvisSurfaceLight` / `ZarvisSpaceBlack` (colour scheme `background`) |
| `--surface` `#ffffff` / `#0e1433` | `ZarvisSurfaceLightElevated` / `ZarvisSurfaceDark` (`surface`) |
| `--surface-2` / `--surface-3` | `surfaceVariant`, `surfaceContainerHigh`, `surfaceContainerHighest` |
| `--text`, `--text-2` | `onSurface`, `onSurfaceVariant` |
| `--primary` `#3346d6` / `#a9b6ff` | `primary` (the user bubble, focus ring, selected tab, links) |
| `--ok --warn --err` | `ZarvisAccents.success / warning / danger`, `error` |
| `--glass`, `--card-bg`, `--card-border` | `GlassColors.surfaceTint / surfaceTintElevated / border` (`ZarvisExtras`) |
| `--aurora-1..3` | the three washes in `ZarvisBackground` |
| `--r-lg` 20px | `GlassSurface` / `ZarvisCard` corner 20dp |
| 44px touch target | chips 44dp, tabs 56dp, switch and choice rows 56dp, primary buttons 48dp |
| `--grad` | `zarvisActionBrush()`: `ZarvisPrimaryButton` (white text) |
| `--grad-aurora` | `zarvisAuroraBrush()` and the tab bar's aurora edge (decoration only) |
| the icon sprite (`#i-…`) | `ZarvisIcons` (`core-ui/.../icons/ZarvisIcons.kt`), generated from `web/index.html` by `node scripts/generate-android-icons.mjs`; CI runs it with `--check` |

Rules that carry over: text on glass is at least 4.5:1 in both themes (the bright brand cyan, pink, amber and green are for glows and icons,
never for words on the light page; Android reads text accents from `ZarvisAccents` / `readableAccent`); glass is a tint plus a hairline,
never a blur, on Android; looping animation holds still when the system has animations off and while the thing it decorates is idle;
a page title is a heading (`semantics { heading() }`); a switch or a choice is one row-sized control with the right role.

## How the system is kept honest

* `node --test web/tests/css.test.js`: theme defined once, no undefined or unused token, no dead class, braces balanced.
* `node --test web/tests/contrast.test.js`: every text and icon colour pair, in both themes (see *Aurora Glass colour rules*).
* `PaletteContrastTest` (Android `core-ui` unit test): the same rules for the app's palette, light and dark.
* Android emulator phase G (`ShellScreenshotTest`) photographs every tab in light + English and dark + Hindi on the real app and
  backend; the pictures are in the `emulator-evidence-api*` CI artifacts under `screenshots/`.
* A token or CSS refactor is proven, not eyeballed: dump the computed value of every custom property in a real browser
  before and after (light and dark, three widths) and compare; screenshot every page before and after and compare pixels.
  The consolidation in this release was value-identical for all 88 shared properties and pixel-identical on 107 of 108
  screenshots (the last differs by one pixel).
* Run `web/e2e/quality.e2e.cjs` for overflow at 320, 360, 390, 412, 768, 1024, 1280 and 1440 px and for axe.

## Adding to it

A new **token**: add it to the Tokens block for light and, when it differs, dim. A new **component**: reuse a surface
(`--card-*`) and a row or button first; give it every state in the table above; add its Hindi; add it to this table. A new
**page**: a `section.view` with one `h1`, a breadcrumb entry, a route (`logic.js` `GO_VIEWS` / `breadcrumbs`) and a case in
`quality.e2e.cjs`.
