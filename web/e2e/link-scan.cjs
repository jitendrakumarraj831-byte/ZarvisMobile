/**
 * Link scan: clicks every control on every page of the web client and reports where it leads.
 *
 *   PORT=3100 JWT_SECRET=... npx tsx backend/src/index.ts &
 *   ZARVIS_URL=http://localhost:3100 node web/e2e/link-scan.cjs [phone|desktop] [only-state-prefix]
 *
 * Not part of CI (it takes about 10 minutes per size). Run it after changing navigation, page names or copy
 * that mentions another page; read the summary and the JSON (link-scan-<size>.json).
 *
 * For each state (a page, a Settings or capability sub-page, a menu or panel) it lists every clickable control,
 * then, on a FRESH load with the same starting preferences each time, clicks one control and records what changed:
 * the page, the sub-page, an overlay, text put in the message box, a toast, a request to the API, a file picker,
 * a popup or a download. A control that changes nothing is reported as DEAD unless it is the page you are already
 * on or a form submitted empty (both correct). Pages are discovered from the app itself, so a new page is scanned
 * without editing this file.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

function load(name) {
  try {
    return require(name);
  } catch {
    return require(execSync("npm root -g").toString().trim() + "/" + name);
  }
}
const { chromium } = load("playwright");

const BASE = process.env.ZARVIS_URL || "http://localhost:3100";
const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1366, height: 820 } };
const kind = process.argv[2] === "phone" ? "phone" : "desktop";
const only = process.argv[3] || "";
const OUT = process.env.LINK_SCAN_OUT || path.join(process.cwd(), `link-scan-${kind}.json`);
const SHOTS = process.env.LINK_SCAN_SHOTS || ""; // a folder: also saves a screenshot of every state
const CHROME = ".sidebar, .topbar, .bottom-nav, .desk-top, .skip-link, .drawer-scrim";

const PAGE_HELPERS = `
window.__scan = {
  CLICKABLE: 'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="option"], summary, label[for]',
  visible(e) {
    if (!e || e.hidden || e.disabled || e.closest('[hidden], [inert], .sr-only') || e.classList.contains('skip-link')) return false;
    if (!e.getClientRects().length) return false;
    const cs = getComputedStyle(e);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && !e.classList.contains('file-input-visually-hidden');
  },
  list(scopeSel, chromeSel, wantChrome) {
    const root = scopeSel ? document.querySelector(scopeSel) : document;
    if (!root) return [];
    return [...root.querySelectorAll(this.CLICKABLE)].filter((e) => this.visible(e)).filter((e) => scopeSel || wantChrome || !e.closest(chromeSel));
  },
  describe(e) {
    const r = e.getBoundingClientRect();
    const attrs = {};
    for (const a of e.attributes) if (/^(data-|aria-label|href|id|role)/.test(a.name)) attrs[a.name] = a.value.slice(0, 120);
    const name = (e.getAttribute('aria-label') || e.innerText || e.textContent || e.title || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
    const sec = e.closest('section, nav, header, aside, form, [role=dialog]');
    return { tag: e.tagName.toLowerCase(), name, attrs, w: Math.round(r.width), h: Math.round(r.height), section: sec ? (sec.getAttribute('aria-label') || sec.id || sec.className.split(' ')[0] || sec.tagName.toLowerCase()) : '' };
  },
  snap() {
    const overlays = [...document.querySelectorAll('.modal-overlay, .palette-overlay, .shell-popover, #sidebar-nav.is-open')].filter((e) => !e.hidden && (e.id === 'sidebar-nav' || e.getClientRects().length)).map((e) => e.id || e.className.split(' ')[0]);
    const panel = [...document.querySelectorAll('[data-settings-panel]')].find((p) => !p.hidden);
    const toast = document.getElementById('toast');
    let h = 5381; const html = document.body.innerHTML; for (let i = 0; i < html.length; i++) h = ((h << 5) + h + html.charCodeAt(i)) | 0;
    return { view: document.body.dataset.activeView, hash: location.hash, settings: panel ? panel.dataset.settingsPanel : null,
      h1: (document.querySelector('.view:not([hidden]) h1:not(.sr-only)') || {}).textContent?.trim() || null,
      composer: (document.getElementById('text-input') || {}).value || '', overlays, toast: toast && !toast.hidden ? toast.textContent.trim() : null,
      appearance: document.documentElement.dataset.appearance, lang: document.documentElement.lang,
      pressed: [...document.querySelectorAll('[aria-pressed="true"]')].map((e) => e.id || e.dataset.size || e.dataset.filter || e.dataset.billing || '').join(','), dom: h };
  },
};`;

async function newContext(browser) {
  const ctx = await browser.newContext({ viewport: SIZES[kind], acceptDownloads: true, isMobile: kind === "phone", hasTouch: kind === "phone" });
  // Every load starts from the same preferences, so one click's side effect (language, theme, draft, open chat) cannot leak into the next.
  await ctx.addInitScript(() => {
    try {
      for (const k of ["zarvis.lang", "zarvis.appearance", "zarvis.speak", "zarvis.ttsVoice", "zarvis.chatText", "zarvis.sidebarRail", "zarvis.draft", "zarvis.conversationId"]) localStorage.removeItem(k);
      localStorage.setItem("zarvis.welcomeDismissed", "1");
      localStorage.setItem("zarvis.devAccess", "on");
      localStorage.setItem("zarvis.chats", JSON.stringify([
        { id: "00000000-0000-4000-8000-0000000000a1", title: "Plan my launch week", updatedAt: Date.now() - 2 * 3600000 },
        { id: "00000000-0000-4000-8000-0000000000a2", title: "Explain photosynthesis simply", updatedAt: Date.now() - 30 * 3600000 },
      ]));
    } catch {}
  });
  return ctx;
}

async function open(page, state) {
  await page.goto("about:blank"); // a hash-only goto would keep the old page (and the last click's state) alive
  await page.goto(BASE + "/" + state.hash, { waitUntil: "domcontentloaded" });
  await page.evaluate(PAGE_HELPERS);
  await page.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"), null, { timeout: 15000 });
  await page.waitForTimeout(450);
  if (state.thread) {
    await page.fill("#text-input", "Plan my launch week");
    await page.press("#text-input", "Enter");
    await page.waitForSelector(".bubble.assistant .bubble-actions", { timeout: 15000 });
    await page.waitForSelector(".refine-row .refine-chip", { timeout: 15000 });
    await page.waitForTimeout(600);
  }
  if (state.open) {
    // A project's sections are drawn once its data has arrived.
    if (state.open.startsWith("#project-tab")) await page.waitForSelector(state.open, { timeout: 8000 }).catch(() => {});
    await page.evaluate((sel) => document.querySelector(sel)?.click(), state.open);
    await page.waitForTimeout(350);
  }
}

/** The pages come from the app: Settings rows, capability pages, then menus and panels. */
async function discoverStates(page) {
  await open(page, { hash: "#/home" });
  const { settings, features } = await page.evaluate(() => ({
    settings: [...document.querySelectorAll("[data-settings-page]")].map((n) => n.dataset.settingsPage).filter((v, i, a) => a.indexOf(v) === i),
    features: (window.ZarvisFeatures?.catalog || []).map((c) => c.id),
  }));
  // The Work and Agents pages show what the account has: put one project with a file, a decision, a memory and a task on it.
  const projectId = await page.evaluate(async () => {
    const call = (path, body) => fetch("/api/v1" + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") }, body: JSON.stringify(body) }).then((r) => r.json());
    const project = await call("/projects", { name: "Link scan project", goal: "Check every control", agentId: "research" });
    await call("/notes", { kind: "decision", content: "A decision", projectId: project.id });
    await call("/notes", { kind: "memory", content: "A project memory", projectId: project.id });
    await call("/notes", { kind: "memory", content: "A personal memory" });
    await call("/files/text", { name: "scan.txt", text: "Some text to read.", source: "upload", projectId: project.id });
    await call("/tasks", { goal: "A task to look at", projectId: project.id });
    return project.id;
  });
  const states = [];
  const add = (name, hash, extra = {}) => states.push({ name, hash, ...extra });
  add("home", "#/home", { chrome: true });
  add("chat-empty", "#/chat", { chrome: true });
  for (const v of ["activity", "capabilities"]) add(v, "#/" + v);
  for (const tab of ["projects", "files", "research", "tasks", "outputs"]) add("work:" + tab, "#/work/" + tab);
  for (const tab of ["overview", "chats", "files", "research", "tasks", "decisions", "memory", "activity"]) add("work:project-" + tab, "#/work/project-" + projectId, { open: "#project-tab-" + tab });
  add("agents", "#/agents");
  for (const id of ["personal", "research", "documents", "creative", "business", "developer"]) add("agents:" + id, "#/agents/" + id);
  for (const f of features) add("feature:" + f, "#/capabilities/" + f);
  for (const v of ["developer", "metrics", "plans", "settings"]) add(v, "#/" + v);
  for (const s of settings) add("settings:" + s, "#/settings/" + s);
  add("popover:profile", "#/home", { open: "[data-shell=profile]:not(.topbar-avatar)", scope: ".shell-popover" });
  add("popover:notifications", "#/home", { open: "[data-shell=notifications]:not(.topbar-activity)", scope: ".shell-popover" });
  if (kind === "desktop") add("palette", "#/home", { open: "#desk-search-btn", scope: ".palette-overlay" });
  else add("palette", "#/home", { open: ".topbar [data-shell=search]", scope: ".palette-overlay" });
  add("history-panel", "#/chat", { open: "#chat-history-btn", scope: "#history-overlay" });
  add("chat-more-menu", "#/chat", { open: "#chat-more-btn", scope: ".shell-popover" });
  add("shortcuts", "#/settings", { open: "[data-open-shortcuts]", scope: "#shortcuts-modal" });
  if (kind === "phone") add("drawer", "#/home", { open: "#menu-btn", scope: "#sidebar-nav" });
  add("chat-thread", "#/chat", { thread: true });
  return states;
}

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const where = (a) => (a.view === "settings" && a.settings ? "settings/" + a.settings : a.view === "feature" ? "capabilities/" + (a.h1 || "?") : a.view);

function summarize(result) {
  const lines = [];
  const edges = new Map();
  let controls = 0, links = 0, prompts = 0, overlays = 0, benign = 0;
  const dead = [];
  for (const s of result.states) {
    for (const r of s.records) {
      controls++;
      const d = r.diff || {};
      const label = norm(r.name) || "(no name)";
      if (r.outcome === "NOTHING") {
        const here = /^(zarvis ai home|home|chat|work|agents|projects|files|research|outputs|tasks|activity|capabilities|plans|settings|developer|metrics|all|monthly|default|repository|send|new chat|overview|decisions|memory)/i.test(label) || r.tag === "label" || /form/.test(r.section || "");
        if (here) benign++; else dead.push(`${s.name} :: "${label}" [${r.section}]`);
      } else if (r.after && (d.view || d.settings !== undefined)) {
        if (d.composer) prompts++;
        else { links++; const to = where(r.after); if (!edges.has(to)) edges.set(to, new Set()); edges.get(to).add(s.name.replace(/^settings:.*/, "settings/*").replace(/^feature:.*/, "capabilities/*")); }
      } else if (d.composer) prompts++;
      else if (d.overlays) overlays++;
    }
  }
  lines.push(`## ${result.kind} ${result.viewport.width}x${result.viewport.height}: ${result.states.length} states, ${controls} controls clicked`);
  lines.push(`page links: ${links}; prompts put into Chat: ${prompts}; menus/panels opened: ${overlays}; same-page or empty-form clicks (correct): ${benign}; DEAD: ${dead.length}`);
  for (const d of dead) lines.push("  DEAD " + d);
  const single = [...edges.entries()].filter(([, from]) => from.size === 1).map(([to]) => to);
  lines.push("", "| Destination | Reached from (distinct pages) |", "|---|---|");
  for (const [to, from] of [...edges.entries()].sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`| ${to} | ${from.size} |`);
  lines.push("", `Reached from only one page (normal for a sub-page, check the rest): ${single.join(", ") || "none"}`);
  const noName = result.states.flatMap((s) => s.records.filter((r) => !norm(r.name)).map((r) => `${s.name}: <${r.tag}>`));
  if (noName.length) lines.push("", "Controls with no accessible name: " + noName.join("; "));
  return lines.join("\n");
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM, args: ["--no-sandbox"] } : {});
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const seen = { requests: [], popups: [], chooser: false, downloads: [], errors: [] };
  page.on("request", (r) => { if (r.url().includes("/api/v1/")) seen.requests.push(r.method() + " " + new URL(r.url()).pathname.replace("/api/v1", "")); });
  page.on("popup", (p) => { seen.popups.push(p.url()); p.close().catch(() => {}); });
  page.on("filechooser", (fc) => { seen.chooser = true; fc.setFiles([]).catch(() => {}); });
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  page.on("download", (d) => seen.downloads.push(d.suggestedFilename()));
  page.on("pageerror", (e) => seen.errors.push("pageerror: " + e.message));
  const reset = () => { seen.requests.length = 0; seen.popups.length = 0; seen.chooser = false; seen.downloads.length = 0; seen.errors.length = 0; };

  const result = { kind, viewport: SIZES[kind], states: [] };
  const states = (await discoverStates(page)).filter((s) => !only || s.name.startsWith(only));
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  for (const state of states) {
    await open(page, state);
    const wantChrome = !!state.chrome;
    const scope = state.scope || null;
    const items = await page.evaluate(({ scope, chrome, wantChrome }) => window.__scan.list(scope, chrome, wantChrome).map((e) => window.__scan.describe(e)), { scope, chrome: CHROME, wantChrome });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${kind}-${state.name.replace(/[:]/g, "_")}.png`), fullPage: !scope && !state.open });
    const records = [];
    for (let i = 0; i < items.length; i++) {
      const rec = { i, ...items[i] };
      try {
        if (i > 0) await open(page, state);
        reset();
        const handle = await page.evaluateHandle(({ scope, chrome, wantChrome, i }) => window.__scan.list(scope, chrome, wantChrome)[i], { scope, chrome: CHROME, wantChrome, i });
        const el = handle.asElement();
        if (!el) { rec.outcome = "missing-after-reload"; records.push(rec); continue; }
        await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        const before = await page.evaluate(() => window.__scan.snap());
        const hit = await el.evaluate((e) => { const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const top = document.elementFromPoint(x, y); return { x, y, ok: !!top && (top === e || e.contains(top) || top.contains(e)) }; });
        rec.reachable = hit.ok;
        if (hit.ok) await page.mouse.click(hit.x, hit.y); else await el.evaluate((e) => e.click());
        await page.waitForTimeout(450);
        const after = await page.evaluate(() => window.__scan.snap()).catch(() => null);
        rec.after = after; rec.requests = [...seen.requests]; rec.chooser = seen.chooser; rec.popups = [...seen.popups]; rec.downloads = [...seen.downloads]; rec.errors = [...seen.errors];
        if (!after) rec.outcome = "page-navigated-away";
        else {
          const diff = {};
          for (const k of Object.keys(after)) if (JSON.stringify(after[k]) !== JSON.stringify(before[k])) diff[k] = [before[k], after[k]];
          rec.diff = diff;
          rec.outcome = Object.keys(diff).length || rec.requests.length || rec.popups.length || rec.chooser || rec.downloads.length ? "acted" : "NOTHING";
        }
      } catch (err) {
        rec.outcome = "error";
        rec.err = String(err.message || err).split("\n")[0].slice(0, 160);
      }
      records.push(rec);
    }
    result.states.push({ ...state, count: items.length, records });
    console.log(`${kind} ${state.name.padEnd(26)} ${String(items.length).padStart(3)} controls`);
  }
  fs.writeFileSync(OUT, JSON.stringify(result));
  await browser.close();
  console.log("\n" + summarize(result) + "\n\nfull data: " + OUT);
  process.exit(result.states.some((s) => s.records.some((r) => r.outcome === "NOTHING" && !/^(zarvis ai home|home|chat|tasks|activity|capabilities|plans|settings|developer|metrics|all|monthly|default|repository|send|new chat)/i.test(norm(r.name)) && r.tag !== "label" && !/form/.test(r.section || ""))) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
