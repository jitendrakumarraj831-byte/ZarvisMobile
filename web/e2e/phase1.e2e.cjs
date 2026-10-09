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
  // ONLY="text" runs just the steps whose name contains it (steps that need an earlier one will fail on their own).
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try {
    await fn();
    results.push(["PASS", name]);
    console.log("PASS", name);
  } catch (err) {
    results.push(["FAIL", name]);
    console.log("FAIL", name, "\n   ", err && err.message ? err.message.split("\n").slice(0, 4).join("\n    ") : err);
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
    await pageA.waitForSelector('.exec-card[data-status="COMPLETED"]', { timeout: 15000 });
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

  await step("chat list follows the account: a browser that never opened the chat lists it, a removed chat stays removed, and the other browser keeps it", async () => {
    const conversationId = await ls(pageA, "zarvis.conversationId");
    assert.ok(conversationId, "browser A has a conversation");
    // B signed in a moment ago and never opened this chat: the server list alone must put it in the index.
    await pageB.waitForFunction((id) => (localStorage.getItem("zarvis.chats") || "").includes(id), conversationId);
    await nav(pageB, "chat");
    await pageB.click("#chat-history-btn");
    const rowB = pageB.locator("#history-list .chat-row", { hasText: "hello" });
    await rowB.first().waitFor();
    assert.equal(await rowB.count(), 1, "one row, not one per sync");
    // Remove it here, reload: the next sync must not bring it back.
    await rowB.first().locator(".chat-row-del").click();
    await pageB.click("#confirm-modal-confirm");
    await pageB.waitForFunction((id) => !(localStorage.getItem("zarvis.chats") || "").includes(id), conversationId);
    await pageB.reload();
    await pageB.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    await pageB.waitForTimeout(1500);
    assert.ok(!(await ls(pageB, "zarvis.chats")).includes(conversationId), "removed chat stays out after the sync on reload");
    assert.ok((await ls(pageB, "zarvis.chatsHidden")).includes(conversationId));
    // The list on the other browser, and the conversation itself, are untouched.
    await pageA.reload();
    await pageA.waitForFunction((id) => (localStorage.getItem("zarvis.chats") || "").includes(id), conversationId);
    const stillThere = await pageB.evaluate(async (id) => (await fetch("/api/v1/conversations/" + id + "/messages", { headers: { authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") } })).status, conversationId);
    assert.equal(stillThere, 200);
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
    await pageA.click("#developer-result .confirm-card button:has-text(\"Confirm\")");
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
      const rowsBefore = await pageC.locator(".exec-card").count();
      await send(pageC, `failure case: ${label}`);
      if (label === "failed tool") {
        await pageC.waitForFunction((n) => document.querySelectorAll(".exec-card").length === n + 1, rowsBefore, { timeout: 10000 });
        assert.equal(await pageC.locator(".exec-card").count(), rowsBefore + 1, "one failed execution renders one card");
        assert.equal(await pageC.locator('.exec-card[data-status="FAILED"]').count() >= 1, true, "and it says it failed");
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

  await step("Home: the message card sends to Chat and has direct file and image buttons, the orb and the footer mic open Chat, quick prompts fill the Chat box, and the app bar lines up with every page", async () => {
    // Desktop: the orb opens Chat; a chip opens Chat with its starter text, ready to edit (nothing is sent).
    const ctxH = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageH = await pageOf(ctxH);
    await pageH.goto(BASE);
    await pageH.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    // The message card sends exactly what was typed.
    await pageH.fill("#home-prompt-input", "hello from home");
    await pageH.press("#home-prompt-input", "Enter");
    await pageH.waitForSelector("#view-chat:not([hidden])");
    await pageH.waitForSelector(".bubble.user >> text=hello from home");
    await pageH.waitForSelector(".bubble.assistant .bubble-body", { timeout: 15000 });
    // The orb opens Chat.
    await nav(pageH, "home");
    await pageH.click("#home-orb");
    await pageH.waitForSelector("#view-chat:not([hidden])");
    await nav(pageH, "home");
    assert.equal(await pageH.locator("#home-quick").isVisible(), true, "the quick prompts need no tap to appear");
    await pageH.click('#home-quick .chip[data-workspace-prompt^="Write a warm"]');
    await pageH.waitForSelector("#view-chat:not([hidden])");
    assert.match(await pageH.inputValue("#text-input"), /^Write a warm, concise message about:/);
    assert.equal(await pageH.locator(".bubble.user").count(), 1, "the chip did not send anything");
    // "Upload file" lists every supported type; "Select image" goes straight to pictures and the next file pick is full again.
    await nav(pageH, "home");
    await pageH.click('#home-prompt-form [data-home-action="image"]');
    assert.equal(await pageH.getAttribute("#file-input", "accept"), "image/*");
    await nav(pageH, "home");
    await pageH.click('#home-prompt-form [data-home-action="upload"]');
    assert.match(await pageH.getAttribute("#file-input", "accept"), /\.pdf/);
    // The app bar's right edge is the page content's right edge on every list page.
    const avatarRight = () => pageH.evaluate(() => Math.round(document.getElementById("desk-avatar").getBoundingClientRect().right));
    for (const view of ["work", "agents", "activity", "plans", "settings"]) {
      await nav(pageH, view);
      await pageH.waitForTimeout(450); // the page's entrance animation
      const edge = await pageH.evaluate((v) => Math.round(document.querySelector(`#view-${v} .page-head`).getBoundingClientRect().right), view);
      assert.ok(Math.abs(edge - (await avatarRight())) <= 1, `${view}: page edge ${edge} vs app bar ${await avatarRight()}`);
    }
    await ctxH.close();

    // Phone: the mic in the middle of the tab bar opens Chat at once, from any page.
    const ctxP = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const pageP = await pageOf(ctxP);
    await pageP.goto(BASE);
    await pageP.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    for (const from of ["home", "settings"]) {
      await pageP.evaluate((v) => document.querySelector(`.bottom-nav [data-view="${v}"]`).click(), from);
      await pageP.waitForTimeout(300);
      await pageP.click(".bottom-nav .nav-fab");
      await pageP.waitForSelector("#view-chat:not([hidden])", { timeout: 3000 });
    }
    await ctxP.close();
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
      assert.ok((await pageD.locator('[data-view="activity"]').count()) >= 1, label + ": Activity is still in the navigation (the phone keeps it in the menu)");
      assert.ok((await visible('[data-view="work"]')) >= 1 && (await visible('[data-view="agents"]')) >= 1, label + ": Work and Agents are primary pages");
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
      await pageD.evaluate(() => { location.hash = "#/capabilities"; });
      await pageD.waitForSelector("#view-capabilities:not([hidden]) .cap-pill");
      assert.equal(await pageD.locator('.cap-pill[data-cap-filter="developer"]').count(), 0, label + ": hub drops the Developer group");
      await ctxD.close();
    }
  });

  await step("Phone menu: the top-left menu button opens the whole navigation as a drawer that traps focus, locks the page behind, and closes on Esc, backdrop, Back or choosing a page", async () => {
    const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const pageM = await pageOf(ctxM);
    await pageM.goto(BASE);
    await pageM.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    const menu = pageM.locator("#menu-btn");
    const isOpen = () => pageM.evaluate(() => document.getElementById("sidebar-nav").classList.contains("is-open"));
    const inDrawer = () => pageM.evaluate(() => document.getElementById("sidebar-nav").contains(document.activeElement));
    const openDrawer = async () => { await menu.click(); await pageM.waitForFunction(() => document.getElementById("sidebar-nav").classList.contains("is-open")); await pageM.waitForTimeout(350); };
    // Where the logo used to be: top-left, at least 44px, ahead of the wordmark and the actions.
    const box = await menu.boundingBox();
    assert.ok(box && box.x < 24 && box.y < 24 && box.width >= 44 && box.height >= 44, "menu button is top-left and 44px: " + JSON.stringify(box));
    assert.equal(await menu.getAttribute("aria-expanded"), "false");
    assert.equal(await pageM.locator("#sidebar-nav").isVisible(), false, "closed at first");
    assert.equal(await pageM.locator("#sidebar-nav button:visible").count(), 0, "a closed drawer has nothing to tab to");
    // Open: focus moves in, the page behind is inert and cannot scroll.
    await openDrawer();
    assert.equal(await menu.getAttribute("aria-expanded"), "true");
    assert.equal(await inDrawer(), true, "focus is inside the drawer");
    assert.equal(await pageM.evaluate(() => document.querySelector(".main").hasAttribute("inert")), true, "the page behind is inert");
    assert.equal(await pageM.evaluate(() => getComputedStyle(document.body).overflow), "hidden", "the page behind cannot scroll");
    // The whole navigation (no developer pages while that switch is off).
    const labels = (await pageM.locator("#sidebar-nav .nav-item:visible").allInnerTexts()).map((t) => t.trim());
    assert.deepEqual(labels, ["Home", "Chat", "Work", "Agents", "Activity", "Plans & Usage", "Settings", "Profile"]);
    // Tab never leaves the drawer.
    for (let i = 0; i < 12; i++) {
      await pageM.keyboard.press("Tab");
      assert.equal(await inDrawer(), true, "Tab stays in the drawer");
    }
    // Esc closes it and focus returns to the menu button.
    await pageM.keyboard.press("Escape");
    await pageM.waitForFunction(() => !document.getElementById("sidebar-nav").classList.contains("is-open"));
    assert.equal(await pageM.evaluate(() => document.activeElement?.id), "menu-btn", "focus returns to the menu button");
    assert.equal(await pageM.evaluate(() => document.querySelector(".main").hasAttribute("inert")), false);
    assert.notEqual(await pageM.evaluate(() => getComputedStyle(document.body).overflow), "hidden");
    // Choosing a page switches to it and closes the drawer.
    await openDrawer();
    await pageM.click('#sidebar-nav [data-view="plans"]');
    await pageM.waitForSelector("#view-plans:not([hidden])");
    assert.equal(await isOpen(), false, "choosing a page closes the drawer");
    // Tapping the page you are already on closes it too.
    await openDrawer();
    await pageM.click('#sidebar-nav [data-view="plans"]');
    assert.equal(await isOpen(), false, "tapping the current page closes the drawer");
    assert.equal(await pageM.locator("#view-plans").isVisible(), true);
    // The backdrop closes it.
    await openDrawer();
    await pageM.locator("#drawer-scrim").click({ position: { x: 360, y: 400 } });
    assert.equal(await isOpen(), false, "the backdrop closes the drawer");
    // So does the close button, and the browser's Back.
    await openDrawer();
    await pageM.click("#drawer-close");
    assert.equal(await isOpen(), false, "the close button closes the drawer");
    await openDrawer();
    await pageM.goBack();
    await pageM.waitForFunction(() => !document.getElementById("sidebar-nav").classList.contains("is-open"));
    assert.equal(await pageM.evaluate(() => document.querySelector(".main").hasAttribute("inert")), false, "Back leaves nothing inert");
    // Turning the phone to a wide screen while it is open leaves nothing half open: the sidebar is simply there.
    await openDrawer();
    await pageM.setViewportSize({ width: 1280, height: 800 });
    await pageM.waitForFunction(() => !document.getElementById("sidebar-nav").classList.contains("is-open"));
    assert.equal(await pageM.locator("#menu-btn:visible").count(), 0, "no menu button on a wide screen");
    assert.equal(await pageM.locator('#sidebar-nav [data-view="settings"]:visible').count(), 1, "the sidebar is shown instead");
    assert.equal(await pageM.evaluate(() => document.querySelector(".main").hasAttribute("inert")), false);
    await ctxM.close();

    // Developer access adds its two pages; Hindi labels the button and the drawer.
    const ctxH = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await ctxH.addInitScript(() => { try { localStorage.setItem("zarvis.lang", "hi"); } catch {} });
    const pageH = await pageOf(ctxH, { devAccess: true });
    await pageH.goto(BASE);
    await pageH.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    assert.equal(await pageH.getAttribute("#menu-btn", "aria-label"), "मेन्यू");
    await pageH.click("#menu-btn");
    await pageH.waitForTimeout(350);
    const hindi = (await pageH.locator("#sidebar-nav .nav-item:visible").allInnerTexts()).map((t) => t.trim());
    assert.deepEqual(hindi, ["होम", "चैट", "काम", "एजेंट", "गतिविधि", "डेवलपर एजेंट", "उपयोग और मेट्रिक्स", "प्लान और उपयोग", "सेटिंग्स", "प्रोफ़ाइल"]);
    assert.equal(await pageH.getAttribute("#drawer-close", "aria-label"), "मेन्यू बंद करें");
    await ctxH.close();
  });

  await step("Home: the glowing orb says only ZARVIS AI, the message card asks one question, the four feature tiles are gone, and a mic sits in the middle of the tab bar", async () => {
    for (const [label, viewport, touch] of [["phone", { width: 390, height: 844 }, true], ["desktop", { width: 1280, height: 800 }, false]]) {
      const ctxN = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
      const pageN = await pageOf(ctxN);
      await pageN.goto(BASE);
      await pageN.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
      await pageN.waitForTimeout(800);
      const text = (selector) => pageN.evaluate((s) => document.querySelector(s)?.textContent.replace(/\s+/g, " ").trim(), selector);
      assert.equal(await text("#home-orb"), "ZARVIS AI", label + ": the orb says only ZARVIS AI");
      assert.equal(await pageN.locator("#home-orb svg").count(), 0, label + ": no star in the orb");
      assert.equal(await pageN.getAttribute("#home-orb", "aria-label"), "ZARVIS AI — talk by voice");
      assert.equal(await text(".home-title"), "What can I help with today?", label + ": the one question under the orb");
      assert.deepEqual(await pageN.evaluate(() => [...document.querySelectorAll("#home-prompt-form [data-home-action]")].map((b) => b.getAttribute("aria-label") + "|" + b.dataset.homeAction + "|" + (b.textContent.trim() === ""))), ["Upload file|upload|true", "Select image|image|true"], label + ": icon-only file and image buttons in the card");
      assert.equal(await text(label === "phone" ? ".topbar .brand-text" : ".sidebar .brand-text"), "ZARVIS AI", label + ": header name");
      assert.equal(await pageN.title(), "ZARVIS AI", label + ": tab title");
      assert.equal(await pageN.locator(".action-tile, .primary-actions, .home-composer").count(), 0, label + ": the four feature tiles and the bottom message bar are gone");
      // The first screen stays free of activity status. "Your workspace" (recent chats, projects, files, tasks, tool runs, plan) is a
      // separate section below it, reached by scrolling or the "Your workspace" cue, and drawn only from what the server returned.
      assert.equal(await pageN.locator("#view-home .home-first #home-recent, #view-home .home-first #home-activity, #view-home .home-first [data-nav='activity'], #view-home .home-first #home-dash").count(), 0, label + ": no activity status on Home's first screen");
      assert.equal(await pageN.locator("#view-home > #home-dash").count(), 1, label + ": the workspace section is its own block below the first screen");

      const facts = await pageN.evaluate(() => {
        const orb = document.querySelector("#home-orb .orb").getBoundingClientRect();
        const hero = document.querySelector(".home-hero").getBoundingClientRect();
        const fab = document.querySelector(".bottom-nav .nav-fab");
        const fabBox = fab.getBoundingClientRect();
        const row = document.querySelector("#home-quick .chip-row");
        const chips = [...row.querySelectorAll(".chip:not([hidden])")];
        const greet = document.querySelector(".home-greet").getBoundingClientRect();
        const title = document.querySelector(".home-title").getBoundingClientRect();
        const card = document.getElementById("home-prompt-form").getBoundingClientRect();
        return {
          aboveOrb: Math.round(orb.top - greet.bottom), belowOrb: Math.round(title.top - orb.bottom), orbW: orb.width, aboveCard: Math.round(card.top - row.getBoundingClientRect().bottom),
          orbWidth: Math.round(orb.width), orbCentre: Math.round(orb.left + orb.width / 2), heroCentre: Math.round(hero.left + hero.width / 2), screen: innerWidth,
          fabVisible: fab.getClientRects().length > 0, fabCentre: Math.round(fabBox.left + fabBox.width / 2),
          fabIcon: fab.querySelector("use").getAttribute("href"),
          chipScroll: row.scrollWidth > row.clientWidth + 8, chipOverflowX: getComputedStyle(row).overflowX, firstChipLeft: Math.round(chips[0].getBoundingClientRect().left),
          small: chips.filter((b) => b.getBoundingClientRect().height < 43.5).length,
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      assert.ok(Math.abs(facts.orbCentre - facts.heroCentre) <= 1, `${label}: the orb is centred (${facts.orbCentre} vs ${facts.heroCentre})`);
      const card = await pageN.evaluate(() => { const r = document.getElementById("home-prompt-form").getBoundingClientRect(); const nav = document.querySelector(".bottom-nav"); return { height: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), navTop: nav && getComputedStyle(nav).display !== "none" ? Math.round(nav.getBoundingClientRect().top) : innerHeight, screen: innerHeight }; });
      assert.ok(card.height <= 80, `${label}: the message card is one short row (${card.height}px)`);
      assert.ok(card.bottom <= card.navTop && card.top >= card.screen * 0.55, `${label}: the message card sits low, just above the tab bar (${card.top}-${card.bottom} of ${card.screen}, bar at ${card.navTop})`);
      assert.ok(facts.aboveOrb >= 36, `${label}: the greeting sits clear above the orb, out of its waves (${facts.aboveOrb}px)`);
      assert.ok(facts.belowOrb >= facts.orbW * 0.25 + 16, `${label}: the question sits clear of the orb's waves (${facts.belowOrb}px under a ${Math.round(facts.orbW)}px orb)`);
      assert.ok(facts.aboveCard >= 24, `${label}: the prompts keep their distance from the message card (${facts.aboveCard}px)`);
      assert.ok(facts.orbWidth <= 195 && facts.orbWidth <= facts.screen * 0.43, `${label}: the orb is a modest size (${facts.orbWidth}px on a ${facts.screen}px screen)`);
      assert.ok(facts.overflow <= 0, label + ": nothing widens the page");
      assert.equal(facts.small, 0, label + ": quick prompts are at least 44px tall");
      if (touch) {
        assert.ok(facts.fabVisible && Math.abs(facts.fabCentre - facts.screen / 2) <= 1, `${label}: the tab bar's middle button is centred (${facts.fabCentre})`);
        assert.equal(facts.fabIcon, "#i-mic", label + ": the middle button is a microphone");
        assert.ok(facts.chipScroll && facts.chipOverflowX === "auto", label + ": the quick prompts swipe sideways");
        assert.ok(facts.firstChipLeft >= 12, label + ": the first prompt is not cut off at the edge (" + facts.firstChipLeft + "px)");
      } else {
        assert.equal(facts.fabVisible, false, label + ": a wide screen has no tab bar");
      }

      // "Medium colour": a mid-tone with real colour, and a white glyph that still reads (3:1 for graphics) - on every page.
      const sweep = async (view) => {
        await nav(pageN, view);
        await pageN.waitForTimeout(500);
        return pageN.evaluate(() => {
          const hsl = (hex) => { const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const mx = Math.max(...n), mn = Math.min(...n), l = (mx + mn) / 2, d = mx - mn; const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)); return { s: sat, l }; };
          const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
          const out = [];
          for (const node of document.querySelectorAll(".row-ico, .stat-tile-ico")) {
            if (!node.getClientRects().length || node.closest(".is-off")) continue;
            const hex = getComputedStyle(node).getPropertyValue("--tone").trim();
            if (!/^#[0-9a-f]{6}$/i.test(hex)) { out.push({ bad: "no tone colour on " + node.className }); continue; }
            const { s, l } = hsl(hex);
            out.push({ hex, s, l, contrast: 1.05 / (lum(hex) + 0.05), shadow: getComputedStyle(node).boxShadow });
          }
          return out;
        });
      };
      for (const view of touch ? ["agents", "settings"] : ["agents", "settings", "plans"]) { // Plans is in the phone menu, not its tab bar
        const badges = await sweep(view);
        assert.ok(badges.length >= 3, `${label}/${view}: found its feature icons (${badges.length})`);
        for (const b of badges) {
          if (b.bad) assert.fail(`${label}/${view}: ${b.bad}`);
          assert.ok(b.s >= 0.45 && b.l >= 0.3 && b.l <= 0.68, `${label}/${view}: ${b.hex} is not a medium colour (saturation ${b.s.toFixed(2)}, lightness ${b.l.toFixed(2)})`);
          assert.ok(b.contrast >= 3, `${label}/${view}: a white icon on ${b.hex} reads at only ${b.contrast.toFixed(1)}:1`);
          assert.equal(b.shadow, "none", `${label}/${view}: ${b.hex} still glows`);
        }
        if (view !== "plans") assert.ok(new Set(badges.map((b) => b.hex)).size >= 5, `${label}/${view}: icons use at least five different colours`);
      }
      await ctxN.close();
    }
  });

  await step("Chat: solid headers, readable scrolling code in both themes, one row of labelled icon actions with a confirmation, and a composer that shrinks back after a long message", async () => {
    // One guest account for all four looks (the server allows 60 sign-ups an hour per address, and both suites share it).
    const ctxC = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctxC.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    const pageC = await pageOf(ctxC);
    await mockStream(pageC);
    let first = true;
    for (const [label, viewport, appearance] of [
      ["phone light", { width: 390, height: 844 }, "aurora"],
      ["phone dark", { width: 390, height: 844 }, "dim"],
      ["desktop light", { width: 1280, height: 800 }, "aurora"],
      ["desktop dark", { width: 1280, height: 800 }, "dim"],
    ]) {
      await pageC.setViewportSize(viewport);
      if (first) await pageC.goto(BASE + "/#/chat");
      await pageC.evaluate((a) => localStorage.setItem("zarvis.appearance", a), appearance);
      if (!first) await pageC.reload();
      first = false;
      await pageC.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
      await pageC.waitForSelector("#text-input");
      const idleHeight = await pageC.evaluate(() => Math.round(document.getElementById("text-input").getBoundingClientRect().height));
      await pageC.fill("#text-input", "Please show me a tiny example, and explain it step by step so that I can follow along without any trouble at all, thanks.");
      assert.ok((await pageC.evaluate(() => document.getElementById("text-input").getBoundingClientRect().height)) > idleHeight + 20, label + ": a long message grows the composer");
      await pageC.press("#text-input", "Enter");
      await pageC.waitForSelector(".bubble.assistant .bubble-actions");
      assert.equal(await pageC.evaluate(() => Math.round(document.getElementById("text-input").getBoundingClientRect().height)), idleHeight, label + ": the composer shrinks back once the message is sent");

      await pageC.waitForTimeout(600); // entrance animations settle before anything is measured
      const facts = await pageC.evaluate(() => {
        const rgb = (value) => {
          const n = (value.match(/[\d.]+/g) || []).map(Number);
          const scale = value.startsWith("color(") ? 255 : 1;
          return { r: n[0] * scale, g: n[1] * scale, b: n[2] * scale, a: n.length > 3 ? n[3] : 1 };
        };
        const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
        const pre = document.querySelector("pre.reply-code");
        const code = pre.querySelector("code");
        const buttons = [...document.querySelectorAll(".bubble.assistant .bubble-actions button")];
        const rects = buttons.map((b) => b.getBoundingClientRect());
        const desk = document.getElementById("desk-top");
        return {
          headerAlpha: rgb(getComputedStyle(document.querySelector(".chat-header")).backgroundColor).a,
          deskAlpha: desk && getComputedStyle(desk).display !== "none" ? rgb(getComputedStyle(desk).backgroundColor).a : null,
          codeContrast: contrast(rgb(getComputedStyle(code).color), rgb(getComputedStyle(pre).backgroundColor)),
          codeOverflow: getComputedStyle(pre).overflowX,
          codeScrolls: pre.scrollWidth > pre.clientWidth + 20,
          pageOverflow: document.documentElement.scrollWidth - innerWidth,
          buttons: buttons.length,
          names: buttons.map((b) => b.getAttribute("aria-label")),
          textual: buttons.filter((b) => b.textContent.trim() !== "").length,
          small: rects.filter((r) => r.width < 40 || r.height < 40).map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`),
          rowSpread: Math.max(...rects.map((r) => r.top)) - Math.min(...rects.map((r) => r.top)),
        };
      });
      assert.equal(facts.headerAlpha, 1, label + ": the Chat header is opaque (bubbles scrolling beneath never ghost through)");
      if (facts.deskAlpha !== null) assert.equal(facts.deskAlpha, 1, label + ": the desktop app bar is opaque in Chat");
      assert.ok(facts.codeContrast >= 7, label + ": code contrast " + facts.codeContrast.toFixed(1));
      assert.equal(facts.codeOverflow, "auto", label + ": code scrolls sideways");
      assert.ok(facts.codeScrolls, label + ": the long code line scrolls instead of being cut off");
      assert.ok(facts.pageOverflow <= 0, label + ": a long code line never widens the page (" + facts.pageOverflow + "px)");
      assert.ok(facts.buttons >= 3 && facts.names.every(Boolean), label + ": every reply action is named " + JSON.stringify(facts.names));
      assert.equal(facts.textual, 0, label + ": reply actions are icon-only");
      assert.deepEqual(facts.small, [], label + ": every reply action is at least 40px");
      assert.ok(facts.rowSpread <= 2, label + ": reply actions share one row");

      const copy = pageC.locator('.bubble.assistant .bubble-actions button[aria-label="Copy"]').first();
      await copy.click();
      await pageC.waitForSelector('.bubble.assistant .bubble-actions button[data-done="1"]', { timeout: 2000 });
      assert.equal(await pageC.getAttribute('.bubble.assistant .bubble-actions button[data-done="1"]', "aria-label"), "Copied");
      assert.match(await pageC.evaluate(() => navigator.clipboard.readText()), /tiny example/, label + ": Copy puts the reply text on the clipboard");
      await pageC.waitForSelector('.bubble.assistant .bubble-actions button[data-done]', { state: "detached", timeout: 4000 });
    }
    await ctxC.close();
  });

  await step("Chat: reading back up the thread is never yanked down by a streaming reply, the jump button returns to the newest, and Thinking says what it is doing", async () => {
    const ctxS = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pageS = await pageOf(ctxS);
    await mockStream(pageS);
    await pageS.goto(BASE + "/#/chat");
    await pageS.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    const gap = () => pageS.evaluate(() => Math.round(document.documentElement.scrollHeight - innerHeight - scrollY));
    const lines = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} line ${i + 1} of the answer, long enough to be read.`).join("\n\n");
    for (let i = 1; i <= 3; i++) {
      await pageS.evaluate((text) => { window.__stream.reply = text; }, lines(8, "Earlier " + i));
      await pageS.fill("#text-input", "question " + i);
      await pageS.press("#text-input", "Enter");
      await pageS.waitForFunction((n) => document.querySelectorAll(".bubble.assistant").length >= n, i);
    }
    assert.ok((await gap()) <= 8, "after a reply the thread sits at its bottom (" + (await gap()) + "px)");

    await pageS.evaluate(() => { window.__stream.auto = false; });
    await pageS.fill("#text-input", "stream something long");
    await pageS.press("#text-input", "Enter");
    await pageS.waitForSelector(".bubble.thinking .thinking-label");
    assert.ok((await pageS.textContent(".bubble.thinking .thinking-label")).trim().length > 0, "Thinking is labelled");
    await pageS.evaluate(() => window.__stream.push("meta", { conversationId: "00000000-0000-4000-8000-000000000001", turnId: "live" }));

    // Following: the reader is at the bottom, so growing text keeps them there.
    await pageS.evaluate((text) => window.__stream.push("delta", { text }), lines(6, "Live") + "\n\n");
    await pageS.waitForTimeout(250);
    assert.ok((await gap()) <= 8, "while following, the page stays at the bottom (" + (await gap()) + "px)");

    // Reading back: scrolled up, more text arrives, the page stays where it was.
    await pageS.evaluate(() => window.scrollTo(0, Math.max(0, scrollY - 900)));
    await pageS.waitForTimeout(250);
    const readingAt = await pageS.evaluate(() => Math.round(scrollY));
    await pageS.evaluate((text) => window.__stream.push("delta", { text }), lines(10, "More") + "\n\n");
    await pageS.waitForTimeout(400);
    const after = await pageS.evaluate(() => Math.round(scrollY));
    assert.ok(Math.abs(after - readingAt) <= 2, `streaming moved a reader who scrolled up (${readingAt} → ${after})`);
    assert.equal(await pageS.locator("#scroll-latest").isVisible(), true, "the jump button is offered while reading back");

    await pageS.click("#scroll-latest");
    await pageS.waitForTimeout(350);
    assert.ok((await gap()) <= 8, "the jump button returns to the newest text (" + (await gap()) + "px)");
    assert.equal(await pageS.locator("#scroll-latest").isVisible(), false, "the jump button goes away at the bottom");

    await pageS.evaluate(() => window.__stream.finish("All done."));
    await pageS.waitForSelector(".bubble.assistant .bubble-actions >> nth=3");
    await ctxS.close();
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
    await pageP.evaluate(() => { location.hash = "#/capabilities"; });
    await pageP.waitForSelector("#view-capabilities:not([hidden]) .cap-summary .cap-sum");
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
    await nav(pageN, "work");
    assert.match(await pageN.title(), /^Work · /, "each page sets its own tab title");
    assert.notEqual(await pageN.title(), homeTitle);
    await pageN.goBack();
    await pageN.waitForFunction(() => document.body.dataset.activeView === "chat");
    await pageN.goForward();
    await pageN.waitForFunction(() => document.body.dataset.activeView === "work");
    await pageN.reload();
    await pageN.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    assert.equal(await view(), "work", "a reload keeps the page");
    // Activity has no tab on the phone, but its address still opens it with its own title.
    await pageN.goto(BASE + "/#/activity");
    await pageN.waitForFunction(() => document.body.dataset.activeView === "activity");
    assert.match(await pageN.title(), /^Activity · /);
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

  await step("Moved pages: the old Subscription and Data addresses land on Plans and Privacy & data, and Profile opens the profile", async () => {
    const ctxV = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageV = await pageOf(ctxV);
    await pageV.goto(BASE + "/#/settings/subscription");
    await pageV.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    await pageV.waitForSelector("#view-plans:not([hidden])");
    assert.equal(await pageV.evaluate(() => location.hash), "#/plans", "the address is corrected to the page that opened");
    await pageV.goto(BASE + "/#/settings/data");
    await pageV.waitForSelector('[data-settings-panel="privacy"]:not([hidden])');
    assert.match(await pageV.innerText('[data-settings-panel="privacy"]'), /Stored on the server/);
    assert.equal(await pageV.locator('[data-settings-page="subscription"], [data-settings-page="data"]').count(), 0, "no stub pages are listed");
    await pageV.click(".sidebar .nav-profile");
    assert.equal(await pageV.innerText("#settings-subpage-title"), "Profile", "Profile opens the profile, not the Settings list");
    await ctxV.close();
  });

  await step("Guest sign-out offers 'Link an email' (focus stays inside three buttons, linking opens Account and keeps the session); a signed-in account gets no extra button; Metrics no longer repeats Plan and Credits", async () => {
    const ctxG = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageG = await pageOf(ctxG, { devAccess: true });
    await pageG.goto(BASE + "/#/settings/security");
    await pageG.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    await pageG.waitForFunction(() => localStorage.getItem("zarvis.isGuest") !== "false");
    const token = await ls(pageG, "zarvis.accessToken");
    await pageG.click("#settings-clear-session-btn");
    await pageG.waitForSelector("#confirm-modal:not([hidden])");
    const secondary = pageG.locator("#confirm-modal-secondary");
    assert.equal(await secondary.isVisible(), true);
    assert.equal(await secondary.innerText(), "Link an email");
    assert.match(await pageG.innerText("#confirm-modal-body"), /can't get back into it/);
    // Tab order: Cancel → Link an email → Sign out → back to Cancel; Shift+Tab goes the other way round.
    const focused = () => pageG.evaluate(() => document.activeElement && document.activeElement.id);
    assert.equal(await focused(), "confirm-modal-cancel");
    await pageG.keyboard.press("Tab");
    assert.equal(await focused(), "confirm-modal-secondary");
    await pageG.keyboard.press("Tab");
    assert.equal(await focused(), "confirm-modal-confirm");
    await pageG.keyboard.press("Tab");
    assert.equal(await focused(), "confirm-modal-cancel");
    await pageG.keyboard.press("Shift+Tab");
    assert.equal(await focused(), "confirm-modal-confirm");
    await pageG.click("#confirm-modal-secondary");
    await pageG.waitForSelector('[data-settings-panel="account"]:not([hidden])');
    assert.equal(await pageG.locator("#confirm-modal").isHidden(), true, "the dialog closed");
    assert.equal(await ls(pageG, "zarvis.accessToken"), token, "the session was not touched");
    // Escape and Cancel still leave everything as it was, and the button is gone for the next dialog.
    await pageG.goto(BASE + "/#/settings/security");
    await pageG.click("#settings-clear-session-btn");
    await pageG.keyboard.press("Escape");
    assert.equal(await pageG.locator("#confirm-modal").isHidden(), true);
    assert.equal(await ls(pageG, "zarvis.accessToken"), token);
    await pageG.evaluate(() => localStorage.setItem("zarvis.isGuest", "false")); // what a linked, signed-in account looks like to this dialog
    await pageG.click("#settings-clear-session-btn");
    await pageG.waitForSelector("#confirm-modal:not([hidden])");
    assert.equal(await pageG.locator("#confirm-modal-secondary").isHidden(), true, "no extra button when there is nothing to link");
    await pageG.keyboard.press("Escape");
    // Metrics: no Plan / Credits tiles, one link to Plans & credits.
    await pageG.goto(BASE + "/#/metrics");
    await pageG.waitForSelector("#view-metrics:not([hidden]) #metrics-usage .stat-tile");
    const tiles = await pageG.locator("#metrics-usage .stat-tile-label").allInnerTexts();
    assert.ok(tiles.length >= 6 && !tiles.includes("Plan") && !tiles.includes("Credits"), "tiles: " + tiles.join(", "));
    await pageG.click('#view-metrics [data-go="plans"]');
    await pageG.waitForSelector("#view-plans:not([hidden])");
    await ctxG.close();
  });

  await step("Tasks live in Work: the old #/tasks link opens them, tasks are listed, searched and cancelled there, the badge and the Home and Activity rows count open ones, and the phone tab bar is Home, Work, Chat, Agents, Settings", async () => {
    const ctxT = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageT = await pageOf(ctxT);
    await pageT.goto(BASE + "/#/tasks");
    await pageT.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    await pageT.waitForSelector("#view-work:not([hidden]) #work-panel-tasks:not([hidden])");
    assert.equal(await pageT.getAttribute("#work-tab-tasks", "aria-selected"), "true");
    assert.equal(await pageT.evaluate(() => location.hash), "#/work/tasks", "the old address is corrected");
    assert.match(await pageT.title(), /^Tasks · Work · /);
    await pageT.waitForSelector("#task-list .empty-state");
    assert.match(await pageT.innerText("#task-list"), /No tasks yet/);
    assert.equal(await pageT.locator('.sidebar [data-view="work"]').getAttribute("aria-current"), "page");
    // Two tasks on the server; Refresh lists them and the nav says how many are open.
    await pageT.evaluate(async () => {
      for (const goal of ["Plan the launch day", "Renew the domain"]) {
        await fetch("/api/v1/tasks", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") }, body: JSON.stringify({ goal }) });
      }
    });
    await pageT.click("#tasks-refresh-btn");
    await pageT.waitForSelector("#task-list .task-card");
    assert.equal(await pageT.locator("#task-list .task-card").count(), 2);
    assert.equal(await pageT.locator('.sidebar [data-view="work"]').getAttribute("aria-label"), "Work, 2 open tasks");
    assert.equal(await pageT.locator("#tasks-badge").isVisible(), true);
    // Search narrows the cards and says so when nothing fits.
    await pageT.fill("#tasks-search", "launch");
    assert.equal(await pageT.locator("#task-list .task-card:visible").count(), 1);
    await pageT.fill("#tasks-search", "zzz");
    assert.equal(await pageT.locator("#task-list .task-card:visible").count(), 0);
    assert.equal(await pageT.locator("#tasks-no-match").isVisible(), true);
    await pageT.fill("#tasks-search", "");
    assert.equal(await pageT.locator("#tasks-no-match").isVisible(), false);
    // Cancelling asks first, then changes the status and the count.
    await pageT.locator('#task-list .task-card:has-text("Renew the domain") .task-action-btn.danger').click();
    await pageT.click("#confirm-modal-confirm");
    await pageT.waitForFunction(() => document.querySelector('.sidebar [data-view="work"]').getAttribute("aria-label") === "Work, 1 open task");
    assert.equal(await pageT.locator('#task-list .task-card[data-status="CANCELLED"]').count(), 1);
    // Home and Activity point at the Tasks tab; Activity also lists tasks as entries of its feed.
    await nav(pageT, "home");
    assert.match(await pageT.innerText("#home-tasks"), /1 open task/);
    await pageT.click("#home-tasks");
    await pageT.waitForSelector("#work-panel-tasks:not([hidden])");
    await nav(pageT, "activity");
    await pageT.waitForSelector("#activity-tasks:not([hidden])");
    assert.match(await pageT.innerText("#activity-tasks"), /1 open task/);
    await pageT.click("#activity-tasks");
    await pageT.waitForSelector("#work-panel-tasks:not([hidden])");
    // The "g then t" shortcut and the capability card both lead here too.
    await nav(pageT, "home");
    await pageT.keyboard.press("g");
    await pageT.keyboard.press("t");
    await pageT.waitForSelector("#work-panel-tasks:not([hidden])");
    await pageT.goto(BASE + "/#/capabilities");
    await pageT.waitForSelector("#view-capabilities:not([hidden]) #capability-hub .cap-item");
    await pageT.locator('#capability-hub .cap-item:has(.cap-name:has-text("Tasks")) .cap-action').click();
    await pageT.waitForSelector("#work-panel-tasks:not([hidden])");
    assert.equal(await pageT.locator("#capability-hub").count(), 1);
    assert.equal(await pageT.locator('[data-feature-page="workspace"], [data-feature-page="tasks"]').count(), 0, "the AI Workspace and Tasks & Automation pages are gone");
    await ctxT.close();
    // Phone: the tab bar is Home, Work, Chat, Agents, Settings; Activity stays reachable from the menu.
    const ctxQ = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const pageQ = await pageOf(ctxQ);
    await pageQ.goto(BASE + "/#/home");
    await pageQ.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    const tabs = (await pageQ.locator("#bottom-nav .nav-item:visible").allInnerTexts()).map((t) => t.trim());
    assert.deepEqual(tabs, ["Home", "Work", "Chat", "Agents", "Settings"]);
    await pageQ.click('#bottom-nav [data-view="work"]');
    await pageQ.waitForSelector("#view-work:not([hidden])");
    assert.equal(await pageQ.locator('#bottom-nav [data-view="work"]').getAttribute("aria-current"), "page");
    await pageQ.click("#menu-btn");
    await pageQ.waitForSelector('#sidebar-nav [data-view="activity"]:visible');
    await ctxQ.close();
  });

  await step("First visit: a link straight to a page that loads data (Plans, Activity, a Settings page) opens it, makes one guest account and never says 'session ended'", async () => {
    for (const hash of ["#/plans", "#/activity", "#/settings/memory", "#/chat/00000000-0000-4000-8000-000000000999"]) {
      const ctxF = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const pageF = await pageOf(ctxF);
      let signups = 0;
      pageF.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/auth/guest")) signups++; });
      await pageF.goto(BASE + "/" + hash);
      await pageF.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
      await pageF.waitForTimeout(1500); // the data requests that were waiting for the session have been answered by now
      assert.equal(await pageF.locator("#session-gate").isHidden(), true, hash + ": the 'session ended' gate must not appear for someone who never had a session");
      assert.equal(signups, 1, hash + ": one visit, one guest account");
      assert.equal(await pageF.evaluate(() => localStorage.getItem("zarvis.sessionEnded")), null, hash);
      await ctxF.close();
    }
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

  await step("First paint: light is the default on every device, a saved dark choice is applied before the app script runs; a notch never covers the top bar", async () => {
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
    // Light is the default whatever the device's own setting is; dark only once it was chosen.
    for (const scheme of ["light", "dark", "no-preference"]) {
      const ctxD = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
      const pageD2 = await pageOf(ctxD);
      await pageD2.goto(BASE);
      assert.equal(await pageD2.evaluate(() => document.documentElement.getAttribute("data-appearance")), "aurora", "first visit is light on a " + scheme + " device");
      assert.equal(await pageD2.evaluate(() => document.querySelector('meta[name="theme-color"]').getAttribute("content")), "#f4f3ff", "the browser bar is light on a " + scheme + " device");
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

  await step("Hindi: the main pages are fully in Hindi (only names stay English), and English comes back clean", async () => {
    const ctxH = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctxH.addInitScript(() => { try { localStorage.setItem("zarvis.welcomeDismissed", "1"); localStorage.setItem("zarvis.devAccess", "on"); localStorage.setItem("zarvis.lang", "hi"); } catch {} });
    const pageH = await ctxH.newPage();
    await pageH.goto(BASE);
    await pageH.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    const stray = () => pageH.evaluate(() => {
      const names = /^(ZARVIS|ZARVIS AI|Ctrl K|Pro|PRO|UPI|GitHub|English|AI|Pull request|https:\/\/github\.com\/owner\/repo|ZARVIS AI home)$/;
      const found = [];
      // A line made of " · "-joined parts ("1 chat · 1 खुले कार्य") is read part by part: one translated part must not hide an English one.
      const consider = (text, where) => { for (const part of text.replace(/\s+/g, " ").trim().split(" · ")) { const t = part.trim(); if (t && /[A-Za-z]{3,}/.test(t) && !/[\u0900-\u097F]/.test(t) && !names.test(t)) found.push(where + ": " + t.slice(0, 60)); } };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = walker.nextNode());) { const el = n.parentElement; if (el && !el.closest("script,style,svg,.bubble,[data-user-text]") && el.checkVisibility && el.checkVisibility({ checkVisibilityCSS: true })) consider(n.textContent, "text"); }
      for (const el of document.querySelectorAll("[aria-label],[title],[placeholder]")) {
        if (!el.checkVisibility || !el.checkVisibility({ checkVisibilityCSS: true })) continue;
        for (const a of ["aria-label", "title", "placeholder"]) if (el.getAttribute(a)) consider(el.getAttribute(a), a);
      }
      return found;
    });
    const problems = [];
    const open = async (view) => { await pageH.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), view); await pageH.waitForTimeout(400); };
    for (const view of ["home", "chat", "work", "agents", "activity", "plans", "settings", "developer", "metrics"]) {
      await open(view);
      (await stray()).forEach((x) => problems.push(view + " " + x));
    }
    // Work tabs and an agent page, with a project, a file, a note and a task on the account so their rows are read too.
    const seededProjectId = await pageH.evaluate(async () => {
      const call = (path, body) => fetch("/api/v1" + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") }, body: JSON.stringify(body) }).then((r) => r.json());
      const project = await call("/projects", { name: "Launch", goal: "Ship it", agentId: "research" });
      await call("/notes", { kind: "decision", content: "Use teal", projectId: project.id });
      await call("/files/text", { name: "brief.txt", text: "hello", source: "upload", projectId: project.id });
      await call("/tasks", { goal: "Write the brief", projectId: project.id });
      await call("/tasks", { goal: "Review the draft", steps: ["Read it", "Mark changes"] });
      await call("/projects", { name: "Tax filing", goal: "File returns" }); // a second project, so the search and sort controls show
      return project.id;
    });
    // Home with data (the dashboard) and the task board, read in Hindi too.
    await pageH.evaluate(() => { location.hash = "#/home"; });
    await pageH.reload();
    await pageH.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"));
    await pageH.waitForSelector("#home-dash:not([hidden]) .dash-card");
    await pageH.waitForTimeout(500);
    (await stray()).forEach((x) => problems.push("home dashboard " + x));
    await pageH.evaluate(() => { location.hash = "#/work/tasks"; });
    await pageH.waitForSelector("#tasks-view [data-view=board]");
    await pageH.click("#tasks-view [data-view=board]");
    await pageH.waitForSelector(".task-board");
    (await stray()).forEach((x) => problems.push("tasks board " + x));
    await pageH.click("#tasks-view [data-view=list]");
    const hashes = ["#/work/projects", "#/work/files", "#/work/research", "#/work/tasks", "#/work/outputs", "#/agents/research", "#/agents/developer"];
    hashes.push("#/work/project-" + seededProjectId);
    for (const hash of hashes) {
      await pageH.evaluate((h) => { location.hash = h; }, hash);
      await pageH.waitForTimeout(700);
      (await stray()).forEach((x) => problems.push(hash.replace(/project-[\w-]+/, "project") + " " + x));
    }
    for (const tab of ["chats", "files", "research", "tasks", "decisions", "memory", "activity"]) {
      await pageH.evaluate((t) => document.getElementById("project-tab-" + t).click(), tab);
      await pageH.waitForTimeout(250);
      (await stray()).forEach((x) => problems.push("project/" + tab + " " + x));
    }
    for (const sub of ["account", "voice", "language", "appearance", "ai", "memory", "notifications", "integrations", "privacy", "security", "developer"]) {
      await open("settings");
      await pageH.evaluate((p) => document.querySelector(`[data-settings-page="${p}"]`).click(), sub);
      await pageH.waitForTimeout(300);
      (await stray()).forEach((x) => problems.push("settings/" + sub + " " + x));
    }
    assert.deepEqual([...new Set(problems)], [], "English left on Hindi pages: " + [...new Set(problems)].slice(0, 8).join(" | "));
    // Back to English: nothing Hindi is left behind, and the page title follows.
    await open("settings");
    await pageH.evaluate(() => document.querySelector('[data-settings-page="language"]').click());
    await pageH.evaluate(() => document.querySelector('[data-lang="en"]').click());
    await open("activity");
    assert.equal(await pageH.innerText('.sidebar [data-view="activity"] span'), "Activity");
    assert.match(await pageH.title(), /^Activity · /);
    assert.equal(await pageH.evaluate(() => /[\u0900-\u097F]/.test(document.querySelector("#view-activity").innerText)), false, "no Hindi left on the English Activity page");
    await ctxH.close();
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

/** Replaces the turn stream with a scriptable one. While `window.__stream.auto` is true every turn is answered at once with
 * `window.__stream.reply`; with it off a turn stays open and the test pushes frames with `push(event, data)` and ends it with
 * `finish(text)` - the way a model streams, which route.fulfill cannot do. */
async function mockStream(page) {
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    const enc = new TextEncoder();
    const CID = "00000000-0000-4000-8000-000000000001";
    const frame = (event, data) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const api = (window.__stream = {
      auto: true,
      reply: "Hello! I'm **ZARVIS** - here is a tiny example:\n\n```js\nconst greet = (name) => `Hello, ${name}! This line is deliberately far longer than a phone is wide, so it has to scroll sideways`;\n```\n\nThe `greet` function builds the text.\n\n1. Ask a question\n2. Attach a file",
      controller: null,
      push: (event, data) => api.controller.enqueue(frame(event, data)),
      finish: (text) => { api.push("done", { message: text, toolCalls: [], conversationId: CID, turnId: "live" }); api.controller.close(); },
    });
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (!url.endsWith("/orchestrator/turn-stream")) return realFetch(input, init);
      const headers = { "content-type": "text/event-stream" };
      if (api.auto) {
        const turnId = "t" + Math.random().toString(36).slice(2);
        const body = [frame("meta", { conversationId: CID, turnId }), frame("delta", { text: api.reply }), frame("done", { message: api.reply, toolCalls: [], conversationId: CID, turnId })];
        return Promise.resolve(new Response(new Blob(body), { status: 200, headers }));
      }
      return Promise.resolve(new Response(new ReadableStream({ start(c) { api.controller = c; } }), { status: 200, headers }));
    };
  });
}
