/**
 * Web quality suite, run against a real backend (+ Postgres), in Chromium:
 *
 *   PORT=3100 POSTGRES_URL=... npx tsx backend/src/index.ts &
 *   ZARVIS_URL=http://localhost:3100 node web/e2e/quality.e2e.cjs
 *
 * Needs Playwright (+ Chromium) and axe-core (resolved like Playwright: local, then global).
 * Covers what earlier reports checked with uncommitted scripts: responsive layout, accessibility
 * (axe), keyboard use, the service-worker offline shell, voice input / spoken replies never
 * causing an extra turn, and the duplicate-submission cases (double click, slow reply, reload).
 */
"use strict";
const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");

function load(name) {
  try {
    return require(name);
  } catch {
    return require(execSync("npm root -g").toString().trim() + "/" + name);
  }
}
const { chromium } = load("playwright");
const AXE_SOURCE = require("node:fs").readFileSync(
  (() => {
    try {
      return require.resolve("axe-core/axe.min.js");
    } catch {
      return execSync("npm root -g").toString().trim() + "/axe-core/axe.min.js";
    }
  })(),
  "utf8",
);

const BASE = process.env.ZARVIS_URL || "http://localhost:3100";
const VIEWS = ["home", "chat", "work", "agents", "activity", "developer", "metrics", "plans", "settings"];
const WIDTHS = [320, 360, 390, 412, 768, 1024, 1280, 1440, 1920];
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log("PASS", name);
  } catch (err) {
    results.push(["FAIL", name]);
    console.log("FAIL", name, "\n   ", err && err.message ? err.message.split("\n").slice(0, 14).join("\n    ") : err);
  }
}

/** Opens a view through its own nav button (hidden menus on narrow screens included); a page with no nav button (Capabilities) opens by its address. */
async function openView(page, view) {
  await page.evaluate((v) => {
    const button = document.querySelector(`[data-view="${v}"]`);
    if (button) button.click();
    else location.hash = "#/" + v;
  }, view);
  await page.waitForTimeout(150);
}

/** Puts one project, file, decision, memory and task on the account so the Work pages are measured with real rows. Returns the project id. */
async function seedWorkspace(page) {
  return page.evaluate(async () => {
    const call = (path, body) => fetch("/api/v1" + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") }, body: JSON.stringify(body) }).then((r) => r.json());
    const project = await call("/projects", { name: "Website relaunch with a deliberately long project name to test wrapping", goal: "Ship the new marketing site by the end of the quarter", description: "Landing page, pricing and docs.", agentId: "research" });
    await call("/notes", { kind: "decision", content: "Use Next.js for the site", projectId: project.id });
    await call("/notes", { kind: "memory", content: "Brand colour is teal", projectId: project.id });
    await call("/notes", { kind: "memory", content: "I prefer short answers" });
    await call("/files/text", { name: "a-rather-long-file-name-for-the-quarterly-brief-final-v2.txt", text: "Brief: build a site.", source: "upload", projectId: project.id });
    await call("/tasks", { goal: "Prepare the weekly report", steps: ["Collect the numbers", "Write the summary"], projectId: project.id });
    return project.id;
  });
}

/** The Work, Agents and Memory pages that are not top-level views. */
const workspaceRoutes = (projectId) => ["#/work/projects", "#/work/project-" + projectId, "#/work/files", "#/work/research", "#/work/tasks", "#/work/outputs", "#/agents/research", "#/agents/developer", "#/settings/memory", "#/capabilities"];

async function openRoute(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(700);
}

/** What the page logged and which requests failed, so a timeout below explains itself. */
function watch(page) {
  const seen = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") seen.push(`console.${m.type()}: ${m.text().slice(0, 160)}`); });
  page.on("requestfailed", (r) => seen.push(`request failed: ${r.method()} ${r.url()} ${r.failure()?.errorText ?? ""}`));
  page.on("response", (r) => { if (r.status() >= 400) seen.push(`HTTP ${r.status()}: ${r.url()}`); });
  return seen;
}

async function ready(page) {
  const seen = watch(page);
  await page.goto(BASE);
  try {
    await page.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"), null, { timeout: 15000 });
  } catch {
    const now = await page.evaluate(() => ({ url: location.href, width: innerWidth, text: document.body.innerText.replace(/\s+/g, " ").slice(0, 140) })).catch(() => ({}));
    throw new Error(`no guest session after 15s ${JSON.stringify(now)}; seen: ${seen.slice(-8).join(" | ") || "nothing"}`);
  }
  await page.waitForFunction(() => document.querySelector("#orb")?.dataset.state === "IDLE", null, { timeout: 15000 });
}

const sse = (frames) => frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
const reply = (text, id = "t") => sse([["meta", { conversationId: "00000000-0000-4000-8000-000000000001", turnId: id }], ["delta", { text }], ["done", { message: text, toolCalls: [], conversationId: "00000000-0000-4000-8000-000000000001", turnId: id }]]);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];

  // ---- Responsive -------------------------------------------------------------------------
  await step(`responsive: no horizontal overflow, ${VIEWS.length} views and the Work, Agents and Memory pages × ${WIDTHS.length} widths`, async () => {
    const problems = [];
    // One guest account for every width (the server allows 60 sign-ups an hour per address and all the suites share them):
    // the window is resized in place, the way a phone is turned or a browser window is dragged.
    const ctx = await browser.newContext({ viewport: { width: WIDTHS[0], height: 860 } });
    const page = await pageOf(ctx);
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    try {
      await ready(page);
    } catch (err) {
      await ctx.close();
      throw err;
    }
    const projectId = await seedWorkspace(page);
    const overflowNow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
      await page.waitForTimeout(250);
      for (const view of VIEWS) {
        await openView(page, view);
        const overflow = await overflowNow();
        if (overflow > 1) problems.push(`${view}@${width}px overflows by ${overflow}px`);
      }
      for (const hash of workspaceRoutes(projectId)) {
        await openRoute(page, hash);
        if (hash.includes("project-")) {
          for (const tab of ["overview", "chats", "files", "research", "tasks", "decisions", "memory", "activity"]) {
            await page.evaluate((t) => document.getElementById("project-tab-" + t)?.click(), tab);
            await page.waitForTimeout(150);
            const o = await overflowNow();
            if (o > 1) problems.push(`project/${tab}@${width}px overflows by ${o}px`);
          }
        }
        const overflow = await overflowNow();
        if (overflow > 1) problems.push(`${hash.replace(/project-[\w-]+/, "project")}@${width}px overflows by ${overflow}px`);
      }
    }
    await ctx.close();
    assert.deepEqual(problems, []);
  });

  // ---- Home orb: ripples and sparks are decoration; they must never widen the page or crowd the name ----------
  await step("Home orb: the ripples and sparks stay inside the screen while they move, ZARVIS AI fits inside the orb, and reduced motion keeps still rings", async () => {
    const problems = [];
    // One guest account for all five sizes (the server allows 60 sign-ups an hour per address and both suites share them).
    const ctx = await browser.newContext({ viewport: { width: 320, height: 640 } });
    const page = await pageOf(ctx);
    await ready(page);
    for (const [width, height] of [[320, 640], [360, 740], [390, 844], [412, 915], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(400);
      let widest = 0;
      for (let i = 0; i < 20; i += 1) {
        widest = Math.max(widest, await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
        await page.waitForTimeout(300);
      }
      if (widest > 0) problems.push(`${width}px: the page grew ${widest}px wider than the screen`);
      const m = await page.evaluate(() => {
        const orb = document.querySelector("#home-orb .orb");
        const box = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, overflow: getComputedStyle(document.querySelector(selector)).overflow }; };
        const halo = parseFloat(getComputedStyle(orb, "::before").width);
        return { orb: orb.getBoundingClientRect().width, label: document.querySelector("#home-orb .orb-label strong").getBoundingClientRect().width, halo, waves: box("#home-orb .orb-waves"), sparks: box("#home-orb .orb-sparks"), screen: window.innerWidth };
      });
      if (m.label > m.orb * 0.8) problems.push(`${width}px: "ZARVIS AI" is ${Math.round(m.label)}px wide in a ${Math.round(m.orb)}px orb`);
      for (const [name, b] of [["waves", m.waves], ["sparks", m.sparks]]) {
        if (!["hidden", "clip"].includes(b.overflow)) problems.push(`${width}px: the ${name} layer is not clipped (${b.overflow})`);
        if (b.left < -1 || b.right > m.screen + 1) problems.push(`${width}px: the ${name} layer is outside the screen`);
      }
      if (m.halo * 1.09 > m.screen) problems.push(`${width}px: the glow (${Math.round(m.halo)}px, breathing) is wider than the screen`);
    }
    await ctx.close();
    const still = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const stillPage = await pageOf(still);
    await ready(stillPage);
    const rings = await stillPage.evaluate(() => Array.from(document.querySelectorAll("#home-orb .orb-waves i")).map((n) => [getComputedStyle(n).animationName, getComputedStyle(n).opacity]));
    if (rings.length !== 4 || rings.some(([name, opacity]) => name !== "none" || Number(opacity) < 0.1)) problems.push("reduced motion: the rings are not still and visible: " + JSON.stringify(rings));
    await still.close();
    assert.deepEqual(problems, []);
  });

  // ---- Home: the orb, the message card, the prompts and the mic work at every size ------------------------
  await step("Home: at every screen size nothing is cut off or widens the page, the orb and the card fit, every quick prompt can be reached, and the mic sits in the middle of the tab bar", async () => {
    const problems = [];
    const ctx = await browser.newContext({ viewport: { width: 320, height: 568 } }); // one guest account for every size
    const page = await pageOf(ctx);
    await ready(page);
    for (const [width, height] of [[320, 568], [360, 640], [360, 740], [390, 844], [412, 915], [768, 1024], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(700);
      const m = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - innerWidth;
        const orb = document.querySelector("#home-orb .orb").getBoundingClientRect();
        const card = document.getElementById("home-prompt-form").getBoundingClientRect();
        const title = document.querySelector(".home-title");
        const lines = Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight));
        const tools = [...document.querySelectorAll("#home-prompt-form button")].map((b) => b.getBoundingClientRect());
        const chips = [...document.querySelectorAll("#home-quick .chip:not([hidden])")];
        // Scroll the first prompt to the middle of the screen: whatever is on top at its centre must be the prompt itself.
        chips[0].scrollIntoView({ block: "center", inline: "start" });
        const r = chips[0].getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const fab = document.querySelector(".bottom-nav .nav-fab");
        const fabBox = fab.getBoundingClientRect();
        return {
          overflow, lines, orbInside: orb.left >= 0 && orb.right <= innerWidth, cardInside: card.left >= 0 && card.right <= innerWidth,
          toolsInside: tools.every((t) => t.left >= card.left && t.right <= card.right + 0.5) && tools.every((t) => t.height >= 43.5),
          promptReachable: !!(top && chips[0].contains(top)),
          fabCentred: fab.getClientRects().length === 0 || Math.abs(fabBox.left + fabBox.width / 2 - innerWidth / 2) <= 1,
        };
      });
      if (m.overflow > 0) problems.push(`${width}x${height}: the page is ${m.overflow}px wider than the screen`);
      if (m.lines > 3) problems.push(`${width}x${height}: the headline takes ${m.lines} lines`);
      if (!m.orbInside) problems.push(`${width}x${height}: the orb is not fully on the screen`);
      if (!m.cardInside) problems.push(`${width}x${height}: the message card is cut off`);
      if (!m.toolsInside) problems.push(`${width}x${height}: a message-card button is cut off or under 44px`);
      if (!m.promptReachable) problems.push(`${width}x${height}: the first quick prompt is covered when scrolled to`);
      if (!m.fabCentred) problems.push(`${width}x${height}: the mic is not in the middle of the tab bar`);
    }
    await ctx.close();
    assert.deepEqual(problems, []);
  });

  // ---- Small screens: nothing is cut off at 320px, tap targets reach 44px -----------------------------
  await step("320px phone: no card is cut off, no word breaks mid-way, touch targets are at least 44px", async () => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });
    const page = await pageOf(ctx);
    await ready(page);
    const problems = [];
    await openView(page, "capabilities");
    await page.waitForSelector("#capability-hub .cap-item");
    problems.push(...(await page.evaluate(() => Array.from(document.querySelectorAll("#capability-hub .cap-item")).filter((c) => c.getBoundingClientRect().right > innerWidth - 8 || c.getBoundingClientRect().left < 8).map((c) => "card cut off: " + c.textContent.slice(0, 20)))));
    for (const view of ["plans", "metrics"]) {
      await openView(page, view);
      await page.waitForTimeout(400);
      problems.push(...(await page.evaluate((v) => Array.from(document.querySelectorAll(".stat-tile-value, .stat-tile-label")).filter((n) => n.getClientRects().length).flatMap((n) => {
        // a value that is wider than its tile, or a word that had to be split to fit
        const r = n.getBoundingClientRect(); const tile = n.closest(".stat-tile").getBoundingClientRect();
        const bad = [];
        if (r.right > tile.right + 1) bad.push(v + ": text pokes out of its tile: " + n.textContent);
        const words = n.textContent.trim().split(/\s+/).filter((w) => w.length > 3);
        const range = document.createRange();
        for (const node of n.childNodes) if (node.nodeType === 3) for (const w of words) { const i = node.textContent.indexOf(w); if (i < 0) continue; range.setStart(node, i); range.setEnd(node, i + w.length); if (range.getClientRects().length > 1) bad.push(v + ": word split across lines: " + w); }
        return bad;
      }), view)));
    }
    await openView(page, "settings");
    await page.evaluate(() => document.querySelector('[data-settings-page="voice"]').click());
    await page.waitForTimeout(300);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll(".switch, .topbar-brand, .topbar-menu")).filter((n) => n.getClientRects().length).map((n) => { const r = n.getBoundingClientRect(); const after = getComputedStyle(n, "::after"); const h = r.height + (after.content !== "none" ? parseFloat(after.top) * -2 || 0 : 0); return [n.className, Math.round(r.width), Math.round(h)]; }).filter(([, w, h]) => w < 44 || h < 44));
    for (const [cls, w, h] of small) problems.push(`target ${cls}: ${w}x${h}`);
    await ctx.close();
    assert.deepEqual(problems, []);
  });

  // ---- Accessibility (axe) ----------------------------------------------------------------
  // The app's own appearances (Settings → Appearance), not the OS colour scheme it ignores.
  for (const [width, appearance, lang] of [[412, "aurora", "en"], [1280, "aurora", "en"], [412, "dim", "en"], [1280, "dim", "en"], [412, "dim", "hi"], [1280, "aurora", "hi"]]) {
    await step(`accessibility: no serious/critical axe violation on any view (${width}px, ${appearance}${lang === "hi" ? ", Hindi" : ""})`, async () => {
      // bypassCSP only so the audit script can be injected; the app itself runs unchanged.
      // Reduced motion, and a settle wait: entrance fades would otherwise be measured mid-way.
      const ctx = await browser.newContext({ viewport: { width, height: 860 }, bypassCSP: true, reducedMotion: "reduce" });
      await ctx.addInitScript(([a, l]) => { localStorage.setItem("zarvis.appearance", a); localStorage.setItem("zarvis.lang", l); }, [appearance, lang]);
      const page = await pageOf(ctx);
      await ready(page);
      await page.addScriptTag({ content: AXE_SOURCE });
      const found = [];
      for (const view of VIEWS) {
        await openView(page, view);
        await page.waitForTimeout(900);
        const violations = await page.evaluate(async () => {
          // eslint-disable-next-line no-undef
          const r = await axe.run(document, { resultTypes: ["violations"] });
          return r.violations
            .filter((v) => v.impact === "serious" || v.impact === "critical")
            .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
        });
        for (const v of violations) found.push(`${view}: ${v}`);
      }
      const projectId = await seedWorkspace(page);
      for (const hash of workspaceRoutes(projectId)) {
        await openRoute(page, hash);
        const tabs = hash.includes("project-") ? ["overview", "chats", "files", "research", "tasks", "decisions", "memory", "activity"] : [null];
        for (const tab of tabs) {
          if (tab) {
            await page.evaluate((t) => document.getElementById("project-tab-" + t)?.click(), tab);
            await page.waitForTimeout(300);
          }
          const violations = await page.evaluate(async () => {
            // eslint-disable-next-line no-undef
            const r = await axe.run(document, { resultTypes: ["violations"] });
            return r.violations
              .filter((v) => v.impact === "serious" || v.impact === "critical")
              .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
          });
          for (const v of violations) found.push(`${hash.replace(/project-[\w-]+/, "project")}${tab ? "/" + tab : ""}: ${v}`);
        }
      }
      await ctx.close();
      assert.deepEqual(found, []);
    });
  }

  // The phone menu drawer, open (the sweeps above only see it closed): contrast of the current-page row, names, focus.
  for (const [appearance, lang] of [["aurora", "en"], ["dim", "en"], ["aurora", "hi"], ["dim", "hi"]]) {
    await step(`accessibility: the open phone menu has no serious/critical axe violation (390px, ${appearance}${lang === "hi" ? ", Hindi" : ""})`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, bypassCSP: true, reducedMotion: "reduce" });
      await ctx.addInitScript(([a, l]) => { localStorage.setItem("zarvis.appearance", a); localStorage.setItem("zarvis.lang", l); }, [appearance, lang]);
      const page = await pageOf(ctx);
      await ready(page);
      await page.addScriptTag({ content: AXE_SOURCE });
      await page.click("#menu-btn");
      await page.waitForTimeout(500);
      const violations = await page.evaluate(async () => {
        // eslint-disable-next-line no-undef
        const r = await axe.run(document, { resultTypes: ["violations"] });
        return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      });
      await ctx.close();
      assert.deepEqual(violations, []);
    });
  }

  // Chat with real content: a formatted reply (list, code), an action row, a finished tool and a waiting "Thinking" card.
  // One guest account for all four looks: the server allows 60 sign-ups an hour per address and the suites share them.
  await step("accessibility: Chat with a rich reply, a tool row and Thinking has no serious/critical axe violation (phone and desktop, both themes)", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, bypassCSP: true, reducedMotion: "reduce" });
    const page = await pageOf(ctx);
    await ready(page);
    const CID = "00000000-0000-4000-8000-000000000001";
    const RICH = "Here is **what I found**:\n\n## Summary\n- First point with a [link](https://example.com/docs)\n- Second point with `inline code`\n\n```js\nconst answer = 42;\nconsole.log(answer);\n```\n\n1. One\n2. Two";
    let turn = 0;
    await page.route("**/api/v1/orchestrator/turn-stream", async (route) => {
      turn += 1;
      if (turn % 2 === 0) return; // every second turn never answers, so the Thinking card stays up
      const toolCalls = [{ toolCallId: "tc-" + turn, skillId: "web.search", outcome: { kind: "success", result: { output: { query: "q", answer: "A short answer.", results: [{ title: "Example", url: "https://example.com/a" }] } }, chargedCredits: 1 }, result: { success: true, status: "COMPLETED", userSafeMessage: "Found 5 results.", verificationEvidence: { check: "non_empty_result", outputKeys: ["query", "answer", "results"], chargedCredits: 1 } } }];
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse([["meta", { conversationId: CID, turnId: "a" }], ["delta", { text: RICH }], ["done", { message: RICH, toolCalls, conversationId: CID, turnId: "a" }]]) });
    });
    const found = [];
    for (const [label, viewport, appearance] of [["phone light", { width: 390, height: 860 }, "aurora"], ["phone dark", { width: 390, height: 860 }, "dim"], ["desktop light", { width: 1280, height: 860 }, "aurora"], ["desktop dark", { width: 1280, height: 860 }, "dim"]]) {
      await page.setViewportSize(viewport);
      await page.evaluate((a) => localStorage.setItem("zarvis.appearance", a), appearance);
      await page.reload();
      await page.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
      await page.addScriptTag({ content: AXE_SOURCE });
      await openView(page, "chat");
      await page.fill("#text-input", "Show me something formatted");
      await page.press("#text-input", "Enter");
      await page.waitForSelector(".bubble.assistant .bubble-actions");
      await page.waitForSelector(".exec-card");
      await page.fill("#text-input", "and one more thing");
      await page.press("#text-input", "Enter");
      await page.waitForSelector(".bubble.thinking");
      await page.waitForTimeout(900);
      const violations = await page.evaluate(async () => {
        // eslint-disable-next-line no-undef
        const r = await axe.run(document, { resultTypes: ["violations"] });
        return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      });
      for (const v of violations) found.push(`${label}: ${v}`);
    }
    await ctx.close();
    assert.deepEqual(found, []);
  });

  // ---- Keyboard ---------------------------------------------------------------------------
  await step("keyboard: Tab reaches the composer, focus is visible, Enter sends exactly once", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await pageOf(ctx);
    await ready(page);
    let turns = 0;
    await page.route("**/api/v1/orchestrator/turn-stream", (route) => { turns += 1; return route.fulfill({ status: 200, contentType: "text/event-stream", body: reply("ok") }); });
    await openView(page, "chat");
    let reached = false;
    for (let i = 0; i < 60 && !reached; i += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => document.activeElement?.id === "text-input");
    }
    assert.ok(reached, "Tab never reached the message box");
    // The message box draws no ring of its own; its composer bar shows focus (:focus-within).
    const look = () => page.evaluate(() => { const s = getComputedStyle(document.querySelector("#command-bar")); return s.boxShadow + "|" + s.borderColor; });
    const focused = await look();
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForTimeout(250);
    const blurred = await look();
    assert.notEqual(focused, blurred, "focusing the message box changes nothing visible");
    await page.focus("#text-input");
    await page.keyboard.type("hello by keyboard");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".bubble.assistant .bubble-body >> text=ok", { timeout: 10000 });
    assert.equal(turns, 1);
    await ctx.close();
  });

  await step("keyboard: Enter and Space on the focused attach control open the file picker", async () => {
    // Oracle: the app clicks the file input from the keypress, with user activation (what a
    // browser needs to show the picker). Headless Chromium's own filechooser event was seen to
    // go missing about 1 run in 10 even then, so it is not used.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript(() => {
      window.__fileClicks = [];
      const original = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.type === "file") window.__fileClicks.push(navigator.userActivation ? navigator.userActivation.isActive : true);
        return original.call(this);
      };
    });
    const page = await pageOf(ctx);
    page.on("filechooser", () => {}); // let Playwright absorb the dialog
    await ready(page);
    await openView(page, "chat");
    for (const key of ["Enter", " "]) {
      await page.focus("#upload-btn");
      await page.keyboard.press(key);
    }
    assert.deepEqual(await page.evaluate(() => window.__fileClicks), [true, true]);
    await ctx.close();
  });

  await step("keyboard: every focusable control has an accessible name", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await pageOf(ctx);
    await ready(page);
    const unnamed = [];
    for (const view of VIEWS) {
      await openView(page, view);
      const names = await page.evaluate(() =>
        [...document.querySelectorAll("button, a[href], input, textarea, select, [tabindex]:not([tabindex='-1'])")]
          .filter((e) => e.offsetParent !== null && !e.disabled)
          .filter((e) => {
            const label = e.getAttribute("aria-label") || e.getAttribute("title") || e.textContent.trim() ||
              (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent.trim()) || (e.labels && [...e.labels].map((l) => l.textContent).join(" ").trim()) || e.getAttribute("placeholder") ||
              (e.getAttribute("aria-labelledby") && document.getElementById(e.getAttribute("aria-labelledby"))?.textContent.trim());
            return !label;
          })
          .map((e) => e.outerHTML.slice(0, 80)));
      for (const n of names) unnamed.push(`${view}: ${n}`);
    }
    await ctx.close();
    assert.deepEqual(unnamed, []);
  });

  // ---- Service worker ---------------------------------------------------------------------
  await step("service worker: installs, and the app shell opens offline", async () => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
    const page = await pageOf(ctx);
    await ready(page);
    await page.waitForFunction(async () => !!(await navigator.serviceWorker?.getRegistration())?.active, null, { timeout: 15000 });
    // A load can occasionally start uncontrolled right after activation (measured 1 in 20 in
    // Chromium, even with clients.claim() in the activate waitUntil); the next one is controlled.
    // The property under test is that the worker takes control and serves the shell offline.
    let controlled = false;
    for (let load = 0; load < 3 && !controlled; load += 1) {
      await page.reload();
      controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    }
    assert.ok(controlled, "the service worker never took control of the page");
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector("#text-input", { state: "attached", timeout: 10000 });
    await openView(page, "chat");
    await page.waitForSelector("#text-input", { state: "visible", timeout: 10000 });
    await ctx.setOffline(false);
    await ctx.close();
  });

  // ---- Voice / spoken replies ---------------------------------------------------------------
  await step("voice: one recognition result = one turn; the spoken reply never starts another turn; results while speaking are ignored", async () => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, permissions: ["microphone"] });
    await ctx.addInitScript(() => {
      localStorage.setItem("zarvis.speak", "on");
      class FakeRecognition extends EventTarget {
        start() { window.__recognitionStarts = (window.__recognitionStarts || 0) + 1; window.__recognition = this; }
        stop() { this.dispatchEvent(new Event("end")); }
        abort() { this.stop(); }
      }
      window.SpeechRecognition = FakeRecognition;
      window.webkitSpeechRecognition = FakeRecognition;
      window.__say = (text) => {
        const ev = new Event("result");
        ev.results = [[{ transcript: text }]];
        window.__recognition.dispatchEvent(ev);
        window.__recognition.dispatchEvent(new Event("end"));
      };
    });
    const page = await pageOf(ctx);
    let turns = 0;
    let ttsRequests = 0;
    await page.route("**/api/v1/orchestrator/turn-stream", (route) => { turns += 1; return route.fulfill({ status: 200, contentType: "text/event-stream", body: reply("Namaste. Main ZARVIS hoon. Aapki kya madad karun?") }); });
    // 0.5 s of silence as 24 kHz 16-bit PCM: real audio for the player, no speech in it.
    const pcm = Buffer.alloc(24000);
    await page.route("**/api/v1/tts/**", (route) => { ttsRequests += 1; return route.fulfill({ status: 200, contentType: "audio/pcm", body: pcm }); });
    await ready(page);
    await openView(page, "chat");
    await page.click("#mic-btn");
    await page.waitForFunction(() => window.__recognitionStarts === 1);
    await page.evaluate(() => window.__say("namaste zarvis"));
    await page.waitForSelector(".bubble.assistant", { timeout: 10000 });
    await page.waitForTimeout(4000); // TTS start delay + playback of the reply
    assert.equal(turns, 1, "the voice result produced exactly one turn");
    assert.ok(ttsRequests >= 1, "the voice reply was sent to TTS");
    // The guard itself: a recognition result that arrives while ZARVIS is speaking (its own
    // voice picked up by the mic) must not become a turn.
    await page.evaluate(() => { document.querySelector("#orb").dataset.state = "SPEAKING"; window.__say("namaste zarvis"); });
    await page.waitForTimeout(800);
    assert.equal(turns, 1, "a result while speaking was ignored");
    assert.equal(await page.evaluate(() => window.__recognitionStarts), 1, "the mic never restarted on its own");
    await ctx.close();
  });

  // ---- Duplicate submissions ----------------------------------------------------------------
  await step("double-clicking Send submits one turn", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await pageOf(ctx);
    await ready(page);
    let turns = 0;
    await page.route("**/api/v1/orchestrator/turn-stream", async (route) => { turns += 1; await new Promise((r) => setTimeout(r, 500)); return route.fulfill({ status: 200, contentType: "text/event-stream", body: reply("one") }); });
    await openView(page, "chat");
    await page.fill("#text-input", "search the weather");
    await page.dblclick("#send-btn");
    await page.waitForSelector(".bubble.assistant .bubble-body >> text=one", { timeout: 10000 });
    await page.waitForTimeout(500);
    assert.equal(turns, 1);
    await ctx.close();
  });

  await step("a slow reply: pressing Send again with an empty box sends nothing more", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await pageOf(ctx);
    await ready(page);
    let turns = 0;
    await page.route("**/api/v1/orchestrator/turn-stream", async (route) => { turns += 1; await new Promise((r) => setTimeout(r, 3000)); return route.fulfill({ status: 200, contentType: "text/event-stream", body: reply("slow") }); });
    await openView(page, "chat");
    await page.fill("#text-input", "search something slow");
    await page.press("#text-input", "Enter");
    await page.waitForTimeout(300);
    await page.press("#text-input", "Enter");
    await page.waitForSelector(".bubble.assistant .bubble-body >> text=slow", { timeout: 10000 });
    assert.equal(turns, 1);
    await ctx.close();
  });

  await step("reloading the page mid-turn does not re-send the turn", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await pageOf(ctx);
    await ready(page);
    let turns = 0;
    await page.route("**/api/v1/orchestrator/turn-stream", async (route) => { turns += 1; await new Promise((r) => setTimeout(r, 2000)); return route.fulfill({ status: 200, contentType: "text/event-stream", body: reply("late") }).catch(() => {}); });
    await openView(page, "chat");
    await page.fill("#text-input", "search the news");
    await page.press("#text-input", "Enter");
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#orb")?.dataset.state === "IDLE", null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    assert.equal(turns, 1, "the page sent the turn again after reload");
    await ctx.close();
  });

  await step("no uncaught page errors", async () => {
    assert.deepEqual(errors, []);
  });

  await browser.close();
  const failed = results.filter(([r]) => r === "FAIL").length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

/** Opens a page with the optional Google/email welcome card already dismissed, so tests reach Chat directly. */
async function pageOf(ctx) {
  // Developer access on, so the responsive and axe sweeps still cover the Developer and Metrics pages.
  await ctx.addInitScript(() => {
    try { localStorage.setItem("zarvis.welcomeDismissed", "1"); localStorage.setItem("zarvis.devAccess", "on"); } catch {}
  });
  return ctx.newPage();
}
