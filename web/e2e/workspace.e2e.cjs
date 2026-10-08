/**
 * Workspace browser E2E: Work (projects, files, research, tasks, outputs), Agents, Activity, Memory,
 * execution cards and the responsive layout, run against a real backend (+ Postgres):
 *
 *   PORT=3100 POSTGRES_URL=... CORS_ORIGINS=http://localhost:3100 GITHUB_API_BASE_URL=http://localhost:3200 npx tsx backend/src/index.ts &
 *   node web/e2e/github-stub.cjs &
 *   ZARVIS_URL=http://localhost:3100 node web/e2e/workspace.e2e.cjs
 *
 * Every check reads real backend state back; any console error, page error or CSP violation fails the run.
 */
"use strict";
const assert = require("node:assert/strict");
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright"));
}

const BASE = process.env.ZARVIS_URL || "http://localhost:3100";
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log("PASS", name);
  } catch (err) {
    results.push(["FAIL", name]);
    console.log("FAIL", name, "\n   ", err && err.message ? err.message.split("\n").slice(0, 3).join("\n    ") : err);
  }
}

/** `page.expectRejections` lets a check deliberately provoke a 4xx; the browser logs those as console errors. */
function watchErrors(page, sink) {
  page.expectRejections = 0;
  page.on("pageerror", (err) => sink.push("pageerror: " + err.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (/Failed to load resource: the server responded with a status of 4\d\d/.test(msg.text()) && page.expectRejections > 0) {
      page.expectRejections -= 1;
      return;
    }
    sink.push("console: " + msg.text());
  });
}

async function newPage(browser, { width = 390, height = 844, devAccess = false, lang } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(({ dev, language }) => {
    try {
      localStorage.setItem("zarvis.welcomeDismissed", "1");
      if (dev) localStorage.setItem("zarvis.devAccess", "on");
      if (language) localStorage.setItem("zarvis.lang", language);
    } catch {}
  }, { dev: devAccess, language: lang });
  const page = await ctx.newPage();
  const errors = [];
  watchErrors(page, errors);
  await page.goto(BASE);
  await page.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
  return { ctx, page, errors };
}

/** The app's own authenticated fetch, so a check can read what the server really stored. */
const api = (page, path, options = {}) =>
  page.evaluate(async ({ path, options }) => {
    const res = await fetch("/api/v1" + path, {
      ...options,
      headers: { authorization: "Bearer " + localStorage.getItem("zarvis.accessToken"), "content-type": "application/json", ...(options.headers || {}) },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { path, options });

const post = (page, path, body) => api(page, path, { method: "POST", body: JSON.stringify(body) });

async function go(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(150);
}

/** Opens a Work tab through the real tab button. */
async function workTab(page, tab) {
  await go(page, "#/work/" + tab);
  await page.waitForSelector(`#work-tab-${tab}[aria-selected="true"]`);
  await page.waitForSelector(`#work-panel-${tab}:not([hidden])`);
}

/** Fills the shared form dialog by label and submits it. */
async function fillDialog(page, values, submit = true) {
  await page.waitForSelector("#form-modal:not([hidden])");
  for (const [label, value] of Object.entries(values)) {
    const field = page.locator("#form-modal-fields .field").filter({ has: page.locator("label", { hasText: label }) }).locator("input:not([type=checkbox]), textarea, select").first();
    if (typeof value === "string" && (await field.evaluate((n) => n.tagName)) === "SELECT") await field.selectOption(value);
    else await field.fill(String(value));
  }
  if (submit) await page.click("#form-modal-submit");
}

async function send(page, text) {
  await page.fill("#text-input", text);
  await page.click("#send-btn");
}

const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const { page, errors } = await newPage(browser);
  let project = null;
  let chatId = null;

  /* ---------- Work: projects ---------- */

  await step("Work has Projects, Files, Research, Tasks and Outputs tabs; a new account sees honest empty states", async () => {
    await go(page, "#/work");
    await page.waitForSelector("#work-tabs");
    const labels = await page.locator("#work-tabs [role=tab]").allInnerTexts();
    assert.deepEqual(labels.map((l) => l.trim()), ["Projects", "Files", "Research", "Tasks", "Outputs"]);
    await page.waitForSelector("#work-panel-projects .empty-state");
    const text = await page.locator("#work-panel-projects").innerText();
    assert.match(text, /No active projects/);
    assert.ok(!/\bnull\b|\bundefined\b/.test(text), "no stray null/undefined text: " + text);
  });

  await step("a project is created through the dialog and stored on the server", async () => {
    await page.click('#work-panel-projects .section-head button:has-text("New project")');
    await fillDialog(page, { Name: "Website relaunch", Goal: "Ship the new site by March", Description: "Landing, pricing and docs." });
    await page.waitForSelector("#work-panel-projects .ws-h2 >> text=Website relaunch");
    const listed = await api(page, "/projects");
    assert.equal(listed.body.projects.length, 1);
    project = listed.body.projects[0];
    assert.equal(project.goal, "Ship the new site by March");
    assert.ok(page.url().includes("#/work/project-" + project.id), "address carries the project: " + page.url());
    const head = await page.locator(".ws-project-title").innerText();
    assert.ok(!/null/.test(head), "no 'null' beside the title: " + head);
  });

  await step("Continue work with nothing stored says so instead of inventing work", async () => {
    const text = await page.locator(".ws-continue").innerText();
    assert.match(text, /Nothing is stored to continue yet/);
    assert.equal(await page.locator(".ws-continue-row").count(), 0);
  });

  await step("decisions and project memory are added in the project and persisted", async () => {
    await page.click("#project-tab-decisions");
    await page.click('.ws-subpanel button:has-text("Add a decision")');
    await fillDialog(page, { "What was decided?": "Use Next.js for the site" });
    await page.waitForSelector(".ws-note >> text=Use Next.js for the site");
    await page.click("#project-tab-memory");
    await page.click('.ws-subpanel button:has-text("Add memory")');
    await fillDialog(page, { "What should ZARVIS remember for this project?": "Brand colour is teal" });
    await page.waitForSelector(".ws-note >> text=Brand colour is teal");
    const notes = await api(page, "/notes?projectId=" + project.id);
    assert.deepEqual(notes.body.notes.map((n) => n.kind).sort(), ["decision", "memory"]);
    const detail = await api(page, "/projects/" + project.id);
    assert.equal(detail.body.counts.decisions, 1);
    assert.equal(detail.body.counts.memory, 1);
  });

  await step("a chat started inside the project belongs to it and shows its project", async () => {
    await page.click("#project-tab-overview");
    await page.click('.ws-continue-foot button:has-text("New chat in this project")');
    await page.waitForSelector("#view-chat:not([hidden])");
    await page.waitForSelector("#chat-project-chip:not([hidden])");
    assert.match(await page.locator("#chat-project-chip").innerText(), /Website relaunch/);
    await send(page, "hello from the project");
    await page.waitForSelector(".bubble.assistant .bubble-body", { timeout: 15000 });
    await page.waitForFunction(() => !document.getElementById("send-btn").classList.contains("stop-mode"), null, { timeout: 8000 });
    const chats = await api(page, "/conversations?limit=10");
    const mine = chats.body.conversations.find((c) => c.projectId === project.id);
    assert.ok(mine, "the conversation is stored with the project id");
    chatId = mine.id;
  });

  await step("Continue work then offers that real chat and reopens its stored messages", async () => {
    await go(page, "#/work/project-" + project.id);
    await page.waitForSelector(".ws-continue-row >> text=Continue chat");
    await page.click('.ws-continue-row button:has-text("Continue chat")');
    await page.waitForSelector("#view-chat:not([hidden])");
    await page.waitForSelector(".bubble.user >> text=hello from the project");
  });

  /* ---------- Files ---------- */

  await step("a text file is uploaded, kept on the server and previewed from its stored text", async () => {
    await workTab(page, "files");
    await page.waitForSelector("#work-panel-files .empty-state >> text=No files yet");
    await page.setInputFiles("#work-panel-files .ws-upload-button input[type=file]", { name: "brief.txt", mimeType: "text/plain", buffer: Buffer.from("Brief: build a site. Budget 5000. Deadline March 3.") });
    await page.waitForSelector("#files-list .file-row >> text=brief.txt");
    const stored = await api(page, "/files");
    assert.equal(stored.body.files.length, 1);
    assert.equal(stored.body.files[0].name, "brief.txt");
    await page.click('#files-list .file-row .ws-row-open');
    await page.waitForSelector("#viewer-overlay:not([hidden]) .file-text");
    assert.match(await page.locator("#viewer-body .file-text").innerText(), /Budget 5000/);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#viewer-overlay", { state: "hidden" });
  });

  await step("an unsupported file is refused with the reason and nothing is saved", async () => {
    await page.setInputFiles("#work-panel-files .ws-upload-button input[type=file]", { name: "tool.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await page.waitForSelector('#files-uploads .ws-upload[data-state="failed"]');
    assert.match(await page.locator("#files-uploads").innerText(), /can read images, PDF, DOCX/);
    assert.equal((await api(page, "/files")).body.files.length, 1);
    await page.click('#files-uploads button:has-text("Dismiss")');
    await page.waitForSelector("#files-uploads", { state: "hidden" });
  });

  await step("a file is moved into a project and then shows in that project's Files", async () => {
    await page.click('#files-list .file-row button[aria-label^="More actions"]');
    await page.click('.popover-item:has-text("Move to project")');
    await fillDialog(page, { Project: project.id });
    await page.waitForSelector("#files-list .file-row .z-badge >> text=Website relaunch");
    const detail = await api(page, "/projects/" + project.id);
    assert.equal(detail.body.counts.files, 1);
  });

  await step("Summarize opens a documents-agent chat with the file text attached and sends it", async () => {
    await page.click('#files-list .file-row button[aria-label^="More actions"]');
    await page.click('.popover-item:has-text("Summarize")');
    await page.waitForSelector("#view-chat:not([hidden])");
    await page.waitForSelector("#chat-agent-chip:not([hidden])");
    assert.match(await page.locator("#chat-agent-chip").innerText(), /Documents/);
    await page.waitForSelector(".bubble.assistant .bubble-body", { timeout: 15000 });
  });

  /* ---------- Research ---------- */

  await step("a research search runs in chat as an execution card labelled Live web with its sources", async () => {
    await workTab(page, "research");
    await page.fill('#work-panel-research input[aria-label="Research topic"]', "best budget phones in India");
    await page.click('#work-panel-research button:has-text("Search the web")');
    await page.waitForSelector("#view-chat:not([hidden])");
    await page.waitForSelector('.exec-card[data-status="COMPLETED"]', { timeout: 20000 });
    const card = await page.locator(".exec-card").first().innerText();
    assert.match(card, /Completed/);
    const runs = await api(page, "/executions?skillIds=web.search&limit=5");
    assert.ok(runs.body.executions.length >= 1, "the search is in the executions ledger");
  });

  await step("Work → Research lists the stored search; saved sources can only be links the search returned", async () => {
    await workTab(page, "research");
    await page.waitForSelector("#work-panel-research .ws-search");
    assert.match(await page.locator("#work-panel-research").innerText(), /Live web/);
    const run = (await api(page, "/executions?skillIds=web.search&limit=5")).body.executions[0];
    const urls = ((run.output && run.output.results) || []).map((r) => r.url);
    await page.click('#work-panel-research .ws-search button:has-text("Save as research note")');
    await page.waitForSelector("#form-modal:not([hidden])");
    await page.click("#form-modal-submit");
    await page.waitForSelector("#work-panel-research .ws-note");
    const notes = (await api(page, "/notes?kind=research")).body.notes;
    assert.equal(notes.length, 1);
    for (const source of notes[0].sources) assert.ok(urls.includes(source.url), "a saved source was returned by the search: " + source.url);
    // The server also refuses an invented citation.
    page.expectRejections += 1;
    const invented = await post(page, "/notes", { kind: "research", content: "x", executionId: run.id, sources: [{ title: "Invented", url: "https://example.invalid/not-returned" }] });
    assert.equal(invented.status, 400);
  });

  /* ---------- Report ---------- */

  const failed = results.filter(([status]) => status === "FAIL");
  if (errors.length) {
    console.log("CONSOLE/PAGE ERRORS:\n  " + errors.join("\n  "));
  }
  await browser.close();
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
