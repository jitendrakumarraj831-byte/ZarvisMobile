"use strict";
/**
 * theme-init.js runs in <head> before the first paint. It is plain browser script, so it is run here inside a stub browser:
 * what it puts on <html> (data-appearance, data-perf) and what window.ZarvisPerf does afterwards is what the page gets.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "theme-init.js"), "utf8");

/** A stub browser: [storage] is what localStorage holds, [nav] is navigator, [reducedData] is the (prefers-reduced-data) query. */
function runInit({ storage = {}, nav = {}, reducedData = false, throwingStorage = false } = {}) {
  const attributes = {};
  const metas = [{ attrs: { media: "(prefers-color-scheme: dark)", content: "#000" }, removeAttribute(n) { delete this.attrs[n]; }, setAttribute(n, v) { this.attrs[n] = v; } }];
  const listeners = [];
  const appended = [];
  const connection = nav.connection ? { ...nav.connection, addEventListener: (type, fn) => listeners.push([type, fn]) } : undefined;
  const sandbox = {
    document: {
      documentElement: {
        setAttribute: (name, value) => { attributes[name] = value; },
        removeAttribute: (name) => { delete attributes[name]; },
      },
      querySelectorAll: () => metas,
      createElement: () => ({ attrs: {}, setAttribute(n, v) { this.attrs[n] = v; } }),
      head: { appendChild: (node) => appended.push(node) },
    },
    localStorage: throwingStorage
      ? { getItem() { throw new Error("blocked"); } }
      : { getItem: (key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null) },
    navigator: { ...nav, connection },
    matchMedia: (query) => ({ matches: reducedData && /prefers-reduced-data/.test(query) }),
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  return { attributes, metas, listeners, appended, window: sandbox, storage };
}

test("the saved theme is applied before first paint, and light is the default", () => {
  assert.equal(runInit().attributes["data-appearance"], "aurora");
  const dim = runInit({ storage: { "zarvis.appearance": "dim" } });
  assert.equal(dim.attributes["data-appearance"], "dim");
  assert.equal(dim.metas[0].attrs.content, "#0a0d24");
  assert.equal("media" in dim.metas[0].attrs, false, "the theme-color meta no longer follows the system theme");
});

test("blocked storage never stops the page: light theme, automatic performance", () => {
  const run = runInit({ throwingStorage: true });
  assert.equal(run.attributes["data-appearance"], "aurora");
  assert.equal("data-perf" in run.attributes, false);
});

test("auto mode stays full on a normal device and connection", () => {
  assert.equal("data-perf" in runInit().attributes, false);
  assert.equal("data-perf" in runInit({ nav: { deviceMemory: 8, connection: { effectiveType: "4g", saveData: false } } }).attributes, false);
});

test("auto mode goes lightweight for Save-Data, a 2G/3G link, 2 GB of memory or reduced data", () => {
  assert.equal(runInit({ nav: { connection: { saveData: true } } }).attributes["data-perf"], "lite");
  for (const effectiveType of ["slow-2g", "2g", "3g"]) {
    assert.equal(runInit({ nav: { connection: { effectiveType } } }).attributes["data-perf"], "lite", effectiveType);
  }
  assert.equal(runInit({ nav: { deviceMemory: 2 } }).attributes["data-perf"], "lite");
  assert.equal(runInit({ nav: { deviceMemory: 0.5 } }).attributes["data-perf"], "lite");
  assert.equal("data-perf" in runInit({ nav: { deviceMemory: 4 } }).attributes, false);
  assert.equal(runInit({ reducedData: true }).attributes["data-perf"], "lite");
});

test("an explicit choice wins over whatever the device reports", () => {
  const slow = { connection: { saveData: true, effectiveType: "2g" }, deviceMemory: 1 };
  assert.equal("data-perf" in runInit({ storage: { "zarvis.perf": "full" }, nav: slow }).attributes, false, "full beats a slow device");
  assert.equal(runInit({ storage: { "zarvis.perf": "lite" }, nav: { deviceMemory: 8 } }).attributes["data-perf"], "lite", "lite beats a fast device");
  assert.equal(runInit({ storage: { "zarvis.perf": "nonsense" }, nav: slow }).attributes["data-perf"], "lite", "an unknown value means auto");
});

test("window.ZarvisPerf.apply switches the mode live and reports it", () => {
  const run = runInit({ nav: { deviceMemory: 8 } });
  assert.equal(run.window.ZarvisPerf.apply("lite"), true);
  assert.equal(run.attributes["data-perf"], "lite");
  assert.equal(run.window.ZarvisPerf.apply("full"), false);
  assert.equal("data-perf" in run.attributes, false);
  assert.equal(run.window.ZarvisPerf.apply("auto"), false, "auto on a fast device is full");
});

test("a connection change re-evaluates only while the choice is auto", () => {
  const storage = {};
  const nav = { connection: { effectiveType: "4g" } };
  const run = runInit({ storage, nav });
  assert.equal(run.listeners.length, 1);
  assert.equal(run.listeners[0][0], "change");
  assert.equal("data-perf" in run.attributes, false);
  // The link drops to 3G while the choice is auto: the handler re-reads navigator.connection.
  run.window.navigator.connection.effectiveType = "3g";
  run.listeners[0][1]();
  assert.equal(run.attributes["data-perf"], "lite");
  // A person who chose "full" is not overridden by the link.
  storage["zarvis.perf"] = "full";
  run.window.ZarvisPerf.apply("full");
  run.listeners[0][1]();
  assert.equal("data-perf" in run.attributes, false);
});

test("the Hindi dictionary is fetched early only when Hindi is the saved language", () => {
  assert.equal(runInit().appended.length, 0, "English readers never download it");
  assert.equal(runInit({ storage: { "zarvis.lang": "en" } }).appended.length, 0);
  const hindi = runInit({ storage: { "zarvis.lang": "hi" } });
  assert.equal(hindi.appended.length, 1);
  assert.equal(hindi.appended[0].src, "./i18n.js");
  assert.equal(hindi.appended[0].async, true);
  assert.equal("data-i18n" in hindi.appended[0].attrs, true, "app.js finds this tag and waits on it instead of fetching twice");
  assert.equal(runInit({ throwingStorage: true }).appended.length, 0);
});
