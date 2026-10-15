/* Browser E2E for "Take a photo" in the Chat composer (real Chromium with a simulated camera).
 *
 *   ZARVIS_URL=http://localhost:3100 node web/e2e/camera.e2e.cjs
 *
 * Needs Playwright and axe-core (see .github/workflows/backend-tests.yml). Chromium is started with a fake
 * camera (a moving test pattern) and the permission prompt answered, so the whole flow runs without hardware.
 * The server's /documents/extract answer is stubbed: this suite is about the browser side (the camera opens,
 * a JPEG is taken and sent, the camera is switched off, every refusal is said plainly). The server side of
 * image description is covered by backend/test.
 *
 * What it can NOT show: that a real phone's camera works. That stays unverified (see the capability registry).
 */
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

/** A page whose welcome card is already dismissed (it would sit over the composer). */
async function pageOf(ctx, extraInit) {
  await ctx.addInitScript(() => {
    try { localStorage.setItem("zarvis.welcomeDismissed", "1"); } catch {}
  });
  if (extraInit) await ctx.addInitScript(extraInit);
  return ctx.newPage();
}

async function ready(page) {
  await page.goto(BASE);
  await page.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"), null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector("#orb")?.dataset.state === "IDLE", null, { timeout: 15000 });
  await page.evaluate(() => document.querySelector('[data-view="chat"]')?.click());
  await page.waitForSelector("#camera-btn", { state: "visible", timeout: 10000 });
}

/** Answers /documents/extract and remembers what was sent. */
async function stubExtract(page, text = "A green and pink test pattern.") {
  const sent = [];
  await page.route("**/api/v1/documents/extract", (route) => {
    sent.push({ type: route.request().headers()["content-type"] || "", body: route.request().postDataBuffer() });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text, kind: "image" }) });
  });
  return sent;
}

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });

  await step("camera: Take a photo shows the live camera, and Take photo attaches a JPEG that is sent to be described", async () => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, permissions: ["camera"] });
    const page = await pageOf(ctx);
    const sent = await stubExtract(page);
    await ready(page);
    assert.equal(await page.locator("#camera-sheet").isHidden(), true, "the camera is off until it is asked for");
    await page.click("#camera-btn");
    await page.waitForSelector("#camera-sheet:not([hidden])");
    await page.waitForFunction(() => { const v = document.querySelector("#camera-video"); return v && v.videoWidth > 0 && v.readyState >= 2; }, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => !!document.querySelector("#camera-video").srcObject), true, "the live picture is shown");
    await page.click("#camera-shoot");
    await page.waitForSelector("#camera-sheet", { state: "hidden" });
    await page.waitForFunction(() => /^photo-.*\.jpg$/.test(document.querySelector("#attachment-name")?.textContent || ""), null, { timeout: 15000 });
    await page.waitForFunction(() => /ready/i.test(document.querySelector("#attachment-status")?.textContent || ""), null, { timeout: 15000 });
    assert.equal(sent.length, 1, "exactly one photo was sent");
    assert.match(sent[0].type, /^multipart\/form-data/);
    assert.ok(sent[0].body.includes(Buffer.from('filename="photo-')), "the file is named photo-….jpg");
    assert.ok(sent[0].body.includes(Buffer.from("image/jpeg")), "it is sent as a JPEG");
    assert.ok(sent[0].body.includes(JPEG_MAGIC), "the bytes are a JPEG");
    assert.ok(sent[0].body.length < 3_500_000, `the photo is small enough for the server (${sent[0].body.length} bytes)`);
    assert.equal(await page.evaluate(() => document.querySelector("#camera-video").srcObject), null, "the camera is switched off after the photo");
    await ctx.close();
  });

  await step("camera: Cancel and Escape close it, switch the camera off, and send nothing", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ["camera"] });
    const page = await pageOf(ctx);
    const sent = await stubExtract(page);
    await ready(page);
    for (const how of ["cancel", "escape"]) {
      await page.click("#camera-btn");
      await page.waitForSelector("#camera-sheet:not([hidden])");
      await page.waitForFunction(() => document.querySelector("#camera-video")?.srcObject);
      await page.evaluate(() => { window.__tracks = document.querySelector("#camera-video").srcObject.getTracks(); });
      if (how === "cancel") await page.click("#camera-cancel");
      else await page.keyboard.press("Escape");
      await page.waitForSelector("#camera-sheet", { state: "hidden" });
      const states = await page.evaluate(() => window.__tracks.map((t) => t.readyState));
      assert.deepEqual([...new Set(states)], ["ended"], `${how}: every camera track was stopped (${states})`);
    }
    assert.equal(sent.length, 0, "nothing was sent");
    assert.equal(await page.evaluate(() => document.querySelector("#attachment-chip").hidden), true, "nothing was attached");
    await ctx.close();
  });

  await step("camera: Cancel pressed while the photo is being made sends nothing, and Escape works with focus on the page behind", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ["camera"] });
    const page = await pageOf(ctx);
    const sent = await stubExtract(page);
    await ready(page);
    // Make JPEG encoding slow, so there is a moment between Take photo and the photo existing.
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, ...rest) { setTimeout(() => original.call(this, callback, ...rest), 600); };
    });
    await page.click("#camera-btn");
    await page.waitForSelector("#camera-sheet:not([hidden])");
    await page.waitForFunction(() => { const v = document.querySelector("#camera-video"); return v && v.videoWidth > 0 && v.readyState >= 2; }, null, { timeout: 15000 });
    await page.click("#camera-shoot");
    await page.click("#camera-cancel");
    await page.waitForSelector("#camera-sheet", { state: "hidden" });
    await page.waitForTimeout(1200);
    assert.equal(sent.length, 0, "a photo whose Cancel came first is not sent");
    assert.equal(await page.evaluate(() => document.querySelector("#attachment-chip").hidden), true, "and is not attached");

    await page.click("#camera-btn");
    await page.waitForSelector("#camera-sheet:not([hidden])");
    await page.waitForFunction(() => document.querySelector("#camera-video")?.srcObject);
    await page.evaluate(() => { window.__tracks = document.querySelector("#camera-video").srcObject.getTracks(); document.activeElement && document.activeElement.blur(); });
    await page.keyboard.press("Escape");
    await page.waitForSelector("#camera-sheet", { state: "hidden" });
    const states = await page.evaluate(() => window.__tracks.map((t) => t.readyState));
    assert.deepEqual([...new Set(states)], ["ended"], `Escape from the page behind the sheet stops the camera (${states})`);
    await ctx.close();
  });

  await step("camera: the preview shows the whole frame that is sent", async () => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, permissions: ["camera"] });
    const page = await pageOf(ctx);
    await stubExtract(page);
    await ready(page);
    await page.click("#camera-btn");
    await page.waitForSelector("#camera-sheet:not([hidden])");
    const fit = await page.evaluate(() => getComputedStyle(document.querySelector("#camera-video")).objectFit);
    assert.equal(fit, "contain", "object-fit: contain, so no part of the sent frame is cropped out of the preview");
    await ctx.close();
  });

  await step("camera: opens and closes from the keyboard, focus goes in and comes back, and the sheet has no serious axe violation", async () => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, permissions: ["camera"] });
    const page = await pageOf(ctx);
    await stubExtract(page);
    await ready(page);
    await page.focus("#camera-btn");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#camera-sheet:not([hidden])");
    await page.waitForFunction(() => document.querySelector("#camera-video")?.videoWidth > 0, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => !!document.activeElement.closest("#camera-sheet")), true, "focus moved into the sheet");
    assert.equal(await page.evaluate(() => document.querySelector("#camera-sheet [role=dialog]")?.getAttribute("aria-modal")), "true");
    await page.evaluate(AXE_SOURCE);
    const violations = await page.evaluate(async () => {
      const r = await window.axe.run(document.querySelector("#camera-sheet"), { resultTypes: ["violations"] });
      return r.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    });
    assert.deepEqual(violations, []);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#camera-sheet", { state: "hidden" });
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "camera-btn", "focus came back to the camera button");
    await ctx.close();
  });

  await step("camera: a blocked camera is explained, and a photo file can be chosen instead", async () => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
    const page = await pageOf(ctx, () => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    });
    const sent = await stubExtract(page);
    await ready(page);
    await page.click("#camera-btn");
    await page.waitForSelector("#camera-error:not([hidden])");
    const message = await page.textContent("#camera-error");
    assert.match(message, /blocked|denied|allow/i, `the message says what happened (${message})`);
    assert.equal(await page.locator("#camera-shoot").isDisabled(), true, "there is nothing to photograph");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#camera-choose")]);
    await chooser.setFiles({ name: "from-gallery.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") });
    await page.waitForSelector("#camera-sheet", { state: "hidden" });
    await page.waitForFunction(() => document.querySelector("#attachment-name")?.textContent === "from-gallery.png", null, { timeout: 10000 });
    assert.equal(sent.length, 1);
    await ctx.close();
  });

  await step("camera: with no camera access at all (an insecure page, an old browser) the button opens the phone's own camera", async () => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
    const page = await pageOf(ctx, () => {
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    });
    await stubExtract(page);
    await ready(page);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#camera-btn")]);
    assert.equal(chooser.isMultiple(), false);
    const capture = await chooser.element().getAttribute("capture");
    assert.ok(capture !== null, "the file picker asks the phone for its camera (capture attribute)");
    assert.equal(await page.locator("#camera-sheet").isHidden(), true, "no empty camera window is shown");
    await ctx.close();
  });

  await browser.close();
  const failed = results.filter(([status]) => status === "FAIL").length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
