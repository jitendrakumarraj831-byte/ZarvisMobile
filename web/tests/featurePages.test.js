const test = require("node:test");
const assert = require("node:assert/strict");

// feature-pages.js is a browser script: it hangs its catalogue on window and only touches the DOM when asked to render.
global.window = { ZarvisLogic: require("../logic.js") };
require("../feature-pages.js");
const { groups, catalog, STATUS_TONE } = global.window.ZarvisFeatures;
const L = global.window.ZarvisLogic;
const items = groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.title })));

test("every capability in the hub carries exactly one of the four honest states", () => {
  assert.ok(items.length >= 15, "the hub lists the capabilities (" + items.length + ")");
  for (const item of items) {
    assert.ok(Array.isArray(item.status) && L.isFeatureStatus(item.status[0]), `${item.name}: status ${JSON.stringify(item.status)}`);
    assert.ok(STATUS_TONE[item.status[0]], `${item.name}: a badge colour for ${item.status[0]}`);
  }
  assert.deepEqual(new Set(items.map((item) => item.status[0])), new Set(["WORKING", "PARTIAL", "PLANNED", "UNSUPPORTED"]), "all four words are really used");
});

test("a capability that depends on something says what it depends on", () => {
  for (const item of items.filter((i) => i.status[0] === "PARTIAL")) assert.ok(item.status[1], `${item.name} is PARTIAL and must say why`);
  for (const item of items.filter((i) => i.status[0] === "UNSUPPORTED")) assert.ok(item.status[1], `${item.name} is UNSUPPORTED and must say why`);
});

test("Android-only actions are UNSUPPORTED on the web, never WORKING", () => {
  const phone = items.find((item) => item.name === "Phone Agent");
  assert.ok(phone, "Phone Agent is listed");
  assert.equal(phone.status[0], "UNSUPPORTED");
  assert.match(phone.desc, /Android/);
  for (const item of items) if (/android-only|android app only/i.test(item.desc + " " + (item.status[1] || ""))) assert.equal(item.status[0], "UNSUPPORTED", item.name);
});

test("things that are designed but not active are PLANNED and offer no action", () => {
  for (const item of items.filter((i) => i.status[0] === "PLANNED")) assert.equal(item.action, undefined, `${item.name} is PLANNED so it has no button that implies it works`);
});

test("WORKING and PARTIAL capabilities have a real route: a chat, a page, a setting, a picker or a detail page", () => {
  const pages = ["work", "agents", "activity", "plans", "settings", "developer", "metrics", "capabilities", "tasks", "home", "chat"];
  for (const item of items.filter((i) => ["WORKING", "PARTIAL"].includes(i.status[0]))) {
    assert.ok(item.action, `${item.name} has an action`);
    assert.ok(["chat", "voice", "attach", "developer", "settings", "feature", "page"].includes(item.action[0]), `${item.name}: action ${item.action[0]}`);
    if (item.action[0] === "page") assert.ok(pages.includes(item.page), `${item.name}: page ${item.page}`);
    if (item.feature) assert.ok(catalog.some((c) => c.id === item.feature), `${item.name}: detail page ${item.feature} exists`);
  }
});

test("the hub never claims background work or live results it does not have", () => {
  const text = items.map((item) => item.desc + " " + (item.status[1] || "")).join("\n");
  assert.ok(!/runs? in the background automatically|always listening|wake word is supported/i.test(text));
  const tasks = items.find((item) => item.name === "Tasks");
  assert.match(tasks.desc, /nothing runs in the background/i);
  const tests = items.find((item) => item.name === "Running tests");
  assert.equal(tests.status[0], "UNSUPPORTED");
});

test("capability names are unique", () => {
  const names = items.map((item) => item.name);
  assert.equal(new Set(names).size, names.length);
});

test("the status words shown to people match the product's wording", () => {
  assert.equal(L.capabilityStatusLabel("WORKING"), "Working");
  assert.equal(L.capabilityStatusLabel("PARTIAL"), "Partial");
  assert.equal(L.capabilityStatusLabel("PLANNED"), "Planned");
  assert.equal(L.capabilityStatusLabel("UNSUPPORTED"), "Unsupported");
});
