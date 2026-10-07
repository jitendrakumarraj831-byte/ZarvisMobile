/**
 * Phase 1 browser E2E for the web client, run against a real backend (+ Postgres):
 *
 *   PORT=3100 POSTGRES_URL=... CORS_ORIGINS=http://localhost:3100 npx tsx backend/src/index.ts &
 *   ZARVIS_URL=http://localhost:3100 node web/e2e/phase1.e2e.cjs
 *
 * Needs Playwright (+ Chromium). Every check asserts real backend/UI state; any console
 * error or CSP violation fails the run.
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
const DB_URL = process.env.E2E_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/zarvis_e2e";
const GITHUB_STUB = process.env.GITHUB_STUB_URL || "http://localhost:3200";
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log("PASS", name);
  } catch (err) {
    results.push(["FAIL", name]);
    console.log("FAIL", name, "\n   ", err && err.message ? err.message.split("\n")[0] : err);
  }
}

function watchErrors(page, sink) {
  page.on("pageerror", (err) => sink.push("pageerror: " + err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") sink.push("console: " + msg.text());
  });
}

const ls = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

async function nav(page, view) {
  await page.locator(`[data-view="${view}"]:visible`).first().click();
}

async function openSettings(page, panel) {
  await nav(page, "settings");
  const back = page.locator("[data-settings-back]:visible");
  if (await back.count()) await back.first().click();
  await page.click(`[data-settings-page="${panel}"]`);
}

async function send(page, text) {
  await nav(page, "chat");
  await page.fill("#text-input", text);
  await page.click("#send-btn");
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const email = `e2e-${Date.now()}@example.com`;
  const password = "correct horse battery";

  const ctxA = await browser.newContext();
  const pageA = await pageOf(ctxA, { devAccess: true }); // these flows use the Developer Agent
  const errorsA = [];
  watchErrors(pageA, errorsA);

  await step("first visit creates a server guest account (no fake identity sent)", async () => {
    await pageA.goto(BASE);
    await pageA.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    assert.equal(await ls(pageA, "zarvis.isGuest"), "true");
    assert.equal(await ls(pageA, "zarvis.userName"), null);
  });

  await step("a chat turn completes and the composer leaves busy state", async () => {
    await send(pageA, "hello");
    await pageA.waitForSelector(".bubble.assistant .bubble-body >> text=I'm ZARVIS", { timeout: 15000 });
    await pageA.waitForFunction(() => !document.getElementById("send-btn").classList.contains("stop-mode"), null, { timeout: 5000 });
  });

  await step("a tool call shows its structured status from the backend", async () => {
    await send(pageA, "please search and compare the best phones, find results");
    await pageA.waitForSelector('.tool-row[data-status="COMPLETED"]', { timeout: 15000 });
  });

  await step("reload restores only the server-persisted conversation", async () => {
    await pageA.reload();
    await nav(pageA, "chat");
    await pageA.waitForSelector(".bubble.user >> text=hello", { timeout: 10000 });
  });

  await step("Permission Center lists all 16 capabilities with truthful statuses", async () => {
    await openSettings(pageA, "permissions");
    await pageA.waitForSelector("#permission-center-list .capability-item");
    const count = await pageA.locator("#permission-center-list .capability-item").count();
    assert.equal(count, 16);
    const call = await pageA.locator('[data-capability="phone_call"]').innerText();
    assert.match(call, /Web: Unsupported · Android: Partial/);
    assert.match(call, /Every action asks for your confirmation/);
    const mic = await pageA.locator('[data-capability="microphone"] .capability-access').innerText();
    assert.ok(mic.length > 0);
    const notifications = await pageA.locator('[data-capability="notification_read"]').innerText();
    assert.match(notifications, /Web: Unsupported · Android: Partial/);
    assert.match(notifications, /Browsers can't read other apps' notifications/);
    const listText = await pageA.locator("#permission-center-list").innerText();
    assert.ok(!/: Working/.test(listText), "nothing claims WORKING without device verification");
  });

  await step("Account: link the guest to an email (same account)", async () => {
    const accountBefore = await pageA.evaluate(async () => (await (await fetch("/api/v1/auth/me", { headers: { authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") } })).json()).accountId);
    await openSettings(pageA, "account");
    await pageA.waitForSelector("#account-status >> text=Guest account");
    await pageA.fill("#account-link-email", email);
    await pageA.fill("#account-link-password", password);
    await pageA.click("#account-link-form button[type=submit]");
    await pageA.waitForSelector("#account-info >> text=Linked.");
    await pageA.waitForSelector("#account-status >> text=Signed in as");
    const accountAfter = await pageA.evaluate(async () => (await (await fetch("/api/v1/auth/me", { headers: { authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") } })).json()).accountId);
    assert.equal(accountAfter, accountBefore);
  });

  const ctxB = await browser.newContext();
  const pageB = await pageOf(ctxB);
  const errorsB = [];
  watchErrors(pageB, errorsB);

  await step("cross-device: another browser signs into the same account and sees the same conversation", async () => {
    const conversationId = await ls(pageA, "zarvis.conversationId");
    await pageB.goto(BASE);
    await pageB.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    await openSettings(pageB, "account");
    await pageB.fill("#account-signin-email", email);
    await pageB.fill("#account-signin-password", password);
    await Promise.all([pageB.waitForNavigation(), pageB.click("#account-signin-form button[type=submit]")]);
    await pageB.waitForFunction(() => localStorage.getItem("zarvis.isGuest") === "false");
    const idA = await pageA.evaluate(async () => (await (await fetch("/api/v1/auth/me", { headers: { authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") } })).json()).accountId);
    const idB = await pageB.evaluate(async () => (await (await fetch("/api/v1/auth/me", { headers: { authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") } })).json()).accountId);
    assert.equal(idB, idA);
    const messages = await pageB.evaluate(async (id) => {
      const res = await fetch("/api/v1/conversations/" + id + "/messages", { headers: { authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") } });
      return (await res.json()).messages.map((m) => m.content);
    }, conversationId);
    assert.ok(messages.includes("hello"));
  });

  await step("refresh failure from a network error keeps the same account (no silent replacement)", async () => {
    const refreshBefore = await ls(pageB, "zarvis.refreshToken");
    await pageB.evaluate(() => localStorage.setItem("zarvis.accessToken", "expired.invalid.token"));
    await pageB.route("**/api/v1/auth/refresh", (route) => route.abort("failed"));
    const status = await pageB.evaluate(async () => {
      const res = await fetch("/api/v1/auth/me", { headers: { authorization: "Bearer expired.invalid.token" } });
      return res.status;
    });
    assert.equal(status, 401);
    // Drive the app's own apiFetch path via the Account page.
    await openSettings(pageB, "account");
    await pageB.waitForSelector("#account-status >> text=Couldn't load account details");
    assert.equal(await ls(pageB, "zarvis.refreshToken"), refreshBefore, "refresh token untouched");
    assert.equal(await pageB.locator("#session-gate").isHidden(), true);
    await pageB.unroute("**/api/v1/auth/refresh");
  });

  await step("a replayed refresh token ends the session and shows the gate — no new account", async () => {
    const stale = await ls(pageB, "zarvis.refreshToken");
    // Rotate once (legitimately), then replay the old token as an attacker would.
    await pageB.evaluate(async (token) => {
      await fetch("/api/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: token }) });
      await fetch("/api/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: token }) });
    }, stale);
    await pageB.reload();
    await pageB.waitForSelector("#session-gate:not([hidden])", { timeout: 10000 });
    assert.equal(await ls(pageB, "zarvis.accessToken"), null);
    assert.match(await pageB.locator("#session-gate-title").innerText(), /ended/i);
    await pageB.fill("#session-gate-password", password);
    await Promise.all([pageB.waitForNavigation(), pageB.click("#session-gate-signin")]);
    await pageB.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
  });

  await step("sign out revokes the session server-side and never auto-creates a guest", async () => {
    const token = await ls(pageB, "zarvis.accessToken");
    await openSettings(pageB, "security");
    await pageB.click("#settings-clear-session-btn");
    await pageB.click("#confirm-modal-confirm");
    await pageB.waitForSelector("#session-gate:not([hidden])");
    const status = await pageB.evaluate(async (t) => (await fetch("/api/v1/entitlements/me", { headers: { authorization: "Bearer " + t } })).status, token);
    assert.equal(status, 401);
    await pageB.reload();
    await pageB.waitForSelector("#session-gate:not([hidden])");
    assert.equal(await ls(pageB, "zarvis.accessToken"), null);
  });

  await step("developer: without a connected GitHub account, implement is refused honestly (no confirmation)", async () => {
    const accountId = await pageA.evaluate(async () => (await (await fetch("/api/v1/auth/me", { headers: { authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") } })).json()).accountId);
    require("node:child_process").execSync(`psql ${DB_URL} -c "UPDATE accounts SET plan='PRO' WHERE id='${accountId}'"`);
    await nav(pageA, "developer");
    await pageA.waitForSelector("#github-status >> text=Not connected");
    await pageA.fill("#developer-repo-input", "https://github.com/acme/demo");
    await pageA.fill("#developer-requirement-input", "add a README badge");
    await pageA.click("#developer-implement-btn");
    await pageA.waitForSelector("#developer-result >> text=Connect your own GitHub account");
    assert.equal(await pageA.locator("#developer-result .confirm-card").count(), 0);
  });

  await step("developer: connect GitHub, get a one-time confirmation naming the identity, approve once, no replay", async () => {
    await pageA.fill("#github-token-input", "ghp_" + "e".repeat(36));
    await pageA.click("#github-connect-form button[type=submit]");
    await pageA.waitForSelector("#github-status >> text=Connected as e2e-user");
    assert.equal(await pageA.locator("#github-token-input").inputValue(), "");
    await pageA.click("#developer-implement-btn");
    await pageA.waitForSelector("#developer-result .confirm-card");
    const text = await pageA.locator("#developer-result .confirm-card").innerText();
    assert.match(text, /As GitHub user e2e-user/);
    assert.match(text, /acme\/demo/);
    assert.match(text, /add a README badge/);
    assert.match(text, /works once/);
    const id = await pageA.locator("#developer-result .confirm-card").getAttribute("data-confirmation-id");
    await pageA.click("#developer-result .confirm-card >> text=Approve");
    // The mock content generator (no AI key) returns no valid change plan, so the approved
    // action ends honestly as "invalid plan" and nothing is written to GitHub.
    await pageA.waitForSelector("#developer-result >> text=invalid change plan", { timeout: 15000 });
    const writes = await (await fetch(GITHUB_STUB + "/__writes")).json();
    assert.deepEqual(writes.writes, []);
    const replay = await pageA.evaluate(async (cid) => {
      const res = await fetch("/api/v1/confirmations/" + cid + "/approve", { method: "POST", headers: { authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") } });
      return { status: res.status, body: await res.json() };
    }, id);
    // A replay never runs again, and says truthfully that the first approve already ran it.
    assert.equal(replay.status, 409, "a used confirmation cannot be replayed");
    assert.equal(replay.body.code, "confirmation_already_used");
    assert.deepEqual((await (await fetch(GITHUB_STUB + "/__writes")).json()).writes, [], "the replay wrote nothing");
  });

  // Turn-failure and duplicate-submit behaviour. A separate context: these paths log the
  // failure with console.error on purpose, which must not trip the no-console-errors check.
  const ctxC = await browser.newContext();
  const pageC = await pageOf(ctxC);
  await pageC.goto(BASE);
  await pageC.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
  const sse = (frames) => frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");

  await step("one Enter press sends exactly one turn, even with a second Enter and a click", async () => {
    let turns = 0;
    await pageC.route("**/api/v1/orchestrator/turn-stream", async (route) => {
      turns += 1;
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse([["meta", { conversationId: "c-dup", turnId: "t1" }], ["delta", { text: "ok" }], ["done", { message: "ok", toolCalls: [], conversationId: "c-dup", turnId: "t1" }]]) });
    });
    await nav(pageC, "chat");
    await pageC.fill("#text-input", "count my requests");
    await pageC.press("#text-input", "Enter");
    await pageC.press("#text-input", "Enter");
    await pageC.waitForSelector(".bubble.assistant .bubble-body >> text=ok", { timeout: 10000 });
    await pageC.waitForTimeout(300);
    assert.equal(turns, 1, "a single submission must produce a single turn request");
    await pageC.unroute("**/api/v1/orchestrator/turn-stream");
  });

  await step("an exhausted daily AI quota says so honestly and offers no retry", async () => {
    await pageC.route("**/api/v1/orchestrator/turn-stream", (route) => route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse([["meta", { conversationId: "c-q", turnId: "t2" }], ["error", { type: "AI_QUOTA_EXCEEDED", code: "AI_QUOTA_EXCEEDED", retryable: false, quotaType: "daily", error: "limit", turnId: "t2" }]]),
    }));
    const before = await pageC.locator(".bubble-retry-btn").count();
    await send(pageC, "write an essay");
    await pageC.waitForSelector(".bubble.system >> text=today's AI usage limit", { timeout: 10000 });
    assert.equal(await pageC.locator(".bubble-retry-btn").count(), before, "a daily quota has no Retry button");
    assert.equal(await pageC.locator(".bubble.system >> text=can't connect").count(), 0, "not shown as a connection error");
    assert.equal(await pageC.locator("#send-btn").getAttribute("aria-label").then((l) => /stop/i.test(l || "")), false, "composer is usable again");
    await pageC.unroute("**/api/v1/orchestrator/turn-stream");
  });

  await step("a stream that ends without done/error is a failed turn with Retry, not silence", async () => {
    await pageC.route("**/api/v1/orchestrator/turn-stream", (route) => route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse([["meta", { conversationId: "c-cut", turnId: "t3" }], ["progress", { type: "thinking", step: 1 }]]),
    }));
    const before = await pageC.locator(".bubble-retry-btn").count();
    await send(pageC, "this stream gets cut");
    await pageC.waitForFunction((n) => document.querySelectorAll(".bubble-retry-btn").length > n, before, { timeout: 10000 });
    assert.equal(await pageC.locator(".bubble.thinking").count(), 0, "no thinking bubble left behind");
    assert.notEqual(await pageC.locator("#orb").getAttribute("data-state"), "UNDERSTANDING", "the orb is not stuck thinking");
    await pageC.unroute("**/api/v1/orchestrator/turn-stream");
  });
  await step("every turn failure (network, server error, HTTP 500, failed tool) leaves the UI usable", async () => {
    const usable = async (label) => {
      await pageC.waitForFunction(() => !document.querySelector(".bubble.thinking"), null, { timeout: 10000 });
      const orb = await pageC.locator("#orb").getAttribute("data-state");
      assert.ok(!["UNDERSTANDING", "EXECUTING", "SPEAKING"].includes(orb), `${label}: orb stuck in ${orb}`);
      const send = await pageC.locator("#send-btn").getAttribute("aria-label");
      assert.ok(!/stop/i.test(send || ""), `${label}: composer still busy (${send})`);
    };
    const cases = [
      ["network failure", (route) => route.abort("internetdisconnected")],
      ["server error event", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: sse([["meta", { conversationId: "c-e", turnId: "t4" }], ["error", { error: "The request could not be completed.", retryable: true, turnId: "t4" }]]) })],
      ["HTTP 500", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Internal error", code: "internal_error" }) })],
      ["failed tool", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: sse([
        ["meta", { conversationId: "c-t", turnId: "t5" }],
        ["progress", { type: "tool_started", skillId: "web.search", toolCallId: "tc1" }],
        ["progress", { type: "tool_finished", skillId: "web.search", toolCallId: "tc1", status: "FAILED" }],
        ["delta", { text: "Web Search ran into an error, so nothing was completed." }],
        ["done", { message: "Web Search ran into an error, so nothing was completed.", conversationId: "c-t", turnId: "t5", toolCalls: [{ toolCallId: "tc1", skillId: "web.search", outcome: { kind: "execution_failed", result: { kind: "failure", reason: "handler_error", userMessage: "x" } }, result: { success: false, status: "FAILED", skillId: "web.search", capabilityId: null, userSafeMessage: "Web Search ran into an error, so nothing was completed.", retryable: true, verificationEvidence: null } }] }],
      ]) })],
    ];
    for (const [label, handler] of cases) {
      await pageC.route("**/api/v1/orchestrator/turn-stream", handler);
      const rowsBefore = await pageC.locator(".tool-row").count();
      await send(pageC, `failure case: ${label}`);
      if (label === "failed tool") {
        await pageC.waitForFunction((n) => document.querySelectorAll(".tool-row").length === n + 1, rowsBefore, { timeout: 10000 });
        assert.equal(await pageC.locator(".tool-row").count(), rowsBefore + 1, "one failed execution renders one row");
      } else {
        await pageC.waitForSelector(".bubble-retry-btn", { timeout: 10000 });
      }
      await usable(label);
      await pageC.unroute("**/api/v1/orchestrator/turn-stream");
    }
  });
  await step("Retry after a stream cut off once the server finished: replayed, one execution, one stored message", async () => {
    // The first attempt really runs on the backend, but the browser only sees its meta frame
    // (the connection dropped after the server finished). Retry must not run the turn again.
    const bodies = [];
    let replayFrames = "";
    await pageC.route("**/api/v1/orchestrator/turn-stream", async (route) => {
      bodies.push(JSON.parse(route.request().postData() || "{}"));
      const real = await route.fetch();
      const text = await real.text();
      if (bodies.length === 1) {
        const metaOnly = text.split("\n\n").filter((frame) => frame.startsWith("event: meta")).join("\n\n") + "\n\n";
        await route.fulfill({ status: 200, contentType: "text/event-stream", body: metaOnly });
        return;
      }
      replayFrames = text;
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: text });
    });
    const before = await pageC.locator(".bubble-retry-btn").count();
    await send(pageC, "Hello");
    await pageC.waitForFunction((n) => document.querySelectorAll(".bubble-retry-btn").length > n, before, { timeout: 10000 });
    await pageC.locator(".bubble-retry-btn").last().click();
    await pageC.waitForSelector(".bubble.assistant >> text=I'm ZARVIS", { timeout: 10000 });
    await pageC.waitForFunction(() => !document.querySelector(".bubble.thinking"), null, { timeout: 10000 });
    await pageC.unroute("**/api/v1/orchestrator/turn-stream");

    assert.equal(bodies.length, 2, "one original request and one Retry");
    assert.match(bodies[0].clientTurnId || "", /^[A-Za-z0-9_-]{8,100}$/, "the turn carries an idempotency key");
    assert.equal(bodies[1].clientTurnId, bodies[0].clientTurnId, "Retry re-sends the same logical turn");
    assert.match(replayFrames, /"replayed":true/, "the backend replayed the finished turn instead of running it again");
    const conversationId = await ls(pageC, "zarvis.conversationId");
    const stored = await pageC.evaluate(async (id) => {
      const res = await fetch(`/api/v1/conversations/${id}/messages`, { headers: { authorization: `Bearer ${localStorage.getItem("zarvis.accessToken")}` } });
      return (await res.json()).messages.map((m) => m.role + ":" + m.content);
    }, conversationId);
    assert.equal(stored.filter((m) => m === "user:Hello").length, 1, `the message is stored once: ${JSON.stringify(stored)}`);
  });

  await ctxC.close();

  await step("welcome card: Continue as guest is always offered (even if the server says sign-in is required) and is remembered", async () => {
    const ctxW = await browser.newContext();
    const pageW = await ctxW.newPage();
    // An older or misconfigured server may still answer requireSignIn: true; the card must stay skippable.
    await pageW.route("**/api/v1/auth/config", (route) => route.fulfill({ json: { googleClientId: null, requireSignIn: true } }));
    await pageW.goto(BASE);
    await pageW.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    await nav(pageW, "chat");
    await pageW.waitForSelector("#welcome-gate:not([hidden])");
    assert.equal(await pageW.locator("#welcome-guest").isVisible(), true, "Continue as guest is visible");
    assert.equal(await pageW.locator("#welcome-close").isVisible(), true, "the close button is visible");
    assert.equal(await pageW.locator("#welcome-error").isVisible(), false, "no error is shown before the user does anything");
    await pageW.click("#welcome-guest");
    assert.equal(await pageW.locator("#welcome-gate").isHidden(), true);
    await send(pageW, "hello");
    await pageW.waitForSelector(".bubble.assistant .bubble-body", { timeout: 15000 });
    // Remembered: reopening Chat after a reload does not ask again.
    await pageW.reload();
    await pageW.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    await nav(pageW, "chat");
    await pageW.waitForTimeout(500);
    assert.equal(await pageW.locator("#welcome-gate").isHidden(), true, "the card does not come back");
    assert.equal(await ls(pageW, "zarvis.isGuest"), "true");
    await ctxW.close();
  });

  await step("Home: the prompt card starts a chat, Quick actions fill the Chat box, tiles open the right picker, and the app bar lines up with every page", async () => {
    const ctxH = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageH = await pageOf(ctxH);
    await pageH.goto(BASE);
    await pageH.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    // The prompt card sends exactly what was typed.
    await pageH.fill("#home-prompt-input", "hello from home");
    await pageH.press("#home-prompt-input", "Enter");
    await pageH.waitForSelector("#view-chat:not([hidden])");
    await pageH.waitForSelector(".bubble.user >> text=hello from home");
    await pageH.waitForSelector(".bubble.assistant .bubble-body", { timeout: 15000 });
    // "Quick actions" expands the chips; a chip opens Chat with its starter text, ready to edit (nothing is sent).
    await nav(pageH, "home");
    assert.equal(await pageH.locator("#home-quick").isHidden(), true, "chips start collapsed");
    await pageH.click("#home-quick-toggle");
    assert.equal(await pageH.getAttribute("#home-quick-toggle", "aria-expanded"), "true");
    await pageH.click('#home-quick .chip[data-workspace-prompt^="Write a warm"]');
    await pageH.waitForSelector("#view-chat:not([hidden])");
    assert.match(await pageH.inputValue("#text-input"), /^Write a warm, concise message about:/);
    assert.equal(await pageH.locator(".bubble.user").count(), 1, "the chip did not send anything");
    // Files lists every supported type; Image narrows the picker to pictures and the next Files pick is full again.
    await nav(pageH, "home");
    await pageH.click('.action-tile[data-home-action="image"]');
    assert.equal(await pageH.getAttribute("#file-input", "accept"), "image/*");
    await nav(pageH, "home");
    await pageH.click('.action-tile[data-home-action="upload"]');
    assert.match(await pageH.getAttribute("#file-input", "accept"), /\.pdf/);
    // The app bar's right edge is the page content's right edge on every list page.
    const avatarRight = () => pageH.evaluate(() => Math.round(document.getElementById("desk-avatar").getBoundingClientRect().right));
    for (const view of ["activity", "capabilities", "plans", "settings"]) {
      await nav(pageH, view);
      await pageH.waitForTimeout(450); // the page's entrance animation
      const edge = await pageH.evaluate((v) => Math.round(document.querySelector(`#view-${v} .page-head`).getBoundingClientRect().right), view);
      assert.ok(Math.abs(edge - (await avatarRight())) <= 1, `${view}: page edge ${edge} vs app bar ${await avatarRight()}`);
    }
    await ctxH.close();
  });

  await step("Developer access: off by default hides the Developer Agent and Metrics everywhere; the switch brings them back and is remembered", async () => {
    for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
      const ctxD = await browser.newContext({ viewport });
      const pageD = await pageOf(ctxD);
      await pageD.goto(BASE);
      await pageD.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
      const visible = (sel) => pageD.locator(`${sel}:visible`).count();
      assert.equal(await pageD.evaluate(() => document.body.dataset.devAccess), "off", label + ": off by default");
      assert.equal(await visible('[data-view="developer"]') + (await visible('[data-view="metrics"]')), 0, label + ": no Developer/Metrics nav");
      assert.equal(await visible('#home-quick [data-nav="developer"]'), 0, label + ": no Analyze-a-repo chip");
      assert.ok((await visible('[data-view="activity"]')) >= 1, label + ": Activity is a primary page");
      // Any route to a hidden page lands on the switch instead of the page.
      await pageD.evaluate(() => document.querySelector('[data-nav="developer"]').click());
      await pageD.waitForSelector('[data-settings-panel="developer"]:not([hidden])');
      assert.equal(await pageD.getAttribute("#settings-dev-toggle", "aria-pressed"), "false");
      await pageD.click("#settings-dev-toggle");
      assert.equal(await pageD.getAttribute("#settings-dev-toggle", "aria-pressed"), "true");
      if (label === "desktop") assert.equal(await visible('.sidebar [data-view="developer"]') + (await visible('.sidebar [data-view="metrics"]')), 2);
      await pageD.click("#settings-open-metrics");
      await pageD.waitForSelector("#view-metrics:not([hidden])");
      await pageD.reload();
      await pageD.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
      assert.equal(await pageD.evaluate(() => document.body.dataset.devAccess), "on", label + ": remembered after reload");
      assert.equal(await pageD.locator('#home-quick [data-nav="developer"]').count(), 1);
      // Switching it off again removes the entry points and the hub group.
      await pageD.evaluate(() => document.querySelector('[data-view="settings"]').click());
      const back = pageD.locator("[data-settings-back]:visible");
      if (await back.count()) await back.first().click();
      await pageD.click('[data-settings-page="developer"]');
      await pageD.click("#settings-dev-toggle");
      assert.equal(await pageD.evaluate(() => document.body.dataset.devAccess), "off");
      await pageD.evaluate(() => document.querySelector('[data-view="capabilities"]').click());
      assert.equal(await pageD.locator('.cap-pill[data-cap-filter="developer"]').count(), 0, label + ": hub drops the Developer group");
      await ctxD.close();
    }
  });

  await step("Pages: the profile card opens Account, Capabilities tallies what it lists, Activity's empty state offers a next step", async () => {
    const ctxP = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageP = await pageOf(ctxP);
    await pageP.goto(BASE);
    await pageP.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    await nav(pageP, "settings");
    assert.match(await pageP.innerText("#profile-hero-name"), /Guest/);
    await pageP.click("#settings-profile-hero");
    await pageP.waitForSelector('[data-settings-panel="account"]:not([hidden])');
    await nav(pageP, "capabilities");
    await pageP.waitForSelector(".cap-summary .cap-sum");
    const tally = await pageP.$$eval(".cap-summary .cap-sum strong", (nodes) => nodes.reduce((sum, node) => sum + Number(node.textContent), 0));
    assert.equal(tally, await pageP.locator(".cap-grid .cap-item").count(), "the tally adds up to the cards shown");
    await nav(pageP, "activity");
    await pageP.click(".timeline-empty-rich .empty-state .btn");
    await pageP.waitForSelector("#view-chat:not([hidden])");
    await ctxP.close();
  });

  await step("Navigation: Back/Forward move between pages, reload and #/links keep the page, every page has its own title", async () => {
    const ctxN = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pageN = await pageOf(ctxN);
    await pageN.goto(BASE);
    await pageN.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    const view = () => pageN.evaluate(() => document.body.dataset.activeView);
    const homeTitle = await pageN.title();
    await nav(pageN, "chat");
    await nav(pageN, "activity");
    assert.match(await pageN.title(), /^Activity · /, "each page sets its own tab title");
    assert.notEqual(await pageN.title(), homeTitle);
    await pageN.goBack();
    await pageN.waitForFunction(() => document.body.dataset.activeView === "chat");
    await pageN.goForward();
    await pageN.waitForFunction(() => document.body.dataset.activeView === "activity");
    await pageN.reload();
    await pageN.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    assert.equal(await view(), "activity", "a reload keeps the page");
    // A Settings sub-page is an entry too; the in-app back button behaves like the browser's.
    await pageN.goto(BASE + "/#/settings/voice");
    await pageN.waitForSelector('[data-settings-panel="voice"]:not([hidden])');
    assert.match(await pageN.title(), /^Voice · /);
    await pageN.click("[data-settings-back]");
    await pageN.waitForSelector("#settings-grid:not([hidden])");
    assert.equal(await pageN.evaluate(() => location.hash), "#/settings");
    // The Account page is called Profile, not the user's name.
    await pageN.click('[data-settings-page="account"]');
    assert.equal(await pageN.innerText("#settings-subpage-title"), "Profile");
    // Developer-only routes never open for someone without Developer access: they land on its switch.
    await pageN.goto(BASE + "/#/metrics");
    await pageN.waitForSelector('[data-settings-panel="developer"]:not([hidden])');
    assert.equal(await pageN.evaluate(() => location.hash), "#/settings/developer");
    await ctxN.close();
  });

  await step("Dialogs: focus goes in and stays in, the page behind is locked, focus comes back; offline is shown, not hidden behind 'Online'", async () => {
    const ctxM = await browser.newContext({ viewport: { width: 390, height: 700 } }); // first visit: the sign-in card opens on Chat
    const pageM = await ctxM.newPage();
    await pageM.goto(BASE);
    await pageM.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    await nav(pageM, "chat");
    await pageM.waitForSelector("#welcome-gate:not([hidden])");
    const inside = () => pageM.evaluate(() => document.getElementById("welcome-gate").contains(document.activeElement));
    assert.equal(await inside(), true, "focus moves into the card");
    for (let i = 0; i < 14; i++) {
      await pageM.keyboard.press("Tab");
      assert.equal(await inside(), true, "Tab stays inside the card");
    }
    assert.equal(await pageM.evaluate(() => getComputedStyle(document.body).overflow), "hidden", "the page behind cannot scroll");
    assert.equal(await pageM.evaluate(() => document.querySelector(".app").inert), true, "the page behind is inert");
    await pageM.keyboard.press("Escape");
    await pageM.waitForSelector("#welcome-gate", { state: "hidden" });
    assert.notEqual(await pageM.evaluate(() => document.activeElement && document.activeElement.tagName), "BODY", "focus returns to the page");
    assert.equal(await pageM.evaluate(() => document.querySelector(".app").inert), false);
    // Offline: the header and a banner say so; coming back clears both.
    await ctxM.setOffline(true);
    await pageM.waitForSelector("#offline-banner:not([hidden])");
    assert.match(await pageM.innerText(".chat-header"), /Offline/);
    await ctxM.setOffline(false);
    await pageM.waitForSelector("#offline-banner", { state: "hidden" });
    await ctxM.close();
  });

  await step("First paint: the saved or device theme is applied before the app script runs; a notch never covers the top bar", async () => {
    for (const [stored, expected] of [["dim", "dim"], ["aurora", "aurora"]]) {
      const ctxT = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await ctxT.addInitScript((mode) => { try { localStorage.setItem("zarvis.appearance", mode); } catch {} }, stored);
      const pageT = await ctxT.newPage();
      await pageT.route("**/app.js", () => {}); // never answered: what is on screen before the app script exists
      pageT.goto(BASE, { waitUntil: "commit" }).catch(() => {});
      await pageT.waitForFunction(() => document.body && getComputedStyle(document.body).backgroundColor !== "", null, { timeout: 15000 });
      assert.equal(await pageT.evaluate(() => document.documentElement.getAttribute("data-appearance")), expected, "saved theme on first paint");
      await ctxT.close();
    }
    for (const [scheme, expected] of [["light", "aurora"], ["dark", "dim"]]) {
      const ctxD = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
      const pageD2 = await pageOf(ctxD);
      await pageD2.goto(BASE);
      assert.equal(await pageD2.evaluate(() => document.documentElement.getAttribute("data-appearance")), expected, "first visit follows the device theme (" + scheme + ")");
      await ctxD.close();
    }
    const ctxS = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const pageS = await pageOf(ctxS);
    await pageS.goto(BASE);
    await pageS.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    const cdp = await ctxS.newCDPSession(pageS);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
    const box = await pageS.evaluate(() => ({ brandTop: document.querySelector(".topbar-brand").getBoundingClientRect().top, navPad: parseFloat(getComputedStyle(document.querySelector(".bottom-nav")).paddingBottom) }));
    assert.ok(box.brandTop >= 47, "top bar content starts below the notch: " + box.brandTop);
    assert.ok(box.navPad >= 34, "bottom nav clears the home indicator: " + box.navPad);
    await ctxS.close();
  });

  await step("every static script is served as JavaScript (no index.html fallback)", async () => {
    for (const path of ["/logic.js", "/feature-pages.js", "/app.js", "/sw.js"]) {
      const res = await fetch(BASE + path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get("content-type") || "", /javascript/, path);
    }
  });

  await step("no console errors or CSP violations", async () => {
    // Expected, non-app noise only: intentional 401s/aborted refresh in the tests above, and
    // Google Fonts blocked by this sandbox's TLS proxy.
    // The 409 is the deliberate confirmation-replay check above; static scripts are checked separately.
    const all = [...errorsA, ...errorsB].filter((e) => !/401 \(Unauthorized\)|404 \(Not Found\)|409 \(Conflict\)|net::ERR_FAILED|ERR_CERT_AUTHORITY_INVALID/.test(e));
    assert.deepEqual(all, [], all.join("\n"));
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
async function pageOf(ctx, { devAccess = false } = {}) {
  await ctx.addInitScript((dev) => {
    try {
      localStorage.setItem("zarvis.welcomeDismissed", "1");
      if (dev) localStorage.setItem("zarvis.devAccess", "on");
    } catch {}
  }, devAccess);
  return ctx.newPage();
}
