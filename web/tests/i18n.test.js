const test = require("node:test");
const assert = require("node:assert/strict");
const { translate, entries, patterns } = require("../i18n.js");

test("known strings come back in Hindi and keep their surrounding whitespace", () => {
  assert.equal(translate("Activity", "hi"), "गतिविधि");
  assert.equal(translate("  Activity \n", "hi"), "  गतिविधि \n");
  assert.equal(translate("Tasks   record steps\nand status.", "hi"), "Tasks   record steps\nand status."); // only exact strings are translated
});

test("English, unknown text and non-strings pass through untouched", () => {
  assert.equal(translate("Activity", "en"), "Activity");
  assert.equal(translate("Plan launch checklist", "hi"), "Plan launch checklist"); // a user's own words
  assert.equal(translate("", "hi"), "");
  assert.equal(translate(null, "hi"), null);
});

test("strings with a changing part are translated by pattern", () => {
  assert.equal(translate("Ends 21 Oct", "hi"), "समाप्त: 21 Oct");
  assert.equal(translate("Save 17%", "hi"), "17% बचाएँ");
  assert.equal(translate("Go to Settings", "hi"), "Settings पर जाएँ");
  assert.ok(patterns.length >= 3);
});

test("dictionary hygiene: keys are tidy, nothing is empty or left identical", () => {
  const keys = Object.keys(entries);
  assert.ok(keys.length > 300, "expected a few hundred entries, got " + keys.length);
  for (const key of keys) {
    assert.equal(key, key.replace(/\s+/g, " ").trim(), "key is not normalised: " + JSON.stringify(key));
    assert.ok(entries[key].trim(), "empty translation for " + key);
    assert.notEqual(entries[key], key, "translation equals the English for " + key);
  }
});

test("every translation is Devanagari, or one of the few names that stay as written", () => {
  const stays = new Set(["Pro", "Pull request", "PRO · मंज़ूरी"]);
  for (const [key, value] of Object.entries(entries)) {
    if (/[ऀ-ॿ]/.test(value)) continue;
    assert.ok(stays.has(value), "no Hindi in the translation of " + JSON.stringify(key) + ": " + value);
  }
});

test("a translation keeps the names and numbers of its English", () => {
  const tokens = ["ZARVIS", "GitHub", "Gemini", "Android", "Razorpay", "UPI", "INR", "PDF", "PRO", "Ctrl K", "README", "TTS", "Google", "AI"];
  for (const [key, value] of Object.entries(entries)) {
    for (const token of tokens) {
      if (new RegExp("(^|[^A-Za-z])" + token + "([^A-Za-z]|$)").test(key)) assert.ok(value.includes(token), `${token} is missing from the translation of ${JSON.stringify(key)}`);
    }
    for (const number of key.match(/\d[\d,]*/g) || []) assert.ok(value.includes(number), `${number} is missing from the translation of ${JSON.stringify(key)}`);
  }
});
