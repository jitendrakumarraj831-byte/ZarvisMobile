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
  const pageA = await ctxA.newPage();
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
  const pageB = await ctxB.newPage();
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
    const replay = await pageA.evaluate(async (cid) =>
      (await fetch("/api/v1/confirmations/" + cid + "/approve", { method: "POST", headers: { authorization: "Bearer " + localStorage.getItem("zarvis.accessToken") } })).status, id);
    assert.equal(replay, 404, "a used confirmation cannot be replayed");
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
    // The 404 is the deliberate confirmation-replay check above; static scripts are checked separately.
    const all = [...errorsA, ...errorsB].filter((e) => !/401 \(Unauthorized\)|404 \(Not Found\)|net::ERR_FAILED|ERR_CERT_AUTHORITY_INVALID/.test(e));
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
