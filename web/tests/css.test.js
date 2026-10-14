"use strict";
/**
 * Guards for the design system in styles.css. They read the real files, so a late override layer, a variable nobody
 * defined or a component nobody renders any more fails here instead of showing up as a visual bug.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const web = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(web, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const sources = ["index.html", "app.js", "shell.js", "chat-kit.js", "exec-cards.js", "workspace.js", "feature-pages.js", "logic.js", "i18n.js", "theme-init.js"]
  .map((file) => fs.readFileSync(path.join(web, file), "utf8"))
  .join("\n");

/** Top-level rules (not inside @media) as [selector, body]. */
function topLevelRules(text) {
  const rules = [];
  let depth = 0;
  let start = 0;
  let selector = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) selector = text.slice(start, i).trim();
      depth += 1;
      if (depth === 1) start = i + 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        rules.push([selector, text.slice(start, i)]);
        start = i + 1;
      }
    }
  }
  return rules;
}

test("the theme is defined once: one :root block and one dim block carry the colour tokens", () => {
  const rules = topLevelRules(css);
  for (const selector of [":root", '[data-appearance="dim"]']) {
    const withColours = rules.filter(([sel, body]) => sel === selector && /--bg\s*:/.test(body));
    assert.equal(withColours.length, 1, `${selector} must define the theme tokens exactly once (found ${withColours.length}); add a token to the Tokens block, not a later override`);
  }
  // No other top-level block may redefine a theme colour for either theme.
  const THEME = ["--bg", "--surface", "--surface-2", "--surface-3", "--text", "--text-2", "--text-3", "--line", "--line-2", "--primary", "--card-bg", "--card-border", "--card-shadow"];
  const first = rules.find(([sel, body]) => sel === ":root" && /--bg\s*:/.test(body));
  const dim = rules.find(([sel, body]) => sel === '[data-appearance="dim"]' && /--bg\s*:/.test(body));
  for (const [selector, body] of rules) {
    if ([first, dim].some((r) => r && r[0] === selector && r[1] === body)) continue;
    if (selector !== ":root" && !selector.startsWith('[data-appearance="dim"]') ) continue;
    if (selector.startsWith('[data-appearance="dim"] ')) continue; // a rule for something inside the dim theme, not a token block
    for (const name of THEME) assert.ok(!new RegExp(`${name}\\s*:`).test(body), `${selector} redefines ${name} outside the Tokens block`);
  }
});

test("every var(--token) in the stylesheet is defined, or set on the element that uses it, or has a fallback", () => {
  const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const bare = [...css.matchAll(/var\((--[\w-]+)\s*\)/g)].map((m) => m[1]);
  const missing = [...new Set(bare)].filter((name) => !defined.has(name) && !sources.includes(`"${name}"`) && !sources.includes(`'${name}'`));
  assert.deepEqual(missing, [], "used but never defined: " + missing.join(", "));
});

test("no theme token is defined that nothing uses (the type scale is the one documented exception)", () => {
  const defined = [...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]);
  const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  const scale = /^--fs-/; // a type scale is offered whole, even where a step is not used yet
  const unused = [...new Set(defined)].filter((name) => !used.has(name) && !scale.test(name) && !sources.includes(name));
  assert.deepEqual(unused, [], "defined but unused: " + unused.join(", "));
});

test("every class the stylesheet styles is rendered by some page, or is built from a name the code assembles", () => {
  const classes = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  // Names assembled at run time: reply-h1..3 (logic.js formatReplyHtml) and the syntax colours tok-<kind>.
  const assembled = (name) => /^reply-h[123]$/.test(name) || /^tok-(com|str|num|kw|lit|tag|attr)$/.test(name);
  // A class name is made of [\w-] only, so "appears with a non-[\w-] character on both sides" is the same as "is one whole
  // [\w-]+ token of the sources". A token set says that without building a regular expression from the name.
  const tokens = new Set(sources.match(/[\w-]+/g));
  const dead = [...classes].filter((name) => {
    if (assembled(name)) return false;
    if (tokens.has(name)) return false;
    const parts = name.split("-");
    for (let i = 1; i < parts.length; i += 1) {
      const prefix = parts.slice(0, i).join("-") + "-";
      if (sources.includes(prefix + "${") || sources.includes(prefix + '" +') || sources.includes(prefix + "' +") || sources.includes(prefix + "`")) return false;
    }
    return true;
  });
  assert.deepEqual(dead, [], "styled but never rendered (delete the rule): " + dead.join(" "));
});

test("braces balance, and the file ends inside no rule", () => {
  let depth = 0;
  for (const ch of css) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    assert.ok(depth >= 0, "a } with no {");
  }
  assert.equal(depth, 0);
});
