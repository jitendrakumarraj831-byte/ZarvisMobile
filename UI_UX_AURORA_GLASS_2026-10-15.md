# Aurora Glass pass (Web and Android): what was found, what changed, what was verified

> 2026-10-15 · branch `claude/friendly-wright-ltwjy9` · PR #95 (draft). Backend, APIs, auth, AI logic, voice/TTS and uploads are untouched (`git diff origin/main --stat` lists no backend file).

## Found (measured, not guessed)

| Where | Finding | Evidence |
| --- | --- | --- |
| Android | **Dark mode unreadable.** Every glass surface was white at 68% in both themes, so dark mode drew near-white text on a light-grey panel. | glass over the dark page is `#b0b1b7`; text `#f7f9ff` is **2.0:1**, secondary text about 1:1 |
| Android | Bright cyan/pink/amber/green used as *text* on the light page (Plans, Settings card titles, risk badges, chat status pill, latency). | 1.5–2.6:1 |
| Android | Status/navigation bar icons followed the phone's theme, not the app's; window colour before first frame was dark. | code |
| Android | The Home orb ran three infinite animations while idle and recomposed its screen every frame; ignored "Remove animations" for the pulse badge. | code |
| Android | Orb and composer accessibility labels were English-only; switches/choices were thumb-sized targets, not rows. | code |
| Web | Short phones (360×640): the empty Chat showed **one** starter card; Home quick actions showed 1.5 chips. | screenshots before/after |
| Web | Tab bar was restated in five CSS layers; text ghosted through it. | `styles.css` |
| Web | `.seg` / `.crumb` were 40–41 px wide under 1100 px (short Hindi labels). | sweep: 3 → 0 sub-44px targets (hidden file inputs and `.cap-action`, whose hit area is a `::before`, excluded) |
| Web | The Home page keeps ~10 decorative loops and four backdrop blurs running on a low-end phone. | idle cost below |

## Changed

Web: Lightweight mode (Settings → Appearance → Performance; Automatic reacts to Save-Data, 2G/3G, ≤ 2 GB memory, reduced data); the Hindi dictionary (`i18n.js`, 161 KB raw / 38 KB gzip) is fetched only when Hindi is used; one tab-bar block with a pill indicator and an opaque glass (plus a forced-colours edge); two-row Home quick actions; compact empty chat on short phones; 44 px minimum widths; lossless icon recompression (128 KB → 115 KB). See `DESIGN_SYSTEM.md` ("Lightweight mode").

Android: theme-aware glass and text accents (`ZarvisExtras`, `GlassColors`, `ZarvisAccents`, `readableAccent`), palette and aurora washes mirroring the web tokens (table in `DESIGN_SYSTEM.md`), new tab bar, orb/pulse that hold still when idle or with animations off, keyboard-aware Chat, Tasks on the aurora page, one-row switch/choice controls, headings, Hindi for Appearance, Voice, sign-out, delete-account and orb/composer labels (the Language page lists exactly which pages are translated).

## Verified

| Check | Result |
| --- | --- |
| Web unit tests (`node --test web/tests/*.test.js`) | 76/76 (68 before; +8 `themeInit`) |
| Browser E2E on a real backend + Postgres: Phase 1 / quality / workspace / camera | 38/38, **50/50** (48 before; +2 new), 46/46, 7/7 |
| Screenshot sweep, 4 sizes × light/dark × EN/HI × 7 views (112 pages) | 0 horizontal overflow, 0 console/page errors |
| Android `:domain:build` locally (JDK 17) | 282 tests pass (279 before; +3) |
| Android on GitHub Actions (commit `8312971`) | **all 22 checks green**: `test-and-lint` (incl. zero-new-lint-warning gate), `assemble-debug` (debug APK, release APK + AAB), emulator API 26/30/34 UI tests, windows-build, backend, web-e2e, CodeQL |

Idle cost of Home, 6 s, headless Chromium at 4× CPU slowdown (two runs each): main-thread task time **1.38 / 1.54 s (full) → 0.37 / 0.38 s (Lightweight)**, style recalculation **0.47 / 0.54 s → 0.10 s**.

## Not verified / limits

* **No Android screenshots.** The authoring sandbox blocks Google's Maven and SDK host (`dl.google.com`), so Compose could not be compiled or rendered locally; the Android build and emulator tests above ran on GitHub's runners. Nobody has looked at the new Android screens on a phone; the contrast numbers are computed from the palette.
* The idle-cost numbers come from software-rendered headless Chromium, not a real low-end phone, and nothing was measured on a real 4G link.
* Not changed on purpose: `vercel.json` / service-worker `no-store` caching (it forces a full re-download on every visit, but it was set deliberately after a stale-code incident and could not be tested without Vercel). `no-cache` with ETags is the recommended next step.
* Settings pages AI, Notifications, Privacy, Data, Rules & Protection, Permissions, Plans and Developer on Android are still English-only.
* Dead-control scan (`web/e2e/link-scan.cjs`): see the PR for its result if it finished.
