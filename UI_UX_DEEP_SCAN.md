# ZARVIS Web — UI/UX deep scan: pages, content placement, layout, linking

> Scan date: 2026-10-08 · Branch: `claude/determined-ptolemy-2tfwkg` (PR #90) · Client: `web/`
> Reference: [ZARVIS_MASTER_PRODUCT_BLUEPRINT.md](./ZARVIS_MASTER_PRODUCT_BLUEPRINT.md) §3 (web navigation), §6 (page-by-page IA), §7 (agent page standard), §8 (settings IA), and the Android navigation graph (`android/app/.../navigation/NavGraph.kt`).
> Every number below was measured in a real browser against the real backend, not estimated.

## सार (Hindi summary)

- **कितने पेज हैं:** आज 8 मुख्य + 9 capability + 11 settings = **28 पेज** (इस PR से पहले 30 थे; Subscription और Data के दो खाली stub पेज हटाए)।
- **कितने चाहिए:** अभी के असली features के लिए **26 पेज** काफ़ी हैं: 8 मुख्य (Home, Chat, **Tasks**, Capabilities, Activity, **Plans & Usage**, Settings, Developer) + 7 capability + 11 settings। blueprint के बाक़ी पेज (Work, Files, Research, Creative, Business) तब बनें जब उनके पीछे असली backend हो; वरना वे नक़ली पेज होंगे, जो product के नियम के ख़िलाफ़ है।
- **लिंकिंग:** हर पेज के हर बटन/link को असली क्लिक से जाँचा (desktop 344, phone 301)। **सच में dead control: 0।** पर 12 असली खामियाँ मिलीं और इसी PR में ठीक हुईं; सबसे बड़ी: नया visitor जब सीधे `…/#/plans` या `…/#/activity` खोलता था तो उसे "आपका session समाप्त हो गया" दिखता था।
- **जो मैंने नहीं बदला (आपकी मंज़ूरी चाहिए):** Tasks को Activity से अलग करना, Usage & Metrics को Plans/Developer में मिलाना, और Android के साथ नामों की एकरूपता। §8 देखें।

## 1. How it was scanned

| Step | What | Result |
|---|---|---|
| Read | `index.html`, `app.js`, `feature-pages.js`, `shell.js`, `chat-kit.js`, blueprint §3/§6/§7/§8, Android `NavGraph.kt` | Page inventory, intended IA |
| Click-through | `web/e2e/link-scan.cjs`: for every state (page, sub-page, menu, panel) it lists every clickable control, then on a **fresh load with identical starting preferences** clicks one control and records what changed (page, sub-page, overlay, text in the message box, toast, API request, file picker, popup, download) | Phone 390×844 and desktop 1366×820 |
| Look | A screenshot of every state at both sizes was reviewed | Layout and content notes in §4–§5 |
| Repo checks | Existing `quality.e2e` (responsive, axe in light/dark/Hindi, keyboard, offline), `phase1.e2e`, backend tests | §9 |

**Limits, stated plainly.** The backend used the mock AI provider, no payments and no GitHub, so those screens were scanned in their honest "not configured" state. Android was read, not run. Tablet width was checked visually only. No usability test with people was done. Seeded chat ids in the scan do not exist on the server, which is why the scan log contains 404s: the app handled them as designed (a message, and the entry is dropped).

## 2. What exists (after this PR)

| Kind | Count | Pages |
|---|---|---|
| Primary pages | 8 | Home, Chat, Activity, Capabilities, Plans, Settings, and, with Developer access on, Developer Agent and Usage & Metrics |
| Capability pages | 9 | AI Workspace, Voice, Phone Agent, Web & Research, Documents & Files, Creative Studio, Business, Developer Agent, Tasks & Automation |
| Settings pages | 11 | Account (Profile), Voice, Language, Appearance, AI, Memory, Notifications, Permissions & Device Access, Privacy & data, Security, Developer access |
| Menus, panels, dialogs | 9 | Search, notifications menu, account menu, chat history panel, chat "more" menu, keyboard shortcuts, confirm dialog, welcome/sign-in, session-ended |
| **Screens you can link to** | **28** | (30 before: Settings → Subscription and Settings → Data were stubs) |

Controls measured: **344 on desktop, 301 on phone** (before the fixes: 332 and 287).

## 3. Findings

### 3.1 Defects found — all fixed in this PR

| # | Finding | Evidence | Fix |
|---|---|---|---|
| D1 | **A new visitor opening a direct link to a data page saw "Your session has ended".** `#/plans`, `#/activity`, `#/settings/memory` asked the API before the first guest session existed → 401 → session gate. Pre-existing (reproduced on the previous commit). | First-visit probe: gate shown for 3 of 7 links on the old commit, 0 of 11 now; exactly one guest account per visit | Every API call waits for the first-visit session; guest creation is single-flight. New `phase1.e2e` step. |
| D2 | Every Capabilities card showed an **empty circle** instead of its action arrow. | Computed `::after` content was empty; `styles.css:2117` (hit-area) overwrote the arrow set at `:1422` | Removed the colliding rule (the `::before` rule already gives the 46px hit area). |
| D3 | The sidebar item **"Profile" opened the Settings list**, not the profile. | Crawl: `Profile → settings` | Opens Settings → Account. |
| D4 | Sidebar said "Metrics", the page says "Usage & Metrics". | Screenshot + crawl | One name everywhere. |
| D5 | **Two stub pages**: Settings → Subscription only said "Open Plans"; Settings → Data only led to Privacy. Each cost an extra tap. | Crawl: each had one useful control | Row goes straight to Plans; Data merged into **Privacy & data**. Old addresses (`#/settings/subscription`, `#/settings/data`) redirect. |
| D6 | **Sentences naming another page were plain text**: Notifications ("stays in Activity", "control in Permissions"), Voice ("Settings → Voice"), Tasks (three mentions of Activity), Developer (PRO plan, GitHub account). | Text search of all copy | Buttons or inline links to the page named. |
| D7 | A finished task or repository tool in Chat did not say **where to follow it up**. | Reading `renderToolActivity` | "Open Activity" / "Open Developer Agent" on the tool row (completed tools only). |
| D8 | Activity timeline → "Open" on a task went to the page you were already on. | Code path | Scrolls to Tracked tasks. |
| D9 | Home had no path to your open tasks; Plans did not warn a guest that the plan stays only with a kept account. | Blueprint §3.2 ("active work"); product copy | Home row ("1 open task", real count from `/tasks`); guest note with a link to Account. |
| D10 | Settings had a one-item group ("Account → Subscription") and odd rows leaving holes in the two-column grid. | Screenshots | Five groups of two: Account, Preferences, AI & memory, Privacy & devices, Advanced. |
| D11 | The phone's only way back (breadcrumb) was **32px**; new touch rules keyed on `pointer: coarse` alone. | Crawl sizes | 44px under 1100px or on a coarse pointer, the project's own rule. |
| D12 | A malformed `/capabilities` reply threw an unhandled error on the Permissions page. | Test stub | Treated as "couldn't load", with the message. |

### 3.2 Checked and **not** defects

- No control is truly dead. The controls the scan flags as "did nothing" are correct: the page you are already on (Home on Home, "All", "Monthly", "Default"), an empty form submitted (Sign in, Link email, Connect GitHub) and labels that only focus their input.
- Every control is reachable (nothing covered by another element) and has an accessible name.
- Sidebar items drawn in boxes in some screenshots were a capture artifact; measured in the live page only the current item has a border.
- `h1` count 2 on Settings is the list heading and the sub-page heading; only one is visible at a time.

### 3.3 Reported, not changed — need a decision (§8)

Tasks live inside Activity (blueprint wants them apart; Android already calls the tab "Tasks"); Usage & Metrics repeats Plan/Credits from Plans; "AI Workspace" and "Tasks & Automation" capability pages describe Chat and Tasks; a guest signing out cannot reach "Link an email" from the dialog that warns about it.

## 4. Recommended information architecture

**Rules (from the blueprint, §6 and the core product rules):** one purpose per page; a setting lives in one place; no page, button, number or progress without a real backend behind it; the label says where it goes.

### 4.1 Navigation model

| Size | Navigation | Where the rest lives |
|---|---|---|
| ≥ 1100px | Sidebar 256px (collapsible to an 88px rail): Home, Chat, Activity, Capabilities · Recent chats · Developer (opt-in) · Plans, Settings, Profile | Top bar: search (Ctrl K), notifications menu, account menu |
| 700–1099px | 88px rail, same items | same |
| < 700px | Top bar (menu, logo, search, bell, avatar) + **5-slot bottom bar**: Home · Capabilities · Chat (centre) · Activity/Tasks · Settings; the menu drawer holds everything else | Plans and Developer via the drawer and the account menu |

### 4.2 Pages, in the order a person needs them

**Primary pages — target 8**

| Page | One purpose | Content, top to bottom | Links out |
|---|---|---|---|
| Home | Start in one tap, resume | Greeting → voice orb → "What can I help with today?" → ≤7 quick actions → **Continue** (last chat) → **open tasks** (only if any) → message card (file, image, ask) | Chat (prefilled), Capabilities, Activity, Developer (opt-in) |
| Chat | Conversation + agent execution + confirmations + results | Header (back on phone, title, status, history, more, new) → thread, or welcome (orb → starters → recent chats → "See everything ZARVIS can do") → composer (`/` commands) | History panel, Capabilities, Activity and Developer from tool rows |
| **Tasks** (proposed) | Durable tasks: status, pause/cancel/retry | Filters → task cards → "New task" → note that tasks record steps and do not run them | Chat, Activity |
| Capabilities | Discover what ZARVIS really does | Status tally → filters → cards with real status → "All skills on this account" | Capability pages, Chat, Settings (voice) |
| Activity | What happened | Recent chats → this-session log (files, images, voice, tool runs) → filters and search | Chat, Tasks, Developer |
| **Plans & Usage** | Plan, credits, billing, usage | Plan/credits/trial tiles → guest note → plan cards → payment methods → **usage counters** (moved from Metrics) | Account (link an email) |
| Settings | All configuration | Profile card → 5 pair-groups (§4.4) | Every sub-page |
| Developer (opt-in) | Repository work | Quick starts → Task (repo, analyze, implement) → Pipeline → GitHub → recent analysis → **Diagnostics** (latency, service health; moved from Metrics) | Chat, Plans (PRO) |

**Capability pages — target 7** (blueprint §7 "agent page"): Voice, Phone Agent (Android-only, honest), Web & Research, Documents & Files, Creative Studio, Business, Developer Agent. Drop *AI Workspace* (it is Chat) and *Tasks & Automation* (it is the Tasks page). Each keeps: what it does → start → try asking → how it works → permissions → limitations, with every named page a link.

### 4.3 Settings — target 11 (this PR delivers them)

| Group | Pages |
|---|---|
| Account | Plans & billing (a link to Plans), Security |
| Preferences | Voice, Language, Appearance (incl. chat text size), Notifications |
| AI & memory | AI, Memory (incl. chat history) |
| Privacy & devices | Permissions & Device Access, Privacy & data |
| Advanced | Developer access, Keyboard shortcuts |

Account/Profile opens from the profile card, the account menu and the sidebar's Profile.

### 4.4 Page count

| | Primary | Capability | Settings | **Total** |
|---|---|---|---|---|
| Before this PR | 8 | 9 | 13 | **30** |
| After this PR | 8 | 9 | 11 | **28** |
| **Target for today's real features** | 8 | 7 | 11 | **26** |
| Blueprint long-term | up to 13 | one per agent | 11 | grows only as features become real |

**Pages the blueprint lists that should not exist yet:** *Work/Projects* (no project store), *Files* (no file store), *Research* workspace (no sources/citations store), *Creative* (no image generation), *Business* workspace. Today each is a skill reached through Chat and described on a capability page with its real status. Promote one to a primary page only when its data exists on the server.

## 5. Layout system

| Area | Rule |
|---|---|
| Shell | Content max 1040px; Chat reading column 760px; page gutters 16px (phone), 40px (desktop); fixed composer above the bottom bar |
| Page types | **List page** (breadcrumb → H1 + subtitle + one action on the right → toolbar → sections). **Focus page** (breadcrumb → back + title → reading column). **Workspace** (Chat: sticky header, thread, fixed composer; Developer: main + 320px side). **Settings** (pairs list → sub-page with back, title, value badge, panels) |
| Wayfinding | One H1 per page; desktop breadcrumb *Home › Settings › Voice*; phone shows only "‹ parent" (44px); the tab title names the page; a skip link; Home and Chat have no breadcrumb |
| Touch and focus | ≥ 44px targets below 1100px or on a coarse pointer; visible focus; reduced-motion respected |
| States | Every list has a loading, empty (with a next step) and error state that says what is true; nothing animates unless something is happening |
| Languages and themes | New visible strings get Hindi (the e2e checks the main pages for English left over); light is the default, dark by choice |

## 6. Where each piece of content lives

| Information | Lives on (one place) | Offered elsewhere as a link |
|---|---|---|
| Plan, credits, trial/renewal, payment state | Plans & Usage | Account menu, Settings → Plans & billing, Plans guest note |
| Usage counters (requests, voice, files) | Plans & Usage (today: Usage & Metrics) | — |
| Latency, service health | Developer → Diagnostics (today: Usage & Metrics) | — |
| Account, email link, sign-in | Settings → Account (Profile) | Sidebar Profile, account menu, Plans guest note |
| Chat history | Chat history panel | Sidebar recents, Home *Continue*, Chat welcome, Activity, Settings → Memory |
| Open tasks | Tasks (today: Activity → Tracked tasks) | Home count, tool rows |
| Voice, language, appearance, text size | Settings | Voice page, Capabilities cards |
| Device permissions | Settings → Permissions & Device Access | Phone page, Notifications page |
| Developer mode | Settings → Developer access | Developer page prompt |
| GitHub connection | Developer page | Developer capability page |
| Stored data, export, delete account | Settings → Privacy & data | Sign-out dialog |
| Keyboard shortcuts | Shortcuts dialog (`?`) | Settings, search, Chat menu |

## 7. Link map after this PR (desktop, measured)

Pages reaching each destination, from distinct pages / by controls:

| Destination | From pages | Controls | Destination | From pages | Controls |
|---|---|---|---|---|---|
| Home | 9 | 29 | Plans | 7 | 7 |
| Chat | 6 | 26 | Settings → Account | 6 | 6 |
| Activity | 6 | 7 | Settings → Permissions | 3 | 6 |
| Capabilities | 5 | 24 | Settings → Voice | 3 | 4 |
| Developer | 7 | 10 | Usage & Metrics | 4 | 4 |

Before the fixes Plans was reached from 5 controls, Settings → Account from 2, Activity from 4. Page links 133 → 143 (desktop), 104 → 115 (phone). Each Settings sub-page and capability page has one parent; that is normal, and each has a way back (breadcrumb, back button) and sideways links where its copy names another page.

**Linking rules the scan enforces:** every page is reachable within two taps from Home; every sub-page has a parent link; a sentence that names a page links to it (text → `data-go`); a link whose target is not a real page is refused; a label never promises a page it does not open.

## 8. Decisions I need from you (not done in this PR)

| # | Decision | Why | Effort / risk |
|---|---|---|---|
| O1 | **Split Tasks out of Activity** (new page, nav slot, `#/tasks`) | Blueprint §3.5 and §6 keep them apart; Android's tab is already "Tasks"; Activity's session log is in-memory while tasks are server data | Small–medium; touches nav, palette, i18n and the e2e view lists |
| O2 | **Fold Usage & Metrics**: usage → Plans & Usage, latency/health → Developer → Diagnostics, drop the repeated Plan/Credits tiles | Blueprint §6 "Plans & Usage"; today one number appears on 3 pages | Small |
| O3 | Phone bottom-bar slot 4: **Activity or Tasks** (needs O1) | Android parity | Trivial after O1 |
| O4 | Drop the *AI Workspace* and *Tasks & Automation* capability pages | They describe Chat and Tasks | Trivial after O1 |
| O5 | Guest sign-out dialog gets a **"Link an email"** button | A guest loses the account; the dialog says so but offers no way | Small (dialog has a fixed footer) |
| O6 | Server `GET /conversations` so chat history spans devices | History is a per-browser index today | Backend + Postgres store |
| O7 | Promote Work/Files/Research/Creative/Business to primary pages | Only when their data exists | Product + backend |
| O8 | Android label parity (Activity/Tasks/Work) | Same product, one vocabulary | With O1 |

## 9. Verification

| Check | Result |
|---|---|
| `node --test web/tests/*.test.js` | 32/32 (incl. link targets and moved addresses) |
| `web/e2e/quality.e2e.cjs` (responsive 8×6, axe light/dark/Hindi, keyboard, offline) | 24/24 |
| `web/e2e/phase1.e2e.cjs` | 31/33 on this machine; the 2 failures shell out to `psql` and fail identically on the untouched code (no Postgres here); CI runs them with Postgres. Two steps updated for the new structure (sidebar name in Hindi, removed pages) and two added (moved addresses, first-visit links) |
| Browser flow script (stubbed API, 56 steps) | 56/56: every fix in §3.1 |
| Link scan before → after | controls 332 → 344 (desktop), 287 → 301 (phone); dead 0; mismatches only keyword false positives |

**Re-running the scan:** `ZARVIS_URL=http://localhost:3100 node web/e2e/link-scan.cjs desktop` (or `phone`). It discovers pages from the app itself, prints the summary above and writes `link-scan-<size>.json`. Add `LINK_SCAN_SHOTS=<dir>` for screenshots.
