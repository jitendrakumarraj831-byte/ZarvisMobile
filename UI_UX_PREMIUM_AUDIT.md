# ZARVIS web — premium UI/UX pass: audit, changes, evidence

> Date: 2026-10-09 · Branch `claude/cool-goodall-hmth0s` · PR [#92](https://github.com/jitendrakumarraj831-byte/ZarvisMobile/pull/92) · Builds on PR #91 (merged: Work, Agents, truthful tasks, execution cards).
> Everything below was measured in a real browser against the real backend with Postgres unless it says otherwise.

## 1. What was audited

PR #91 is merged and this branch started at its merge commit, so the repository was clean and fully tested at the start.
The audit covered `web/app.js`, `web/shell.js`, `web/chat-kit.js`, `web/exec-cards.js`, `web/workspace.js`, `web/feature-pages.js`,
`web/logic.js`, `web/i18n.js`, `web/styles.css`, `web/index.html`, `web/sw.js`, the backend routes the pages call, and the three
browser suites. Every page was screenshotted at phone and desktop sizes in light and dark (108 images), plus a computed-style dump of
every design token, a CSS audit (undefined variables, unused classes, duplicate selectors) and a click-through of every control.

**Baseline before any change:** backend 619 tests passed (Postgres), web units 47, Phase 1 E2E 36/36, quality E2E 24/24, workspace E2E 41/41.
(Without a database the two developer steps of Phase 1 cannot run; Postgres 16 was started locally for all runs.)

The product is mature: it already had a design system, shell, home, a full chat, execution cards, projects, agents, tasks, settings, plans,
Hindi and accessibility tests. The work was therefore "find the real gaps against the brief and close them without rebuilding", not a redesign.

## 2. Page by page

| Page | Found | Done | Evidence |
| --- | --- | --- | --- |
| Home | Only the orb, prompts and composer; no recent work, no task or file status, no plan, no first-time guide; prompts were static | "Your workspace" below the unchanged first screen: recent chats, projects, files, open tasks, recent tool runs, plan and credits, all read from the server; a failed read is named and never looks like a new account; a new account gets a hideable three-step guide; prompts hide when the build has no skill behind them; a "Your workspace" cue appears only when there is content | `homeDashboard` and `entryAvailable` unit tests; workspace E2E (every card compared with the API, failure, offline, write invalidation, new account); quality E2E (prompts follow skills) |
| Chat | Replies had no tables, no block quotes, no syntax colour, `####` headings showed as text. A short spoken reply left the orb on "Speaking" and Send as Stop for good. No pause for spoken replies | Tables, quotes, strikethrough, `####`, coloured code (js/ts/json/python/shell/sql/css/html), all escaped; the Speaking bug fixed; Pause/Resume/Stop speech bar | 6 new unit tests for the renderer (incl. escaping/XSS; the tokenizer test was checked to fail when the tokenizer is broken); quality E2E markdown and voice steps |
| Work → Projects | No search or sort; a long page header on every sub-page; tab row cut words mid-letter on phones | Search (name, goal, description) and sort; one-line description per section and none inside a project; edge fade on rows that scroll | unit + workspace E2E (focus kept while typing, fade follows scroll) |
| Work → Tasks | List only; no filters or sort | List/Board toggle (remembered), filters with counts, sort, search; board columns are the real lifecycle groups, unknown values get "Other" | 2 unit tests (every backend lifecycle value lands in exactly one column); workspace E2E |
| Agents | The detail page had two identical "‹ Agents" back buttons | One (the breadcrumb) | pixel diff, quality E2E |
| Plans | After Checkout, a refused verification still toasted "Payment received"; a failed or unconfirmed payment had no lasting result; plan and entitlements were read one after the other | Persistent result on the page with the payment id: rejected / not confirmed / active / still not active; closing checkout and a gateway failure are worded truthfully; both reads in parallel | unit test of the classifier; quality E2E with a stubbed gateway for all seven outcomes |
| Settings | No Integrations section; Voice said nothing about what the browser can do | Integrations (GitHub from the server's own status, Calendar from the registry, plain line that Gmail/Drive/Slack do not exist); Voice → "What this browser can do" with guidance for each "no" | workspace + quality E2E |
| All pages | Tokens defined in five overlapping `:root` blocks (the top one silently overridden); one undefined variable; 25 dead rules | One token block with a type scale and code colours; dead rules removed; a guard test | 88 tokens × 6 contexts identical, 107/108 screenshots pixel-identical; `css.test.js` |
| All pages | No request timeout on page reads | `apiFetch` `timeoutMs` (25 s) on reads; the unavailable state shows instead of loading for ever | quality E2E (stalled server) |
| Hindi | Count phrases ("1 chat", "2 files") were never translated; the test accepted a line with one Hindi word | Patterns for every count phrase; the test reads " · "-joined lines part by part and now covers the dashboard, board, projects toolbar and Integrations | Phase 1 E2E |
| Activity, Capabilities, Developer, Metrics, Memory, Files, Research, Outputs, Chat history, dialogs, drawer | Reviewed (screenshots, axe, widths, click-through); no defect against the brief | unchanged | existing suites + link scan |

## 3. The brief, section by section

| § | Status |
| --- | --- |
| 1 Audit | Done (this file). |
| 2 Preserve everything | Backend untouched; 619 backend tests pass; no API renamed. One test assertion was changed on purpose (see §6). |
| 3 Design system | Existing aurora-glass system kept. Tokens consolidated and documented ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)); type scale and code tokens added; guarded by `css.test.js`. A full de-layering of the stylesheet (204 selectors are still declared more than once) is **not** done: it is risky without a visual-regression suite, and this release adds the guard that makes it safe to do next. |
| 4 Shell and navigation | Already complete (sidebar, rail, bottom bar, drawer, breadcrumbs, routes, history, shortcuts). Fixed the duplicate back button; section descriptions. |
| 5 Home | Done, with the limits in §5. |
| 6 Chat | Markdown (tables, quotes, code colours) added; speech Pause. Everything else listed was already present and tested (copy, regenerate, edit, retry, stop, search, timestamps, attachments, paste and drop, auto-scroll, duplicate-send guard). Rename, pin, archive and delete chats: **the server has no such endpoint**, so none is offered. |
| 7 Execution status | Already real-event based (cards, reconnect, stored ledger). Unchanged. |
| 8 Voice | Added pause/resume, the Voice check and fixed the stuck "Speaking". Orb states, waveform, permission guidance and single-utterance recognition already existed. **Not done:** live (interim) transcript, a distinct "Interrupted" state, TTS progress. |
| 9 Projects | Search/sort added; the rest existed. "Recent" means most recently updated (the server stores no "opened" time). |
| 10 Agents | Existing pages (skills, risk, cost, plan availability, confirmation rule, recent runs) kept. **Not shown:** a per-skill WORKING/PARTIAL status, because the server returns none per skill. |
| 11 Tasks | Board, filters, sort added. Nothing claims background or scheduled execution; there is none. |
| 12 Files / Research / Outputs | Already complete. Unchanged. |
| 13 Developer Agent | Unchanged (already stages, confirmations, PR check-runs). |
| 14 Settings | Integrations and Voice check added. Every setting saves on change with a confirmation, so there is no unsaved state to warn about. |
| 15 Billing | Truthful outcomes, persistent result, parallel reads. Razorpay and Play Billing code paths unchanged. |
| 16 Components | Documented and guarded; reused rather than rewritten. |
| 17 Responsive | 320, 360, 390, 412, 768, 1024, 1280, 1440 verified for every new or changed page; the existing suite covers every page at 9 widths. |
| 18 Accessibility, i18n | axe (serious/critical) clean in light, dark and Hindi on all new pages; live regions for result counts, payment result, speech; reduced motion respected by the new animation. |
| 19 Micro-interactions | Deliberately minimal: edge fades and the speech-bar waveform (off under reduced motion). |
| 20 Performance, reliability | Read timeouts, parallel reads, one Home read per visit with write invalidation, a listener leak fixed. **Not done:** list virtualization (most lists are capped by the server; the task list is not), route-level code splitting. |
| 21 Testing | See §4. |

## 4. Bugs found and fixed (with a regression test each)

1. A short spoken reply left the orb on "Speaking" and Send as Stop forever (turn ended before its audio was scheduled). *Pre-existing.*
2. A refused or unanswered payment confirmation still said "Payment received". *Pre-existing.*
3. Count phrases in Hindi were English ("1 chat", "2 files"), hidden by a lenient test. *Pre-existing.*
4. A second identical back button on agent pages. *Pre-existing.*
5. An undefined CSS variable (`--text-muted`) with a low-contrast fallback. *Pre-existing.*
6. Page reads could wait for ever on a stalled server. *Pre-existing.*
7. Found by re-reading my own changes and fixed within this PR: a listener leak in the new scroll-fade helper (it shipped in an intermediate commit and was fixed in the next); an older turn finishing could set the orb idle over newer speech (now owned by an epoch); a regex lookbehind that would have broken old Safari (fixed before it was committed).

## 5. Honest limits of what was built

* Home and the board only show what the server returned; a list that failed to load is named, not hidden.
* Chat history rename/pin/archive/delete need server endpoints that do not exist. Only "remove from this browser's list" exists.
* The speech bar and the Voice check were tested with a faked recogniser and stubbed audio in headless Chromium. **Real microphones, real speakers, iOS Safari and a real Gemini voice were not exercised.**
* Payments were tested with a stubbed Razorpay and stubbed `/billing/*` answers; no real payment, webhook or Play Billing purchase was made.
* The Android app was not run or changed.
* GitHub writes are covered by the repository's GitHub test double (as before), not live GitHub.

## 6. Intentional behaviour change

`phase1.e2e` asserted "no activity status on Home" (a decision from the earlier Home redesign). This task asks for task, file and agent activity on Home, so
the assertion is now scoped to Home's first screen, and the dashboard is a separate block below it.

## 7. Verification

Results on the final commit (Postgres 16, real backend, headless Chromium; each browser suite on its own backend process):

| Check | Command | Result |
| --- | --- | --- |
| Web units | `node --test web/tests/*.test.js` | 64/64 |
| Phase 1 E2E | `node web/e2e/phase1.e2e.cjs` | 36/36 |
| Quality E2E | `node web/e2e/quality.e2e.cjs` | 31/31 |
| Workspace E2E | `node web/e2e/workspace.e2e.cjs` | 46/46 |
| Backend | `cd backend && npx vitest run` (with `TEST_DATABASE_URL`) | 619 passed, 2 live-API tests skipped (backend untouched) |
| Typecheck | root and `backend` | clean |

**CI note.** Guest sign-ups are limited to 60 an hour per server process. Phase 1 and the quality suite used to share one process in CI;
with the quality suite's new steps they used the whole budget and its last two steps failed with HTTP 429 (reproduced locally: 29/31 on a
shared process, 31/31 on its own). `backend-tests.yml` now starts a separate backend for each browser suite.
The `smoke` check calls the live Vercel preview and the real Gemini API; when Gemini answers `AI_UNAVAILABLE` to the web-search turn it
fails, whatever the diff. It is not run locally.
Not covered by an automated pass/fail: `web/e2e/link-scan.cjs` (an exploratory click-through; it reported no dead control on Home, phone and desktop).

## 8. Next phase (recommended)

1. Chat rename/pin/archive/delete with real endpoints, then the UI.
2. Per-skill status on agent pages from the registry.
3. De-layer `styles.css` (merge the "v3 / v4 / premium / page by page / studio" layers) behind a screenshot-diff test.
4. A real-device pass: iOS Safari, Android Chrome, a real microphone and speaker, a live payment in test mode.
5. Interim transcript and an "Interrupted" state for voice.
