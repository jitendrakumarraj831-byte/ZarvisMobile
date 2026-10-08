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
  // ONLY="text" runs just the steps whose name contains it (a step that needs an earlier one will fail on its own).
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
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
  page.expectConsole = [];
  page.on("pageerror", (err) => sink.push("pageerror: " + err.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (/Failed to load resource: the server responded with a status of [45]\d\d/.test(msg.text()) && page.expectRejections > 0) {
      page.expectRejections -= 1;
      return;
    }
    if (page.expectConsole.some((re) => re.test(msg.text()))) return; // the app's own log of a failure the check provoked on purpose
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

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const { page, errors } = await newPage(browser);
  let project = null;

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

  /* ---------- Tasks ---------- */

  let taskId = null;

  await step("a task is recorded as QUEUED and nothing runs until Run is pressed", async () => {
    await workTab(page, "tasks");
    await page.click("#tasks-new-btn");
    await fillDialog(page, { Goal: "Prepare the weekly report", "Steps (one per line, optional)": "hello\nsearch and compare the best phones, find results", Project: project.id });
    await page.waitForSelector('#task-list .task-card[data-lifecycle="QUEUED"]');
    const tasks = (await api(page, "/tasks")).body.tasks;
    assert.equal(tasks.length, 1);
    taskId = tasks[0].id;
    assert.equal(tasks[0].lifecycle, "QUEUED");
    assert.equal(tasks[0].progress.done, 0);
    assert.match(await page.locator("#task-list .task-card").innerText(), /Queued/);
  });

  await step("Run executes exactly one step and the card shows the real lifecycle and evidence", async () => {
    await page.click('#task-list .task-card button:has-text("Run first step")');
    await page.waitForSelector('#task-list .task-card[data-lifecycle="WAITING"]', { timeout: 20000 });
    const task = (await api(page, "/tasks/" + taskId)).body;
    assert.equal(task.progress.done, 1);
    assert.equal(task.steps[0].status, "DONE");
    assert.equal(task.steps[1].status, "PENDING");
    const card = await page.locator("#task-list .task-card").innerText();
    assert.match(card, /1 of 2 steps finished/);
    assert.match(card, /Waiting for you/);
    await page.click('#task-list .task-card summary:has-text("Result")');
    const evidence = await page.locator("#task-list .task-card").innerText();
    assert.match(evidence, /What was checked: [\w.]+: completed/, "the step shows what the server actually verified: " + evidence);
    assert.equal(task.steps[0].evidence.check, "tool_results");
  });

  await step("the last step completes the task with tool evidence; it is stored as COMPLETED", async () => {
    await page.click('#task-list .task-card button:has-text("Run next step")');
    await page.waitForSelector('#task-list .task-card[data-lifecycle="COMPLETED"]', { timeout: 25000 });
    const task = (await api(page, "/tasks/" + taskId)).body;
    assert.equal(task.progress.done, 2);
    assert.equal(task.lifecycle, "COMPLETED");
    assert.ok(task.result && task.result.summary, "a stored result");
    assert.equal(await page.locator('#task-list .task-card button:has-text("Run")').count(), 0, "no Run button on a finished task");
  });

  await step("a queued task can be cancelled after confirming, and stays cancelled", async () => {
    const created = await post(page, "/tasks", { goal: "Throwaway task" });
    assert.equal(created.status, 201);
    await workTab(page, "tasks");
    await page.click("#tasks-refresh-btn");
    const card = page.locator("#task-list .task-card", { hasText: "Throwaway task" });
    await card.locator('button:has-text("Cancel")').click();
    await page.click("#confirm-modal-confirm");
    await page.waitForSelector('#task-list .task-card[data-lifecycle="CANCELLED"]');
    assert.equal((await api(page, "/tasks/" + created.body.id)).body.lifecycle, "CANCELLED");
  });

  /* ---------- Agents ---------- */

  await step("Agents lists the six agents; each page is built from the real skills", async () => {
    await go(page, "#/agents");
    await page.waitForSelector("#agents-root .ws-agent");
    const names = await page.locator("#agents-root .ws-agent .ws-card-title").allInnerTexts();
    assert.deepEqual(names.map((n) => n.trim()), ["Personal agent", "Research agent", "Documents agent", "Creative agent", "Business agent", "Developer agent"]);
    await page.click('#agents-root .ws-agent button[aria-label="Open the Research agent"]');
    await page.waitForSelector("#agents-root .ws-agent-head");
    const text = await page.locator("#agents-root").innerText();
    for (const heading of ["What it can do", "Required integrations and permissions", "Current work", "Recent results", "Limitations"]) assert.match(text, new RegExp(heading, "i"));
    assert.match(await page.evaluate(() => location.hash), /#\/agents\/research/);
    const real = (await api(page, "/agents/research")).body;
    assert.equal(await page.locator("#agents-root .ws-section").nth(1).locator(".ws-row").count(), real.skills.length);
  });

  await step("Ask Agent opens a chat that is limited to that agent and says so", async () => {
    await page.fill('#agents-root textarea[aria-label^="Ask the Research"]', "search and compare the best phones, find results");
    await page.click('#agents-root button:has-text("Ask")');
    await page.waitForSelector("#view-chat:not([hidden])");
    await page.waitForSelector("#chat-agent-chip:not([hidden])");
    assert.match(await page.locator("#chat-agent-chip").innerText(), /Research/);
    await page.waitForSelector('.exec-card[data-status="COMPLETED"]', { timeout: 20000 });
  });

  await step("an unknown agent address falls back to the Agents list, never a blank page", async () => {
    await go(page, "#/agents/nope");
    await page.waitForSelector("#agents-root .ws-agent");
    assert.equal(await page.locator("#agents-root .ws-agent").count(), 6);
    assert.equal(await page.evaluate(() => location.hash), "#/agents");
    page.expectRejections += 1;
    const direct = await api(page, "/agents/nope");
    assert.equal(direct.status, 404);
  });

  /* ---------- Execution cards in chat: real events only ---------- */

  await step("after a reload the chat shows the stored execution cards from the ledger, with their real result", async () => {
    await page.reload();
    await page.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    await go(page, "#/chat");
    await page.waitForSelector('.exec-card[data-status="COMPLETED"]', { timeout: 15000 });
    await page.locator(".exec-card").first().locator("summary").click();
    const text = await page.locator(".exec-card").first().innerText();
    assert.match(text, /Read from the stored record of this run/);
    assert.match(text, /Web Search/);
  });

  const mocked = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await mocked.addInitScript(() => {
    try { localStorage.setItem("zarvis.welcomeDismissed", "1"); } catch {}
    const realFetch = window.fetch.bind(window);
    const enc = new TextEncoder();
    const CID = "00000000-0000-4000-8000-000000000001";
    const frame = (event, data) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const api = (window.__stream = { controller: null, push: (event, data) => api.controller.enqueue(frame(event, data)), end: () => api.controller.close(), CID });
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (!url.endsWith("/orchestrator/turn-stream")) return realFetch(input, init);
      return Promise.resolve(new Response(new ReadableStream({ start(c) { api.controller = c; } }), { status: 200, headers: { "content-type": "text/event-stream" } }));
    };
  });
  const mp = await mocked.newPage();
  const mockedErrors = [];
  watchErrors(mp, mockedErrors);
  await mp.goto(BASE);
  await mp.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
  const push = (event, data) => mp.evaluate(([e, d]) => window.__stream.push(e, d), [event, data]);
  const stepsOf = (card) => card.locator(".exec-step").evaluateAll((nodes) => nodes.map((n) => n.querySelector(".exec-step-title").textContent + "|" + n.dataset.state));
  const startTurn = async (text) => {
    await mp.evaluate(() => { location.hash = "#/chat"; });
    await mp.fill("#text-input", text);
    await mp.press("#text-input", "Enter");
    await mp.waitForFunction(() => !!window.__stream.controller);
    await push("meta", { conversationId: "00000000-0000-4000-8000-000000000001", turnId: "t" });
  };

  await step("a running tool shows only the stages that have really happened, each worded for its state", async () => {
    await startTurn("search the web for phones");
    await push("progress", { type: "tool_started", skillId: "web.search", skillName: "Web Search", toolCallId: "c1", riskLevel: "LOW", actionClass: "READ_ONLY", inputPreview: { query: "phones" } });
    const card = mp.locator('.exec-card[data-tool-call-id="c1"]');
    await card.waitFor();
    assert.deepEqual(await stepsOf(card), ["Understood the request|done", "Chose a skill|done"]);
    assert.match(await card.locator(".exec-chip").innerText(), /Running/);
    assert.equal(await card.locator(".exec-step", { hasText: /^Result/ }).count(), 0, "no Result stage before there is a result");
    await push("progress", { type: "tool_stage", stage: "permitted", skillId: "web.search", toolCallId: "c1" });
    await push("progress", { type: "tool_stage", stage: "entitled", skillId: "web.search", toolCallId: "c1" });
    await push("progress", { type: "tool_stage", stage: "prepared", skillId: "web.search", toolCallId: "c1", action: "Web Search: query = phones" });
    await push("progress", { type: "tool_stage", stage: "executing", skillId: "web.search", toolCallId: "c1" });
    await mp.waitForFunction(() => document.querySelector('.exec-step[data-state="active"]'));
    const live = await stepsOf(card);
    assert.deepEqual(live.slice(-2), ["Action prepared|done", "Running the skill|active"]);
    assert.equal(live.filter((s) => s.endsWith("|active")).length, 1, "only the stage that is running now is animated");
  });

  await step("when the result arrives every stage is settled: nothing is left 'Running' or 'Checking'", async () => {
    await push("progress", { type: "tool_stage", stage: "verifying", skillId: "web.search", toolCallId: "c1" });
    await push("progress", { type: "tool_finished", skillId: "web.search", toolCallId: "c1", status: "COMPLETED" });
    const toolCalls = [{ toolCallId: "c1", skillId: "web.search", outcome: { kind: "success", result: { output: { query: "phones", answer: "A.", results: [{ title: "Example", url: "https://example.com/a" }] } }, chargedCredits: 1 }, result: { success: true, status: "COMPLETED", userSafeMessage: "Found 1 result.", verificationEvidence: { check: "non_empty_result", outputKeys: ["query", "answer", "results"], chargedCredits: 1 } } }];
    await push("done", { message: "Here is what I found.", toolCalls, conversationId: "00000000-0000-4000-8000-000000000001", turnId: "t" });
    await mp.evaluate(() => window.__stream.end());
    const card = mp.locator('.exec-card[data-tool-call-id="c1"]');
    await mp.waitForSelector('.exec-card[data-status="COMPLETED"]');
    const done = await stepsOf(card);
    assert.deepEqual(done, ["Understood the request|done", "Chose a skill|done", "Permission and plan checked|done", "Action prepared|done", "Ran the skill|done", "Result checked|done", "Result|done"]);
    assert.equal(await card.locator('.exec-step[data-state="active"]').count(), 0);
    assert.match(await card.innerText(), /Live web/);
    assert.ok(!/Running now|Checking what it returned/.test(await card.innerText()), "no stale present-tense notes on a finished card");
  });

  await step("a tool that needs confirmation says nothing was done and offers Confirm / Decline inside the card", async () => {
    await startTurn("create the pull request");
    await push("progress", { type: "tool_started", skillId: "developer.implement", skillName: "Implement Repository Change", toolCallId: "c2", riskLevel: "HIGH", actionClass: "EXTERNAL_COMMUNICATION", inputPreview: { requirement: "add a badge" } });
    await push("progress", { type: "tool_finished", skillId: "developer.implement", toolCallId: "c2", status: "CONFIRMATION_REQUIRED" });
    const confirmation = { id: "00000000-0000-4000-8000-0000000000aa", action: "Create a branch and open a pull request", riskLevel: "HIGH", actionClass: "EXTERNAL_COMMUNICATION", expiresAt: new Date(Date.now() + 600000).toISOString(), skillName: "Implement Repository Change" };
    const toolCalls = [{ toolCallId: "c2", skillId: "developer.implement", outcome: { kind: "confirmation_required", confirmation }, result: { success: false, status: "CONFIRMATION_REQUIRED", userSafeMessage: "Needs your confirmation.", verificationEvidence: null } }];
    await push("done", { message: "I need your confirmation first.", toolCalls, conversationId: "00000000-0000-4000-8000-000000000001", turnId: "t" });
    await mp.evaluate(() => window.__stream.end());
    const card = mp.locator('.exec-card[data-tool-call-id="c2"]');
    await card.locator(".exec-confirm .confirm-card").waitFor();
    assert.match(await card.locator(".exec-chip").innerText(), /Needs your confirmation/);
    const steps = await stepsOf(card);
    assert.ok(steps.includes("Waiting for your confirmation|waiting"), "waiting stage: " + steps.join(", "));
    assert.ok(!steps.some((s) => s.startsWith("Result|done") || s.startsWith("Ran the skill")), "nothing is claimed as done: " + steps.join(", "));
    assert.match(await card.locator(".confirm-card").innerText(), /Nothing has been done yet/);
    assert.equal(await card.locator(".confirm-card button").count(), 2);
  });

  await step("declining a confirmation that is no longer valid says so and removes the buttons (no stuck 'Running…')", async () => {
    mockedErrors.length = 0;
    mp.expectRejections = 1;
    const card = mp.locator('.exec-card[data-tool-call-id="c2"]');
    await card.locator('.confirm-card button:has-text("Decline")').click();
    await card.locator(".confirm-card >> text=expired or was already used").waitFor();
    assert.equal(await card.locator(".confirm-card button").count(), 0);
    assert.equal(await card.locator('.confirm-card button:has-text("Running")').count(), 0);
  });

  await step("a failed tool is shown as failed with its reason, never as a success", async () => {
    await startTurn("search again");
    await push("progress", { type: "tool_started", skillId: "web.search", skillName: "Web Search", toolCallId: "c3", riskLevel: "LOW", actionClass: "READ_ONLY" });
    await push("progress", { type: "tool_stage", stage: "executing", skillId: "web.search", toolCallId: "c3" });
    await push("progress", { type: "tool_finished", skillId: "web.search", toolCallId: "c3", status: "FAILED", summary: "The search provider timed out." });
    const toolCalls = [{ toolCallId: "c3", skillId: "web.search", outcome: { kind: "execution_failed", result: { kind: "failure", reason: "handler_error", userMessage: "x" } }, result: { success: false, status: "FAILED", userSafeMessage: "The search provider timed out.", retryable: true, verificationEvidence: null } }];
    await push("done", { message: "That search didn't work.", toolCalls, conversationId: "00000000-0000-4000-8000-000000000001", turnId: "t" });
    await mp.evaluate(() => window.__stream.end());
    const card = mp.locator('.exec-card[data-tool-call-id="c3"]');
    await mp.waitForSelector('.exec-card[data-tool-call-id="c3"][data-status="FAILED"]');
    const text = await card.innerText();
    assert.match(text, /Couldn't complete/);
    assert.match(text, /The search provider timed out/);
    assert.ok(!/Completed|Result checked/.test(text), "a failure never reads as completed or verified: " + text);
    assert.equal(await card.locator('.exec-step[data-state="active"]').count(), 0, "nothing keeps spinning");
    assert.match(await card.locator(".exec-chip").getAttribute("class"), /z-badge-err/);
  });

  await step("the agent chip releases the agent; the project chip opens the project", async () => {
    await page.evaluate((id) => { location.hash = "#/agents/research"; }, project.id);
    await page.waitForSelector("#agents-root .ws-agent-head");
    await page.fill('#agents-root textarea[aria-label^="Ask the Research"]', "hello there");
    await page.click('#agents-root button:has-text("Ask")');
    await page.waitForSelector("#chat-agent-chip:not([hidden])");
    await page.click("#chat-agent-chip");
    await page.waitForSelector("#chat-agent-chip", { state: "hidden" });
    await go(page, "#/work/project-" + project.id);
    await page.click('.ws-continue-foot button:has-text("New chat in this project")');
    await page.waitForSelector("#chat-project-chip:not([hidden])");
    await page.click("#chat-project-chip");
    await page.waitForSelector(".ws-project-head .ws-h2 >> text=Website relaunch");
  });

  /* ---------- Developer: pull request and the evidence for its tests ---------- */

  const prCard = async (id, number, repoUrl) => {
    await startTurn("open a pull request " + id);
    await push("progress", { type: "tool_started", skillId: "developer.implement", skillName: "Implement Repository Change", toolCallId: id, riskLevel: "HIGH", actionClass: "EXTERNAL_COMMUNICATION", inputPreview: { repoUrl } });
    await push("progress", { type: "tool_finished", skillId: "developer.implement", toolCallId: id, status: "COMPLETED" });
    const output = { pullRequest: { number, url: `https://github.com/acme/demo/pull/${number}` }, branch: "zarvis/agent-stub", files: ["README.md", "docs/badge.md"], suggestedTests: ["npm test"] };
    const toolCalls = [{ toolCallId: id, skillId: "developer.implement", outcome: { kind: "success", result: { output }, chargedCredits: 10 }, result: { success: true, status: "COMPLETED", userSafeMessage: "Opened a pull request.", verificationEvidence: { check: "non_empty_result", outputKeys: ["pullRequest", "branch", "files"], chargedCredits: 10 } } }];
    await push("done", { message: "Opened pull request " + number + ".", toolCalls, conversationId: "00000000-0000-4000-8000-000000000001", turnId: "t" });
    await mp.evaluate(() => window.__stream.end());
    const card = mp.locator(`.exec-card[data-tool-call-id="${id}"]`);
    await card.waitFor();
    await mp.waitForSelector(`.exec-card[data-tool-call-id="${id}"][data-status="COMPLETED"]`);
    return card;
  };

  await step("a pull request card lists its files and says ZARVIS runs no tests; CI evidence is read from GitHub, passes and failures both shown", async () => {
    const card = await prCard("pr1", 1, "https://github.com/acme/demo");
    const text = await card.innerText();
    assert.match(text, /README\.md/);
    assert.match(text, /ZARVIS did not run them/, "suggested checks are labelled as not run");
    assert.match(text, /ZARVIS runs none/);
    assert.ok(!/tests? passed/i.test(text), "no test result is claimed before GitHub reports one");
    await card.locator('button:has-text("Check CI results on GitHub")').click();
    await card.locator(".exec-checks").waitFor();
    assert.match(await card.locator(".exec-ci-head").innerText(), /pull request #1/);
    assert.match(await card.locator(".exec-ci-head").innerText(), /1 passed · 1 failed · 0 pending/);
    assert.equal(await card.locator('.exec-checks li[data-state="pass"]').count(), 1);
    assert.equal(await card.locator('.exec-checks li[data-state="fail"]').count(), 1);
    assert.match(await card.locator(".exec-checks").innerText(), /unit tests[\s\S]*lint/);
  });

  await step("a pull request with no CI says there is no test result at all", async () => {
    const card = await prCard("pr2", 2, "https://github.com/acme/demo");
    await card.locator('button:has-text("Check CI results on GitHub")').click();
    await card.locator(".exec-ci >> text=no checks").waitFor();
    const text = await card.locator(".exec-ci").innerText();
    assert.match(text, /ZARVIS has not run any tests, so there is no test result to show/);
    assert.equal(await card.locator(".exec-checks").count(), 0);
  });

  await step("the PR status endpoint refuses a repository URL that is not GitHub and a bad number", async () => {
    page.expectRejections += 2;
    const notGithub = await api(page, "/developer/pr-status?repoUrl=" + encodeURIComponent("https://evil.example/acme/demo") + "&number=1");
    assert.equal(notGithub.status, 400);
    const badNumber = await api(page, "/developer/pr-status?repoUrl=" + encodeURIComponent("https://github.com/acme/demo") + "&number=abc");
    assert.equal(badNumber.status, 400);
  });

  /* ---------- Composer: files ---------- */

  const dropFile = (p, name, type, body) => p.evaluate(([n, t, b]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([b], n, { type: t }));
    document.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [name, type, body]);

  await step("composer: a failed PDF read says why and offers Retry; Retry reads it once more; a drop during the read is refused, not queued", async () => {
    await go(page, "#/chat");
    await page.waitForSelector("#view-chat:not([hidden])");
    page.expectRejections += 1;
    page.expectConsole.push(/File reading failed \(503\)/);
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route("**/api/v1/documents/extract", async (route) => {
      calls += 1;
      if (calls === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "upload_unavailable" }) });
      await gate;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Extracted text of the PDF." }) });
    });
    await page.setInputFiles("#file-input", { name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 fake") });
    await page.locator(".bubble.system .bubble-retry-btn").last().waitFor();
    assert.equal(await page.locator("#attachment-chip").isVisible(), false, "a failed read leaves no attachment behind");
    await page.locator(".bubble.system .bubble-retry-btn").last().click();
    await page.waitForSelector("#attachment-chip.is-loading");
    assert.match(await page.locator("#attachment-status").innerText(), /Reading|Extracting|Analy/i);
    await dropFile(page, "second.pdf", "application/pdf", "%PDF-1.4 other");
    await page.waitForSelector(".toast >> text=Still reading");
    assert.equal(calls, 2, "no second read was started while the first was running");
    release();
    await page.waitForSelector("#attachment-chip:not(.is-loading):not([hidden])");
    assert.match(await page.locator("#attachment-name").innerText(), /report\.pdf/);
    assert.equal(calls, 2);
    await page.unroute("**/api/v1/documents/extract");
    await page.click("#attachment-remove");
    await page.waitForSelector("#attachment-chip", { state: "hidden" });
  });

  await step("composer: pasting a file (with no text) and dropping a file each attach it once", async () => {
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["hello pasted"], "pasted.txt", { type: "text/plain" }));
      document.getElementById("text-input").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForSelector("#attachment-chip:not([hidden])");
    assert.match(await page.locator("#attachment-name").innerText(), /pasted\.txt/);
    await page.click("#attachment-remove");
    await dropFile(page, "dropped.txt", "text/plain", "hello dropped");
    await page.waitForSelector("#attachment-chip:not([hidden])");
    assert.match(await page.locator("#attachment-name").innerText(), /dropped\.txt/);
    assert.equal(await page.locator("#drop-overlay").isVisible(), false, "the drop overlay is gone");
    await page.click("#attachment-remove");
  });

  await step("composer: an unsupported or empty file is explained and attaches nothing", async () => {
    await page.setInputFiles("#file-input", { name: "tool.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await page.waitForSelector(".bubble.system >> text=can analyze");
    assert.equal(await page.locator("#attachment-chip").isVisible(), false);
    await page.setInputFiles("#file-input", { name: "empty.txt", mimeType: "text/plain", buffer: Buffer.from("   \n") });
    await page.waitForSelector(".bubble.system >> text=looks empty");
    assert.equal(await page.locator("#attachment-chip").isVisible(), false);
  });

  /* ---------- Activity ---------- */

  await step("Activity merges real tool runs, tasks, files, notes, chats and projects; filters narrow it", async () => {
    await go(page, "#/activity");
    await page.waitForSelector("#activity-list .timeline-item, #activity-feed .timeline-item");
    const types = await page.evaluate(() => [...document.querySelectorAll("#view-activity .timeline-item .timeline-meta span:first-child")].map((n) => n.textContent.trim()));
    for (const t of ["Tool", "Task", "File", "Note", "Chat", "Project"]) assert.ok(types.includes(t), "activity has a " + t + " entry: " + types.join(","));
    await page.click('#activity-filters button:has-text("Tools")');
    const filtered = await page.evaluate(() => [...document.querySelectorAll("#view-activity .timeline-item .timeline-meta span:first-child")].map((n) => n.textContent.trim()));
    assert.ok(filtered.length > 0 && filtered.every((t) => t === "Tool"), "only tool runs after the Tools filter: " + filtered.join(","));
  });

  /* ---------- Memory ---------- */

  const openMemory = async () => {
    await go(page, "#/settings");
    const back = page.locator("[data-settings-back]:visible");
    if (await back.count()) await back.first().click();
    await page.click('[data-settings-page="memory"]');
    await page.waitForSelector("#memory-root .panel");
  };

  await step("Memory: only what the user saves; it can be paused, edited, deleted and switched off", async () => {
    await openMemory();
    assert.match(await page.locator("#memory-root").innerText(), /Nothing saved/);
    await page.click('#memory-root button:has-text("Add memory")');
    await fillDialog(page, { "What should ZARVIS remember about you?": "I prefer short answers" });
    await page.waitForSelector("#memory-root .ws-note >> text=I prefer short answers");
    let mem = (await api(page, "/memory")).body;
    assert.equal(mem.personal.length, 1);
    assert.equal(mem.personal[0].enabled, true);
    await page.click('#memory-root .ws-note button:has-text("Pause")');
    await page.waitForSelector("#memory-root .ws-note.is-paused");
    mem = (await api(page, "/memory")).body;
    assert.equal(mem.personal[0].enabled, false);
    await page.click('#memory-root .ws-note button:has-text("Use again")');
    await page.waitForSelector("#memory-root .ws-note:not(.is-paused)");
    await page.click('#memory-root .control-row button.switch');
    await page.waitForFunction(() => document.querySelector('#memory-root .control-row button.switch').getAttribute("aria-pressed") === "false");
    assert.equal((await api(page, "/memory")).body.enabled, false);
    await page.click('#memory-root .control-row button.switch');
    await page.waitForFunction(() => document.querySelector('#memory-root .control-row button.switch').getAttribute("aria-pressed") === "true");
    await page.click('#memory-root .ws-note button[aria-label^="Delete"]');
    await page.click("#confirm-modal-confirm");
    await page.waitForSelector("#memory-root .empty-state >> text=Nothing saved");
    assert.equal((await api(page, "/memory")).body.personal.length, 0);
  });

  /* ---------- Plans & Usage ---------- */

  await step("Plans & Usage shows real usage read from the server, not placeholder numbers", async () => {
    await go(page, "#/plans");
    await page.waitForSelector("#usage-panel");
    const summary = (await api(page, "/usage/summary")).body;
    assert.ok(summary && typeof summary.runs === "number" && summary.runs >= 1, "usage summary: " + JSON.stringify(summary).slice(0, 120));
    const text = await page.locator("#usage-panel").innerText();
    assert.ok(!/\bnull\b|NaN|undefined/.test(text), "no broken values: " + text.slice(0, 200));
  });

  /* ---------- Navigation, offline and a stalled server ---------- */

  await step("navigation: tabs are history entries, a reload keeps the tab, and a link to a deleted project says it is gone", async () => {
    await go(page, "#/work/files");
    await page.waitForSelector('#work-tab-files[aria-selected="true"]');
    await page.click("#work-tab-research");
    await page.waitForSelector('#work-tab-research[aria-selected="true"]');
    assert.equal(await page.evaluate(() => location.hash), "#/work/research");
    await page.goBack();
    await page.waitForSelector('#work-tab-files[aria-selected="true"]');
    await page.goForward();
    await page.waitForSelector('#work-tab-research[aria-selected="true"]');
    await page.reload();
    await page.waitForSelector('#work-tab-research[aria-selected="true"]');
    assert.equal(await page.locator("#work-panel-research").isVisible(), true, "the reloaded tab shows its panel");
    const gone = await post(page, "/projects", { name: "Short lived" });
    assert.equal(gone.status, 201);
    assert.equal((await api(page, "/projects/" + gone.body.id, { method: "DELETE" })).status, 204);
    page.expectRejections += 1;
    await go(page, "#/work/project-" + gone.body.id);
    await page.waitForSelector("#work-panel-projects .empty-state >> text=no longer exists");
    page.expectRejections += 1;
    await go(page, "#/work/project-zzzz");
    await page.waitForSelector("#work-panel-projects .empty-state >> text=no longer exists");
  });

  await step("offline: a Work page says it can't reach ZARVIS, offers Try again, and loads once the connection is back", async () => {
    await go(page, "#/work/outputs");
    await page.waitForSelector('#work-tab-outputs[aria-selected="true"]');
    page.expectConsole.push(/ERR_INTERNET_DISCONNECTED|Failed to load resource/);
    await page.context().setOffline(true);
    await page.click("#work-tab-files");
    await page.waitForSelector("#files-list .ws-error");
    assert.match(await page.locator("#files-list .ws-error").innerText(), /Couldn't reach ZARVIS/);
    assert.equal(await page.locator("#files-list .ws-error").getAttribute("role"), "alert");
    await page.context().setOffline(false);
    await page.click('#files-list .ws-error button:has-text("Try again")');
    await page.waitForSelector("#files-list .file-row");
    assert.equal(await page.locator("#files-list .ws-error").count(), 0);
  });

  await step("a server that never answers: after 25 seconds the page stops waiting and offers Try again", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("zarvis.welcomeDismissed", "1"); } catch {} });
    const slow = await ctx.newPage();
    await slow.goto(BASE);
    await slow.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    await slow.clock.install();
    await slow.route("**/api/v1/projects**", () => {}); // the request is held open and never answered
    await slow.evaluate(() => { location.hash = "#/work/projects"; });
    await slow.waitForSelector("#work-panel-projects .ws-skeleton");
    await slow.clock.fastForward(26000);
    await slow.waitForSelector("#work-panel-projects .ws-error");
    assert.match(await slow.locator("#work-panel-projects .ws-error").innerText(), /took too long/);
    assert.equal(await slow.locator("#work-panel-projects .ws-skeleton").count(), 0, "no loading skeleton is left behind");
    await slow.unroute("**/api/v1/projects**");
    await slow.click('#work-panel-projects .ws-error button:has-text("Try again")');
    await slow.waitForSelector("#work-panel-projects .empty-state >> text=No active projects");
    await ctx.close();
  });

  /* ---------- Dialogs: keyboard and focus ---------- */

  await step("dialogs: the form dialog takes focus, keeps Tab inside, closes on Esc and gives focus back; the page behind is inert", async () => {
    await workTab(page, "projects");
    await page.waitForSelector('#work-panel-projects .section-head button:has-text("New project")');
    const opener = page.locator('#work-panel-projects .section-head button:has-text("New project")');
    await opener.focus();
    await opener.press("Enter");
    await page.waitForSelector("#form-modal:not([hidden])");
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "form-field-0", "focus moves to the first field");
    assert.equal(await page.evaluate(() => document.querySelector(".app").hasAttribute("inert")), true, "the page behind cannot be reached");
    const inside = () => page.evaluate(() => !!document.activeElement && document.getElementById("form-modal").contains(document.activeElement));
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      assert.equal(await inside(), true, "Tab stays in the dialog (press " + (i + 1) + ")");
    }
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Shift+Tab");
      assert.equal(await inside(), true, "Shift+Tab stays in the dialog (press " + (i + 1) + ")");
    }
    // An empty required field is explained, and focus goes to it.
    await page.click("#form-modal-submit");
    assert.match(await page.locator("#form-modal-error").innerText(), /Name is required/);
    assert.equal(await page.evaluate(() => document.activeElement.id), "form-field-0");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#form-modal", { state: "hidden" });
    assert.equal(await page.evaluate(() => document.querySelector(".app").hasAttribute("inert")), false);
    assert.match(await page.evaluate(() => document.activeElement.textContent), /New project/, "focus returns to the button that opened it");
  });

  await step("dialogs: a confirmation (delete) is an alert dialog that Esc dismisses without deleting", async () => {
    await go(page, "#/work/project-" + project.id);
    await page.waitForSelector(".ws-project-head");
    await page.click('.ws-project-head button:has-text("Delete")');
    await page.waitForSelector("#confirm-modal:not([hidden])");
    assert.equal(await page.locator("#confirm-modal [role=alertdialog]").count(), 1);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#confirm-modal", { state: "hidden" });
    assert.equal((await api(page, "/projects/" + project.id)).status, 200, "the project is still there");
  });

  /* ---------- Security: user text is text ---------- */

  await step("security: markup in a project name, note, file name, task goal and chat is shown as text and never runs", async () => {
    const html = '<img src=x onerror="window.__xss=1"><b>bold</b>';
    const created = await post(page, "/projects", { name: html, goal: html, description: html });
    assert.equal(created.status, 201);
    const pid = created.body.id;
    await post(page, "/notes", { kind: "decision", content: html, projectId: pid });
    await post(page, "/notes", { kind: "memory", content: html });
    await post(page, "/files/text", { name: html + ".txt", text: html, projectId: pid });
    await post(page, "/tasks", { goal: html, projectId: pid });
    const routes = ["#/work/projects", "#/work/project-" + pid, "#/work/files", "#/work/tasks", "#/work/outputs", "#/activity", "#/settings/memory", "#/home"];
    for (const hash of routes) {
      await go(page, hash);
      await page.waitForTimeout(700);
      if (hash.includes("project-")) {
        for (const tab of ["chats", "files", "research", "tasks", "decisions", "memory", "activity"]) {
          await page.evaluate((t) => document.getElementById("project-tab-" + t)?.click(), tab);
          await page.waitForTimeout(200);
        }
      }
    }
    await page.click("#project-tab-decisions").catch(() => {});
    assert.equal(await page.evaluate(() => window.__xss), undefined, "no handler from stored text ran");
    assert.equal(await page.locator('img[src="x"]').count(), 0, "no element was created from stored text");
    await go(page, "#/work/files");
    await page.waitForSelector("#files-list .file-row");
    assert.match(await page.locator("#files-list").innerText(), /<img src=x onerror="window\.__xss=1"><b>bold<\/b>\.txt/, "the file name is shown literally");
    await api(page, "/projects/" + pid, { method: "DELETE" });
  });

  /* ---------- Report ---------- */

  const failed = results.filter(([status]) => status === "FAIL");
  errors.push(...mockedErrors);
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
