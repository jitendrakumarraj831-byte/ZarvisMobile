# ZARVIS web design system

One stylesheet (`web/styles.css`), one icon sprite (`web/index.html`), no framework and no web fonts. This file says
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
| Brand | `--cyan --blue --violet --pink --primary --primary-2 --primary-ink --primary-soft --grad --glow --aurora-1..3` |
| Status (each with `-soft`) | `--ok --warn --err --info`: text on its own soft background is at least 4.5:1 |
| Depth | `--shadow-1..3 --focus --card-bg --card-border --card-shadow` |
| Shape and space | `--r-sm --r-md --r-lg --r-xl --r-pill`, `--s1..--s9` (4, 8, 12, 16, 20, 24, 32, 40, 56 px) |
| Type | `--font-body --font-display --font-mono`, `--fs-xs --fs-sm --fs-md --fs-lg --fs-xl --fs-2xl --fs-3xl` (12, 13, 15, 17, 20, 26, 32 px), `--chat-fs` (user text-size setting) |
| Layout | `--sidebar-w --topbar-h --appbar-h --nav-h --content-w --chat-w --safe-b --gutter` |
| Motion | `--ease --t-fast --t-med --t-slow` (140, 240, 420 ms) |
| Code | `--code-bg --code-text --tok-com --tok-str --tok-num --tok-kw --tok-lit --tok-tag --tok-attr` (each at least 4.5:1 on `--code-bg`) |

Fonts are system fonts (`system-ui`, Segoe UI, Roboto, Noto Sans, Noto Sans Devanagari), so Hindi and English render natively
with no download. Per-element tone variables (`--tone`, `--tone-a`, `--tone-b`, `--tone-soft`) are set by `.tone-*` classes
(`blue violet cyan pink amber green coral`) and read by icon tiles and chips.

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
| Toast | `#toast` (`role=status`) | for acknowledgements only; anything about money or data loss stays on the page |
| Loading | `.skeleton`, `.ws-skeleton`, `aria-busy` | |
| Empty / error | `.empty-state`, `.ws-error` | always a sentence of what is true and, when there is one, the next step |
| Breadcrumb | `.crumbs` / `.crumb` | one trail per page; on a phone only "‹ parent" (44px) |

## Motion

CSS only. Page and card entrances, hover lift, the orb, the waveform and the streaming caret are the only animation.
Everything is disabled under `prefers-reduced-motion: reduce`, and nothing moves unless something is happening. No blur
heavier than the glass bars, no animation that runs while the page is idle (the aurora is painted once).

## Accessibility conventions

Landmarks and one `h1` per page; skip link; visible focus on every control; accessible names on every icon button;
`aria-live` regions for asynchronous status (`#chat-announcer`, `#toast`, payment result, list counts such as "3 projects
shown"); scrollable regions are focusable and named; touch targets are at least 44px under 1100px. The Playwright quality
suite runs axe (serious/critical) on every page in light, dark and Hindi, on the data-rich pages, and on the phone menu.

## How the system is kept honest

* `node --test web/tests/css.test.js`: theme defined once, no undefined or unused token, no dead class, braces balanced.
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
