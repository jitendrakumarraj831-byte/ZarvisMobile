/**
 * Screenshot gallery of every page of the website, run against a real backend (+ Postgres), in Chromium:
 *
 *   PORT=3100 POSTGRES_URL=... npx tsx backend/src/index.ts &
 *   ZARVIS_URL=http://localhost:3100 GALLERY_OUT=/tmp/zarvis-gallery node web/e2e/gallery.cjs
 *
 * Every page the app has (discovered from the app, like link-scan.cjs) at 360, 768, 1024 and 1440 px, in light and dark, in English
 * and Hindi. Each shot also records: horizontal overflow, console errors, failed requests, the page's h1, and in Hindi the interface
 * labels (headings, buttons, navigation) that are still Latin-only. Output: GALLERY_OUT/<look>/<width>/<page>.jpg, report.json and
 * index.html (open it in a browser). GALLERY_MATRIX=quick takes 360 and 1440 px in light English and dark Hindi only.
 *
 * The rows on the Work, Agents and Memory pages are created through the real API by this script (one project with a file, a decision,
 * memories and a task), and the chat thread is one real turn; with no AI key on the server its text comes from the mock provider,
 * which report.json records (`provider` from /health). Nothing on a page is drawn from fixtures.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
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
const OUT = process.env.GALLERY_OUT || path.join(os.tmpdir(), "zarvis-gallery");
const QUICK = process.env.GALLERY_MATRIX === "quick";
const WIDTHS = QUICK ? [360, 1440] : [360, 768, 1024, 1440];
const LOOKS = QUICK
  ? [{ id: "light-en", appearance: "aurora", lang: "en" }, { id: "dark-hi", appearance: "dim", lang: "hi" }]
  : [
      { id: "light-en", appearance: "aurora", lang: "en" },
      { id: "dark-en", appearance: "dim", lang: "en" },
      { id: "light-hi", appearance: "aurora", lang: "hi" },
      { id: "dark-hi", appearance: "dim", lang: "hi" },
    ];
const HEIGHT = { 360: 780, 768: 1024, 1024: 768, 1440: 900 };

/** Brand and product names that stay in Latin script in Hindi (the dictionary keeps them too). */
const KEEP_LATIN = /^(ZARVIS( AI)?|AI|English|GitHub|Gemini|Android|PRO|Pro|PDF|UPI|INR|README|TTS|Google|Ctrl K|Esc|OK|API|URL|ID|DOCX|TXT|CSV|JSON|MD|Z|ZA|\W+|[\d\s.,:%+-]+)$/;

const files = { shots: [] };

async function ready(page) {
  await page.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"), null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector("#orb")?.dataset.state === "IDLE", null, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => !/^#\/home|^$/.test(location.hash) || document.getElementById("home-dash")?.hasAttribute("data-loaded"), null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function discover(page) {
  await page.goto(BASE + "/#/home");
  await ready(page);
  const { settings, features } = await page.evaluate(() => ({
    settings: [...document.querySelectorAll("[data-settings-page]")].map((n) => n.dataset.settingsPage).filter((v, i, a) => a.indexOf(v) === i),
    features: (window.ZarvisFeatures?.catalog || []).map((c) => c.id),
  }));
  const projectId = await page.evaluate(async () => {
    const call = (p, body) => fetch("/api/v1" + p, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") }, body: JSON.stringify(body) }).then((r) => r.json());
    const project = await call("/projects", { name: "Website relaunch", goal: "Ship the new site by the end of the quarter", agentId: "research" });
    await call("/notes", { kind: "decision", content: "Use the existing design tokens", projectId: project.id });
    await call("/notes", { kind: "memory", content: "Brand colour is violet", projectId: project.id });
    await call("/notes", { kind: "memory", content: "I prefer short answers" });
    await call("/files/text", { name: "brief.txt", text: "Brief: rebuild the landing page and pricing page.", source: "upload", projectId: project.id });
    await call("/tasks", { goal: "Prepare the weekly report", steps: ["Collect the numbers", "Write the summary"], projectId: project.id });
    return project.id;
  });
  const pages = [];
  const add = (name, hash, extra = {}) => pages.push({ name, hash, ...extra });
  add("home", "#/home");
  add("chat-empty", "#/chat", { open: "#chat-new-btn" }); // the app reopens the last chat; New Chat shows the empty state
  add("chat-thread", "#/chat", { thread: true });
  for (const tab of ["projects", "files", "research", "tasks", "outputs"]) add("work-" + tab, "#/work/" + tab);
  add("work-project", "#/work/project-" + projectId);
  add("agents", "#/agents");
  add("agents-research", "#/agents/research");
  add("activity", "#/activity");
  add("capabilities", "#/capabilities");
  for (const f of features) add("capability-" + f, "#/capabilities/" + f);
  for (const v of ["plans", "developer", "metrics", "settings"]) add(v, "#/" + v);
  for (const s of settings) add("settings-" + s, "#/settings/" + s);
  add("drawer", "#/home", { open: "#menu-btn", phoneOnly: true });
  add("search", "#/home", { open: "[data-shell=search]:not([hidden]), #desk-search-btn" });
  return pages;
}

/** One real chat turn, so the thread page shows a real reply (the provider is whatever the server is configured with). */
async function makeThread(page) {
  await page.goto("about:blank");
  await page.goto(BASE + "/#/chat");
  await ready(page);
  await page.fill("#text-input", "Plan my launch week in three steps");
  await page.press("#text-input", "Enter");
  await page.waitForSelector(".bubble.assistant .bubble-actions", { timeout: 30000 });
  // The thread's own address (#/chat/<id>): plain #/chat reopens whatever chat is current, which New Chat (the empty-chat shot) clears.
  await page.waitForFunction(() => /^#\/chat\/[\w-]+/.test(location.hash) || !!localStorage.getItem("zarvis.conversationId"), null, { timeout: 15000 });
  return page.evaluate(() => (/^#\/chat\/[\w-]+/.test(location.hash) ? location.hash : "#/chat/" + localStorage.getItem("zarvis.conversationId")));
}

async function measure(page, lang) {
  return page.evaluate((isHindi) => {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    // A visually hidden (.sr-only) h1 still names the page for a screen reader, so it counts.
    const h1 = [...document.querySelectorAll(".view:not([hidden]) h1, #view-feature:not([hidden]) h1")].find((el) => visible(el) || el.classList.contains("sr-only"));
    let latin = [];
    if (isHindi) {
      const seen = new Set();
      for (const el of document.querySelectorAll(".view:not([hidden]) :is(h1, h2, h3, button, label, .nav-item span, .crumb, th), .sidebar .nav-item span, .bottom-nav span, .topbar button")) {
        if (!visible(el) || el.closest("[data-user-text], .bubble, textarea, input, code, pre")) continue;
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!text || /[ऀ-ॿ]/.test(text) || seen.has(text)) continue;
        seen.add(text);
        latin.push(text.slice(0, 60));
      }
    }
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      h1: h1 ? h1.textContent.replace(/\s+/g, " ").trim() : null,
      latin,
    };
  }, lang === "hi");
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const health = await fetch(BASE + "/health").then((r) => r.json()).catch(() => ({}));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("zarvis.welcomeDismissed", "1");
      localStorage.setItem("zarvis.devAccess", "on");
    } catch {}
  });
  const page = await ctx.newPage();
  let current = [];
  page.on("console", (m) => { if (m.type() === "error") current.push("console: " + m.text().slice(0, 200)); });
  page.on("pageerror", (e) => current.push("page error: " + String(e).slice(0, 200)));
  page.on("requestfailed", (r) => { if (!/\/tts\//.test(r.url())) current.push(`request failed: ${r.method()} ${r.url().replace(BASE, "")} ${r.failure()?.errorText ?? ""}`); });
  page.on("response", (r) => { if (r.status() >= 400) current.push(`HTTP ${r.status()}: ${r.url().replace(BASE, "")}`); });

  const pages = await discover(page);
  const threadHash = await makeThread(page);
  const started = Date.now();
  for (const look of LOOKS) {
    await page.evaluate(([a, l]) => { localStorage.setItem("zarvis.appearance", a); localStorage.setItem("zarvis.lang", l); localStorage.removeItem("zarvis.sidebarRail"); }, [look.appearance, look.lang]);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: HEIGHT[width] });
      fs.mkdirSync(path.join(OUT, look.id, String(width)), { recursive: true });
      for (const p of pages) {
        if (p.phoneOnly && width >= 700) continue;
        current = [];
        await page.goto("about:blank"); // a hash-only goto would keep the previous page alive
        await page.goto(BASE + "/" + (p.thread ? threadHash : p.hash));
        await ready(page);
        if (p.open) {
          await page.evaluate((sel) => [...document.querySelectorAll(sel)].find((n) => n.offsetParent !== null)?.click(), p.open);
          await page.waitForTimeout(450);
        }
        const facts = await measure(page, look.lang);
        const file = path.join(look.id, String(width), p.name + ".jpg");
        await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 72 });
        files.shots.push({ page: p.name, look: look.id, width, file, ...facts, problems: current.slice(0, 8) });
        process.stdout.write(".");
      }
    }
  }
  await browser.close();

  const shots = files.shots;
  const report = {
    base: BASE,
    provider: health.provider || "unknown",
    database: health.database || "unknown",
    widths: WIDTHS,
    looks: LOOKS.map((l) => l.id),
    pages: [...new Set(shots.map((s) => s.page))],
    shots: shots.length,
    seconds: Math.round((Date.now() - started) / 1000),
    overflow: shots.filter((s) => s.overflow).map((s) => `${s.look}/${s.width}/${s.page}`),
    problems: shots.filter((s) => s.problems.length).map((s) => ({ shot: `${s.look}/${s.width}/${s.page}`, problems: s.problems })),
    missingH1: shots.filter((s) => !s.h1 && !["drawer", "search"].includes(s.page)).map((s) => `${s.look}/${s.width}/${s.page}`),
    hindiLatinLabels: Object.fromEntries(
      [...new Set(shots.filter((s) => s.look.endsWith("-hi")).map((s) => s.page))].map((name) => {
        const labels = new Set();
        for (const s of shots.filter((x) => x.page === name && x.look.endsWith("-hi"))) for (const t of s.latin) if (!KEEP_LATIN.test(t)) labels.add(t);
        return [name, [...labels].slice(0, 12)];
      }).filter(([, labels]) => labels.length),
    ),
    list: shots,
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const sections = report.pages.map((name) => {
    const cells = shots.filter((s) => s.page === name).map((s) => `<figure${s.overflow || s.problems.length ? ' class="flag"' : ""}><a href="${esc(s.file)}"><img loading="lazy" src="${esc(s.file)}" alt="${esc(name)} ${s.look} ${s.width}px"></a><figcaption>${s.look} · ${s.width}px${s.overflow ? " · overflow" : ""}${s.problems.length ? " · " + s.problems.length + " problem(s)" : ""}</figcaption></figure>`).join("");
    return `<section><h2>${esc(name)}</h2><div class="grid">${cells}</div></section>`;
  }).join("\n");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ZARVIS gallery</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;background:#f6f7ff;color:#0f1430}h2{margin:32px 0 8px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}figure{margin:0;background:#fff;border:1px solid #dde;border-radius:12px;padding:8px}figure.flag{border-color:#b42318}img{width:100%;height:220px;object-fit:cover;object-position:top;border-radius:8px}figcaption{font-size:12px;color:#464c70;margin-top:4px}</style>
<h1>ZARVIS web gallery</h1><p>${report.shots} screenshots of ${report.pages.length} pages · widths ${WIDTHS.join(", ")} · ${report.looks.join(", ")} · AI provider: ${esc(report.provider)} · overflow: ${report.overflow.length} · shots with problems: ${report.problems.length}</p>
${sections}</html>`;
  fs.writeFileSync(path.join(OUT, "index.html"), html);
  console.log(`\n${report.shots} shots, ${report.pages.length} pages in ${report.seconds}s → ${OUT}`);
  console.log(`overflow: ${report.overflow.length}; shots with console/network problems: ${report.problems.length}; missing h1: ${report.missingH1.length}; pages with Latin-only Hindi labels: ${Object.keys(report.hindiLatinLabels).length}`);
  if (report.overflow.length) console.log("OVERFLOW " + report.overflow.join(", "));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
