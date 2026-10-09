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

  // Markdown in a reply: tables, quotes and coloured code are real elements, stay inside the screen at every width, and copy as plain code.
  await step("Markdown reply: a wide table scrolls inside its own frame (no page overflow at 320-1440), code is coloured and copies as plain text, a quote is a quote", async () => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 800 }, bypassCSP: true, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
    const page = await pageOf(ctx);
    await ready(page);
    const MD = "> Quoted **note**\n\n| Name | A very long column heading that needs room | Third | Fourth |\n|:--|:-:|--:|---|\n| one | some long text that keeps going and going so that the table is wider than a phone | 3 | four |\n\n```ts\nconst total: number = 40 + 2; // sum\nconsole.log(\"<b>\", total);\n```\n\n~~old~~ #### not a heading here";
    await page.route("**/api/v1/orchestrator/turn-stream", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: reply(MD, "md") }));
    await openView(page, "chat");
    await page.fill("#text-input", "markdown please");
    await page.press("#text-input", "Enter");
    await page.waitForSelector(".bubble.assistant .reply-table");
    for (const width of [320, 360, 390, 412, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, wrapInside: (() => { const w = document.querySelector(".reply-table-wrap"); const b = w.closest(".bubble-body").getBoundingClientRect(); return w.getBoundingClientRect().right <= b.right + 1; })() }));
      assert.ok(m.over <= 1, `page overflows by ${m.over}px at ${width}`);
      assert.ok(m.wrapInside, `table frame leaves its bubble at ${width}`);
    }
    await page.setViewportSize({ width: 320, height: 800 });
    const facts = await page.evaluate(() => {
      const wrap = document.querySelector(".reply-table-wrap");
      const code = document.querySelector("pre.reply-code code");
      const color = (el) => getComputedStyle(el).color;
      return {
        scrolls: wrap.scrollWidth > wrap.clientWidth,
        focusable: wrap.tabIndex === 0 && wrap.getAttribute("role") === "region" && !!wrap.getAttribute("aria-label"),
        headers: [...document.querySelectorAll(".reply-table th")].map((t) => t.textContent),
        quote: document.querySelector("blockquote.reply-quote")?.textContent.trim(),
        kw: code.querySelector(".tok-kw")?.textContent, kwColor: code.querySelector(".tok-kw") && color(code.querySelector(".tok-kw")), plainColor: color(code),
        com: code.querySelector(".tok-com")?.textContent,
        codeText: code.textContent,
        injected: !!document.querySelector(".bubble-body b, .bubble-body img"),
        struck: document.querySelector(".bubble-body del")?.textContent,
      };
    });
    assert.ok(facts.scrolls, "a table wider than a phone scrolls inside its frame");
    assert.ok(facts.focusable, "the scrollable table is keyboard reachable and named");
    assert.deepEqual(facts.headers, ["Name", "A very long column heading that needs room", "Third", "Fourth"]);
    assert.equal(facts.quote, "Quoted note");
    assert.equal(facts.kw, "const");
    assert.notEqual(facts.kwColor, facts.plainColor, "keywords are coloured");
    assert.equal(facts.com, "// sum");
    assert.equal(facts.codeText, 'const total: number = 40 + 2; // sum\nconsole.log("<b>", total);');
    assert.equal(facts.injected, false, "HTML in code or text is never turned into elements");
    assert.equal(facts.struck, "old");
    await page.click("pre.reply-code .code-copy");
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), facts.codeText, "Copy puts plain code on the clipboard, not markup");
    await ctx.close();
  });

  // Payments: what the Plans page says follows what the server answered. The gateway is stubbed (no money moves); the
  // app's own /billing/verify and /entitlements/me answers are what each scenario varies.
  await step("Billing: a refused payment is not 'received', an unanswered one says it is unconfirmed and then whether the plan came on, a failed or closed checkout says so", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, bypassCSP: true });
    await ctx.addInitScript(() => {
      window.Razorpay = class { constructor(o) { this.o = o; this.on_ = {}; window.__rzp = this; } on(ev, fn) { this.on_[ev] = fn; } open() {} };
    });
    const page = await pageOf(ctx);
    await ready(page);
    let verify = { status: 200, body: {} };
    let plan = "TRIAL";
    let planChecks = 0;
    const plans = ["monthly", "yearly"].map((period) => ({ key: "pro_" + period, period, amountInr: period === "yearly" ? 4999 : 499, perMonthInr: period === "yearly" ? 417 : 499, credits: period === "yearly" ? 12000 : 1000, savingsPercent: period === "yearly" ? 16 : 0 }));
    await page.route("**/api/v1/billing/plans", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ currency: "INR", paymentsEnabled: true, testMode: true, methods: [], plans, current: { plan, planExpiresAt: null, creditBalance: 50 } }) }));
    await page.route("**/api/v1/billing/orders", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ keyId: "rzp_test_x", orderId: "order_1", amountPaise: 49900, currency: "INR", description: "Pro monthly" }) }));
    await page.route("**/api/v1/billing/verify", (r) => r.fulfill({ status: verify.status, contentType: "application/json", body: JSON.stringify(verify.body) }));
    await page.route("**/api/v1/entitlements/me", (r) => { planChecks += 1; return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ plan, creditBalance: 50, trialExpiresAt: "2030-01-01T00:00:00Z", planExpiresAt: plan === "PRO" ? "2030-02-01T00:00:00Z" : null }) }); });
    await page.clock.install();
    const notice = () => page.evaluate(() => { const b = document.getElementById("plans-payment"); return { hidden: b.hidden, tone: b.dataset.tone, text: b.querySelector("#plans-payment-text").textContent, id: document.getElementById("plans-payment-ref").hidden ? "" : document.getElementById("plans-payment-id").textContent, body: document.body.innerText };});
    const tick = async (ms) => { await page.clock.fastForward(ms); await page.waitForTimeout(250); };
    const pay = async (callback) => {
      await openView(page, "plans");
      await page.waitForSelector(".plan-cta:not([disabled])", { timeout: 8000 }).catch(async (err) => {
        throw new Error("no enabled plan button: " + JSON.stringify(await page.evaluate(() => ({ active: document.body.dataset.activeView, ctas: [...document.querySelectorAll(".plan-cta")].map((b) => b.textContent + (b.disabled ? " (disabled)" : "")), notice: document.getElementById("plans-notice-text")?.textContent, text: document.body.innerText.replace(/\s+/g, " ").slice(0, 200) }))));
      });
      await page.click(".plan-cta:not([disabled])");
      await page.waitForFunction(() => !!window.__rzp);
      await page.evaluate(callback);
      await page.waitForTimeout(300);
    };
    const handler = () => window.__rzp.o.handler({ razorpay_payment_id: "pay_123", razorpay_order_id: "order_1", razorpay_signature: "sig" });

    // 1. The server refuses the signature: an error that says the plan did not change, with the payment id, and no "received".
    verify = { status: 400, body: { error: "The payment signature did not verify.", code: "invalid_signature" } };
    await pay(handler);
    await tick(5200);
    let n = await notice();
    assert.equal(n.tone, "err");
    assert.match(n.text, /couldn't verify this payment, so your plan was not changed/);
    assert.equal(n.id, "pay_123");
    assert.doesNotMatch(n.body, /Payment received|Pro is active/i);

    // 2. The gateway cannot be reached and the plan never comes on: unconfirmed first, then an honest "not active yet".
    verify = { status: 502, body: { error: "gateway", code: "gateway_error" } };
    await pay(handler);
    n = await notice();
    assert.equal(n.tone, "warn");
    assert.match(n.text, /couldn't reach the payment service/);
    assert.doesNotMatch(n.body, /Payment received/i);
    for (let i = 0; i < 6; i += 1) await tick(5100);
    n = await notice();
    assert.equal(n.tone, "warn");
    assert.match(n.text, /plan isn't active yet/);
    assert.equal(n.id, "pay_123");

    // 3. The gateway cannot be reached but the plan comes on (the server heard from Razorpay): it then says Pro is active.
    plan = "TRIAL";
    await pay(handler);
    await tick(5100);
    plan = "PRO";
    await tick(5100);
    n = await notice();
    assert.equal(n.tone, "ok");
    assert.match(n.text, /^Pro is active until/);

    // 4. The bank has not captured yet (402): says so, and waits.
    plan = "TRIAL";
    verify = { status: 402, body: { error: "The payment has not completed.", code: "payment_not_captured" } };
    await pay(handler);
    n = await notice();
    assert.match(n.text, /bank hasn't confirmed/);

    // 5. A verified payment.
    plan = "PRO";
    verify = { status: 200, body: { plan: "PRO", planExpiresAt: "2030-02-01T00:00:00Z" } };
    await pay(handler);
    n = await notice();
    assert.equal(n.tone, "ok");
    assert.match(n.text, /^Pro is active until/);

    // 6. The gateway reports a failed payment: it says the plan was not changed (it cannot know about the bank), and a closed checkout is not a payment.
    plan = "TRIAL";
    await pay(() => window.__rzp.on_["payment.failed"]({ error: { description: "Card declined", metadata: { payment_id: "pay_failed" } } }));
    n = await notice();
    assert.equal(n.tone, "err");
    assert.match(n.text, /^Payment failed: Card declined Your plan was not changed\./);
    assert.equal(n.id, "pay_failed");
    // The modal stays open for a retry after a failure, so the button stays busy until it is closed.
    await page.evaluate(() => window.__rzp.o.modal.ondismiss());
    await page.waitForTimeout(200);
    assert.match(await page.evaluate(() => document.getElementById("toast").textContent), /Checkout closed\. No payment was completed\./);
    assert.ok(planChecks > 0);
    await ctx.close();
  });

  // A server that accepts the connection and never answers must not leave a page on its loading state for ever.
  await step("Stalled server: Plans stops waiting after the read timeout and says plans could not be loaded; the page stays usable", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, bypassCSP: true });
    const page = await pageOf(ctx);
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await ready(page);
    await page.route("**/api/v1/billing/plans", () => {}); // never answered
    await page.route("**/api/v1/entitlements/me", () => {}); // never answered
    await page.clock.install();
    await openView(page, "plans");
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.getElementById("plans-notice").hidden), true, "still waiting: nothing is claimed yet");
    await page.clock.fastForward(26000);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ notice: document.getElementById("plans-notice-text").textContent, ctas: [...document.querySelectorAll(".plan-cta")].map((b) => b.textContent), prices: document.getElementById("plan-cards").innerText }));
    assert.match(after.notice, /Couldn't load plans and prices/);
    assert.ok(after.ctas.length >= 2, "the plan cards are drawn");
    assert.match(after.prices, /Price unavailable/);
    assert.ok(!after.ctas.some((t) => /Upgrade/.test(t)), "no purchase button without a price");
    await openView(page, "settings");
    assert.equal(await page.evaluate(() => document.body.dataset.activeView), "settings", "navigation still works");
    assert.deepEqual(errs, [], "a timeout is handled, not thrown");
    await ctx.close();
  });

  // The Voice page says what this browser can really do, and what to do about a "no".
  await step("Voice check: a blocked microphone and a browser with no speech recognition are described as such, with what to do; 'Check again' re-reads the browser", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, bypassCSP: true });
    await ctx.addInitScript(() => {
      window.__mic = "denied";
      Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => ({ state: window.__mic }) } });
      window.SpeechRecognition = undefined;
      window.webkitSpeechRecognition = undefined;
    });
    const page = await pageOf(ctx);
    await ready(page);
    await page.evaluate(() => { location.hash = "#/settings/voice"; });
    await page.waitForSelector("#voice-check-rows .control-row");
    const rows = async () => Object.fromEntries(await page.$$eval("#voice-check-rows .control-row", (list) => list.map((r) => [r.querySelector("strong").textContent, r.querySelector("small").textContent])));
    let r = await rows();
    assert.deepEqual(Object.keys(r), ["Secure connection", "Speech recognition", "Microphone", "Audio playback"]);
    assert.match(r["Speech recognition"], /^Not available in this browser\. Type your request/);
    assert.match(r["Microphone"], /^Blocked\. Allow the microphone for this site in your browser's site settings, then tap the orb again\./);
    assert.match(r["Secure connection"], /^Yes\./, "localhost counts as secure");
    await page.evaluate(() => { window.__mic = "granted"; });
    await page.click("#voice-check-again");
    await page.waitForFunction(() => /^Allowed in this browser/.test(document.querySelector("#voice-check-rows .control-row:nth-child(3) small").textContent));
    await page.evaluate(() => { window.__mic = "prompt"; });
    await page.click("#voice-check-again");
    await page.waitForFunction(() => /will ask the first time/.test(document.querySelector("#voice-check-rows .control-row:nth-child(3) small").textContent));
    await ctx.close();
  });

  // Home's prompts follow the skills this build really has (the Chat starters already did).
  await step("Home prompts: only those with a skill behind them are offered; with the real catalogue every one is", async () => {
    // "Analyze a repo" is governed by Developer access, not by skills, so it is left out of this comparison.
    const labels = async (page) => (await page.$$eval("#home-quick .chip:not([hidden])", (chips) => chips.map((c) => c.textContent.trim()))).filter((t) => t !== "Analyze a repo");
    // The real catalogue first: everything is there.
    let ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    let page = await pageOf(ctx);
    await ready(page);
    await page.waitForFunction(() => document.querySelectorAll("#home-quick .chip:not([hidden])").length >= 7 && !document.querySelector("#home-quick .chip[data-skill-categories][hidden]"));
    assert.deepEqual(await labels(page), ["Research a topic", "Write a message", "Summarize a file", "Plan a task", "Business draft", "Open Work", "Agents"]);
    await ctx.close();
    // A build that only has web skills: only the prompts that need other skills go away; pages stay.
    ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await pageOf(ctx);
    await page.route("**/api/v1/skills", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ skills: [{ id: "web.search", name: "Web Search", description: "d", category: "WEB", riskLevel: "LOW", usageCost: 2, requiredEntitlement: "FREE", executesOnDevice: false, actionClass: "READ", asksConfirmation: false, requiredPermissions: [], upgradeRequired: false }] }) }));
    await ready(page);
    await page.waitForFunction(() => document.querySelector('#home-quick .chip[data-skill-categories="CREATIVE BUSINESS"]')?.hidden === true);
    assert.deepEqual(await labels(page), ["Research a topic", "Open Work", "Agents"]);
    await ctx.close();
  });

  // The pages this release added or reshaped, with real data on the account: accessibility (axe) in light, dark and Hindi, and no horizontal
  // overflow at every width in the brief (320, 360, 390, 412, 768, 1024, 1280, 1440).
  await step("New pages with data: no serious/critical axe violation (phone and desktop, light, dark, Hindi) and no overflow at 320-1440 (Home dashboard, projects, task list and board, Integrations, Voice, an agent)", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, bypassCSP: true, reducedMotion: "reduce" });
    const page = await pageOf(ctx);
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await ready(page);
    await seedWorkspace(page);
    await page.evaluate(async () => {
      const call = (path, body) => fetch("/api/v1" + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") }, body: JSON.stringify(body) }).then((r) => r.json());
      await call("/projects", { name: "Tax filing", goal: "File returns before the deadline" });
      const t = await call("/tasks", { goal: "Review the draft", steps: ["hello", "hello again"] });
      await call("/tasks/" + t.id + "/run", {});
    });
    const ROUTES = ["#/home", "#/work/projects", "#/work/tasks", "#/work/tasks:board", "#/settings/integrations", "#/settings/voice", "#/agents/research", "#/plans"];
    const go = async (route) => {
      const [hash, mode] = route.split(":");
      await page.evaluate((h) => { location.hash = h; }, hash);
      await page.waitForTimeout(650);
      if (route.startsWith("#/work/tasks")) {
        await page.waitForSelector("#tasks-view [data-view]");
        await page.click(`#tasks-view [data-view=${mode === "board" ? "board" : "list"}]`);
        await page.waitForTimeout(150);
      }
      if (hash === "#/home") await page.waitForSelector("#home-dash:not([hidden]) .dash-card");
    };
    const found = [];
    for (const [label, viewport, appearance, lang] of [["phone light", { width: 390, height: 860 }, "aurora", "en"], ["phone dark", { width: 390, height: 860 }, "dim", "en"], ["desktop light", { width: 1280, height: 860 }, "aurora", "en"], ["desktop dark", { width: 1280, height: 860 }, "dim", "en"], ["phone Hindi", { width: 390, height: 860 }, "aurora", "hi"]]) {
      await page.setViewportSize(viewport);
      await page.evaluate(([a, l]) => { localStorage.setItem("zarvis.appearance", a); localStorage.setItem("zarvis.lang", l); }, [appearance, lang]);
      await page.reload();
      await page.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
      await page.addScriptTag({ content: AXE_SOURCE });
      for (const route of ROUTES) {
        await go(route);
        const violations = await page.evaluate(async () => {
          // eslint-disable-next-line no-undef
          const r = await axe.run(document, { resultTypes: ["violations"] });
          return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
        });
        for (const v of violations) found.push(`${label} ${route}: ${v}`);
      }
    }
    assert.deepEqual(found, [], "axe");
    // Overflow at every width from the brief, light theme, English.
    await page.evaluate(() => { localStorage.setItem("zarvis.appearance", "aurora"); localStorage.setItem("zarvis.lang", "en"); });
    await page.reload();
    await page.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    const over = [];
    for (const width of [320, 360, 390, 412, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 860 });
      await page.waitForTimeout(200);
      for (const route of ROUTES) {
        await go(route);
        const extra = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (extra > 1) over.push(`${route} @${width}px: ${extra}px wider than the screen`);
        // Nothing the user needs may be clipped by the screen edge: every visible button and card stays inside the viewport's width.
        const cut = await page.evaluate(() => [...document.querySelectorAll("#view-home .dash-card, #view-work .ws-card, #view-work .task-card, .settings-panel:not([hidden]) .capability-item, .settings-panel:not([hidden]) .control-row")].filter((n) => n.getClientRects().length && !n.closest(".task-board")).filter((n) => { const r = n.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).map((n) => n.className.split(" ")[0]));
        if (cut.length) over.push(`${route} @${width}px: cut off by the screen edge: ${[...new Set(cut)].join(", ")}`);
      }
    }
    assert.deepEqual(over, [], "overflow");
    assert.deepEqual(errs, [], "no uncaught page errors");
    await ctx.close();
  });

  // Chat with real content: a formatted reply (list, code), an action row, a finished tool and a waiting "Thinking" card.
  // One guest account for all four looks: the server allows 60 sign-ups an hour per address and the suites share them.
  await step("accessibility: Chat with a rich reply, a tool row and Thinking has no serious/critical axe violation (phone and desktop, both themes)", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, bypassCSP: true, reducedMotion: "reduce" });
    const page = await pageOf(ctx);
    await ready(page);
    const CID = "00000000-0000-4000-8000-000000000001";
    const RICH = "Here is **what I found**:\n\n## Summary\n- First point with a [link](https://example.com/docs)\n- Second point with `inline code`\n\n> Prices are in INR.\n\n| Plan | Price | Notes |\n|:--|--:|---|\n| Pro monthly | 499 | Includes voice and web search, renews every month |\n| Pro yearly | 4999 | Best value |\n\n```js\nconst answer = 42; // the answer\nconsole.log(answer);\n```\n\n1. One\n2. Two";
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

  // Pause and Resume hold a spoken reply where it is on both playback paths (a streamed reply and "Listen"); Stop ends it and leaves audio ready for the next one.
  await step("voice: a spoken reply returns to idle when it ends (it used to stay on Speaking); Pause holds it, Resume carries on, Stop ends it, and the next reply still plays", async () => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, permissions: ["microphone"] });
    await ctx.addInitScript(() => {
      localStorage.setItem("zarvis.speak", "on");
      class FakeRecognition extends EventTarget {
        start() { window.__recognition = this; }
        stop() { this.dispatchEvent(new Event("end")); }
        abort() { this.stop(); }
      }
      window.SpeechRecognition = FakeRecognition;
      window.webkitSpeechRecognition = FakeRecognition;
      window.__say = (text) => { const ev = new Event("result"); ev.results = [[{ transcript: text }]]; window.__recognition.dispatchEvent(ev); window.__recognition.dispatchEvent(new Event("end")); };
    });
    const page = await pageOf(ctx);
    const seconds = 3;
    const pcm = Buffer.alloc(24000 * 2 * seconds); // 3 s of 24 kHz 16-bit silence
    const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.from(new Uint32Array([36 + pcm.length]).buffer), Buffer.from("WAVEfmt "), Buffer.from(new Uint32Array([16]).buffer), Buffer.from(new Uint16Array([1, 1]).buffer), Buffer.from(new Uint32Array([24000, 48000]).buffer), Buffer.from(new Uint16Array([2, 16]).buffer), Buffer.from("data"), Buffer.from(new Uint32Array([pcm.length]).buffer), pcm]);
    let streamed = 0;
    let listened = 0;
    await page.route("**/api/v1/orchestrator/turn-stream", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: reply("Namaste. Main ZARVIS hoon.") }));
    await page.route("**/api/v1/tts/synthesize-stream", (route) => { streamed += 1; return route.fulfill({ status: 200, contentType: "audio/pcm", body: pcm }); });
    await page.route("**/api/v1/tts/synthesize", (route) => { listened += 1; return route.fulfill({ status: 200, contentType: "audio/wav", body: wav }); });
    await ready(page);
    await openView(page, "chat");
    const bar = () => page.evaluate(() => ({ hidden: document.getElementById("speech-bar").hidden, label: document.getElementById("speech-bar-label").textContent, button: document.getElementById("speech-pause").textContent, pressed: document.getElementById("speech-pause").getAttribute("aria-pressed"), hero: document.getElementById("hero-status-label").textContent, state: document.getElementById("orb").dataset.state }));
    const say = async () => { await page.click("#mic-btn"); await page.evaluate(() => window.__say("namaste zarvis")); };
    let stage = "start";
    try {

    stage = "streamed reply: pause";
    // A streamed reply: pause holds it.
    await say();
    await page.waitForSelector("#speech-bar:not([hidden])", { timeout: 15000 });
    let b = await bar();
    assert.deepEqual([b.label, b.button, b.pressed, b.state], ["Speaking", "Pause", "false", "SPEAKING"]);
    await page.click("#speech-pause");
    b = await bar();
    assert.deepEqual([b.label, b.button, b.pressed, b.hero, b.state], ["Paused", "Resume", "true", "Paused", "SPEAKING"]);
    await page.waitForTimeout((seconds + 1) * 1000); // longer than the whole reply: if Pause did not hold it, it would be over
    b = await bar();
    assert.equal(b.hidden, false, "still held after longer than the reply lasts");
    assert.equal(b.state, "SPEAKING");
    await page.click("#speech-pause");
    b = await bar();
    assert.deepEqual([b.label, b.button, b.pressed], ["Speaking", "Pause", "false"]);
    await page.waitForFunction(() => document.getElementById("speech-bar").hidden && document.getElementById("orb").dataset.state === "IDLE", null, { timeout: 15000 });

    stage = "paused then stop";
    // Paused, then Stop: it ends, and the next reply plays (the audio was not left suspended).
    await say();
    await page.waitForSelector("#speech-bar:not([hidden])", { timeout: 15000 });
    await page.click("#speech-pause");
    await page.click("#speech-stop");
    await page.waitForFunction(() => document.getElementById("speech-bar").hidden && document.getElementById("orb").dataset.state === "IDLE");
    b = await bar();
    assert.equal(b.pressed, "false", "Stop clears the pause");
    stage = "next reply plays";
    const before = streamed;
    await say();
    await page.waitForSelector("#speech-bar:not([hidden])", { timeout: 15000 });
    assert.ok(streamed > before, "the next reply was spoken");
    assert.equal((await bar()).label, "Speaking");
    await page.click("#speech-stop");
    await page.waitForFunction(() => document.getElementById("speech-bar").hidden);

    stage = "listen";
    // "Listen" on a message (one audio element): Pause holds it, Resume lets it finish.
    await page.click(".bubble.assistant .bubble-actions button[aria-label=Listen]");
    stage = "listen: waiting for the bar";
    await page.waitForSelector("#speech-bar:not([hidden])", { timeout: 15000 });
    assert.equal(listened, 1);
    stage = "listen: pause click";
    await page.click("#speech-pause", { timeout: 4000 });
    assert.equal((await bar()).label, "Paused");
    stage = "listen: held";
    await page.waitForTimeout((seconds + 1) * 1000);
    assert.equal((await bar()).hidden, false, "Listen is held too");
    stage = "listen: resume click";
    await page.click("#speech-pause", { timeout: 4000 });
    await page.waitForFunction(() => document.getElementById("speech-bar").hidden && document.getElementById("orb").dataset.state === "IDLE", null, { timeout: 15000 });
    } catch (err) {
      err.message = `[${stage}] bar=` + JSON.stringify(await bar().catch(() => null)) + " listened=" + listened + " streamed=" + streamed + " :: " + err.message;
      throw err;
    }
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
