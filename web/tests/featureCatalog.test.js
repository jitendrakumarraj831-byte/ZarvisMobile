const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");

// shared/feature-catalog.json is the one capability catalogue for the website and the Android app. The website embeds a copy
// (scripts/sync-feature-catalog.mjs); Android packages the file itself and checks the same rules in FeatureCatalogDataTest.
const root = join(__dirname, "..", "..");
const shared = JSON.parse(readFileSync(join(root, "shared", "feature-catalog.json"), "utf8"));
const registry = JSON.parse(readFileSync(join(root, "shared", "capability-registry.json"), "utf8"));
global.window = { ZarvisLogic: require("../logic.js") };
require("../feature-pages.js");
const features = global.window.ZarvisFeatures;
const L = global.window.ZarvisLogic;
const STATES = ["WORKING", "PARTIAL", "PLANNED", "UNSUPPORTED"];
const capabilityIds = shared.capabilities.map((capability) => capability.id);

test("the website's embedded catalogue is the shared file, unchanged", () => {
  assert.deepEqual(features.shared, shared, "run: node scripts/sync-feature-catalog.mjs");
  execFileSync(process.execPath, [join(root, "scripts", "sync-feature-catalog.mjs"), "--check"], { stdio: "pipe" });
});

test("ids are unique and every capability sits in exactly one group", () => {
  assert.equal(new Set(capabilityIds).size, capabilityIds.length, "capability ids are unique");
  const grouped = shared.groups.flatMap((group) => group.capabilities);
  assert.deepEqual([...grouped].sort(), [...capabilityIds].sort(), "each capability is in one group, and groups name only real capabilities");
  assert.equal(new Set(grouped).size, grouped.length);
  const pageIds = shared.pages.map((page) => page.id);
  assert.equal(new Set(pageIds).size, pageIds.length, "page ids are unique");
});

test("every capability has an honest state on each platform, and a reason when it is not plainly working", () => {
  for (const capability of shared.capabilities) {
    for (const platform of ["web", "android"]) {
      const state = capability[platform];
      assert.ok(state && STATES.includes(state.status), `${capability.id}.${platform}: ${JSON.stringify(state)}`);
      assert.ok(L.isFeatureStatus(state.status));
      if (state.status === "PARTIAL" || state.status === "UNSUPPORTED") assert.ok(state.note, `${capability.id}.${platform} is ${state.status} and must say why`);
    }
    assert.ok(capability.name && capability.short && capability.desc && capability.icon, capability.id + " has its copy");
  }
});

test("nothing in the Android app is WORKING until a real-device run is recorded", () => {
  for (const capability of shared.capabilities) assert.notEqual(capability.android.status, "WORKING", capability.id);
  for (const page of shared.pages) for (const action of page.phoneActions || []) assert.notEqual(action.android.status, "WORKING", action.title);
});

test("a PLANNED or UNSUPPORTED capability never offers a button that implies it works", () => {
  for (const capability of shared.capabilities) {
    if (capability.web.status === "PLANNED") assert.equal(capability.web.action, undefined, capability.id);
    if (capability.web.status === "UNSUPPORTED" && capability.web.action) assert.ok(["feature", "developer"].includes(capability.web.action.type), `${capability.id}: an unsupported capability only links to its explanation`);
    if (capability.web.status === "PLANNED" && capability.android.status === "PLANNED") assert.equal(capability.detail, undefined, capability.id + " has no detail page to open");
  }
});

test("pages and detail links point at things that exist", () => {
  const pageIds = new Set(shared.pages.map((page) => page.id));
  for (const capability of shared.capabilities) if (capability.detail) assert.ok(pageIds.has(capability.detail), `${capability.id} → ${capability.detail}`);
  for (const page of shared.pages) {
    assert.ok(page.capabilities.length, page.id + " lists its capabilities");
    for (const id of page.capabilities) assert.ok(capabilityIds.includes(id), `${page.id} → ${id}`);
    assert.ok(page.android, page.id + " has Android copy");
    for (const copy of [page.web, page.android].filter(Boolean)) {
      for (const key of ["summary", "what", "why", "start", "permissions", "cta", "action"]) assert.equal(typeof copy[key], "string", `${page.id}.${key}`);
      for (const key of ["how", "canDo", "limits", "examples"]) assert.ok(Array.isArray(copy[key]), `${page.id}.${key}`);
    }
  }
});

test("each phone action names a registry capability that really exists", () => {
  const registryIds = new Set(registry.capabilities.map((capability) => capability.id));
  const actions = shared.pages.flatMap((page) => page.phoneActions || []);
  assert.ok(actions.length >= 10, "the Android app's phone actions are listed");
  for (const action of actions) {
    assert.ok(action.title && action.description && action.example && action.requires, action.title);
    assert.ok(STATES.includes(action.android.status), action.title);
    if (action.android.status !== "WORKING") assert.ok(action.android.note, action.title + " says why it is not Working");
    if (action.capability) assert.ok(registryIds.has(action.capability), `${action.title} → ${action.capability} is in shared/capability-registry.json`);
  }
});

test("the website's hub and detail pages are built from the shared catalogue", () => {
  const items = features.groups.flatMap((group) => group.items);
  assert.deepEqual(items.map((item) => item.id), shared.groups.flatMap((group) => group.capabilities), "same capabilities, same order");
  for (const item of items) {
    const capability = shared.capabilities.find((c) => c.id === item.id);
    assert.equal(item.status[0], capability.web.status, item.id);
    assert.equal(item.status[1], capability.web.note, item.id);
    if (item.feature) assert.ok(features.catalog.some((page) => page.id === item.feature), `${item.id} opens a website detail page`);
  }
  assert.deepEqual(features.catalog.map((page) => page.id), shared.pages.filter((page) => page.web).map((page) => page.id));
  const phone = features.catalog.find((page) => page.id === "phone");
  assert.deepEqual(phone.phoneActions, shared.pages.find((page) => page.id === "phone").phoneActions, "the phone page lists the shared phone actions");
});

test("the website and the Android app agree on what exists only on Android", () => {
  const phone = shared.capabilities.find((c) => c.id === "phone_agent");
  assert.equal(phone.web.status, "UNSUPPORTED");
  assert.notEqual(phone.android.status, "UNSUPPORTED");
  // A capability the website lacks is never sold as working elsewhere without a reason.
  for (const capability of shared.capabilities) {
    if (capability.android.status === "PLANNED" && capability.web.status !== "PLANNED") assert.ok(capability.android.note, capability.id + " says where to use it instead");
  }
});
