"use strict";
/**
 * Text contrast of the theme tokens, computed from styles.css itself (WCAG 2.x relative luminance). Every text token must
 * reach 4.5:1 on every surface it is drawn on, in the light theme and in dim. A translucent token (glass, soft status
 * backgrounds) is blended over what it sits on first, so the number is the one a reader actually sees.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The custom properties declared in the first top-level rule whose selector is exactly `selector`. */
function tokens(selector) {
  const at = css.indexOf("\n" + selector + " {");
  assert.ok(at >= 0, "no " + selector + " block");
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("\n}", at));
  const out = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

const LIGHT = tokens(":root");
const DIM = { ...LIGHT, ...tokens('[data-appearance="dim"]') };

/** [r, g, b, a] from #rgb, #rrggbb or rgb()/rgba(); undefined for anything else (gradients, var()). */
function parse(value) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  const fn = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/i.exec(value);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])];
  return undefined;
}

function resolve(theme, name) {
  let value = theme[name];
  for (let i = 0; value && i < 5 && /^var\(--([\w-]+)\)$/.test(value); i += 1) value = theme[/^var\(--([\w-]+)\)$/.exec(value)[1]];
  const colour = value && parse(value);
  assert.ok(colour, `--${name} is not a plain colour: ${theme[name]}`);
  return colour;
}

function over(top, bottom) {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour stops of a linear-gradient token. */
function stops(theme, name) {
  const value = theme[name];
  const found = value.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]+\)/gi) || [];
  assert.ok(found.length >= 2, `--${name} has colour stops: ${value}`);
  return found.map(parse);
}

const TEXT = ["text", "text-2", "text-3", "primary"];
const STATUS = ["ok", "warn", "err", "info"];
const WHITE = [255, 255, 255, 1];

for (const [label, theme] of [["light", LIGHT], ["dim", DIM]]) {
  const bg = resolve(theme, "bg");
  const surfaces = {
    bg,
    surface: over(resolve(theme, "surface"), bg),
    "surface-2": over(resolve(theme, "surface-2"), bg),
    "surface-3": over(resolve(theme, "surface-3"), bg),
    "glass over bg": over(resolve(theme, "glass"), bg),
    "nav-bg over bg": over(resolve(theme, "nav-bg"), bg),
  };

  test(`${label}: every text token is at least 4.5:1 on every surface`, () => {
    const failures = [];
    for (const name of TEXT.concat(STATUS)) {
      const fg = resolve(theme, name);
      for (const [surface, colour] of Object.entries(surfaces)) {
        const r = ratio(over(fg, colour), colour);
        if (r < 4.5) failures.push(`--${name} on ${surface}: ${r.toFixed(2)}`);
      }
    }
    assert.deepEqual(failures, []);
  });

  test(`${label}: status text is at least 4.5:1 on its own soft background, and the accent on the accent tint`, () => {
    const failures = [];
    const surface = surfaces.surface;
    for (const name of STATUS) {
      const soft = over(resolve(theme, name + "-soft"), surface);
      const r = ratio(resolve(theme, name), soft);
      if (r < 4.5) failures.push(`--${name} on --${name}-soft: ${r.toFixed(2)}`);
    }
    const tint = over(resolve(theme, "primary-soft"), surface);
    for (const name of ["primary", "text"]) {
      const r = ratio(resolve(theme, name), tint);
      if (r < 4.5) failures.push(`--${name} on --primary-soft: ${r.toFixed(2)}`);
    }
    assert.deepEqual(failures, []);
  });

  test(`${label}: white text on the button gradient and the sent-message bubble is at least 4.5:1 at every stop`, () => {
    const failures = [];
    for (const name of ["grad", "bubble-user"]) {
      for (const stop of stops(theme, name)) {
        const r = ratio(WHITE, over(stop, bg));
        if (r < 4.5) failures.push(`white on --${name} stop rgb(${stop.slice(0, 3).join(",")}): ${r.toFixed(2)}`);
      }
    }
    assert.deepEqual(failures, []);
  });

  test(`${label}: icon accents and the focus ring stand out from the page (3:1, WCAG non-text contrast)`, () => {
    const failures = [];
    for (const name of ["cyan", "blue", "violet", "pink", "primary"]) {
      for (const [surface, colour] of [["bg", bg], ["surface", surfaces.surface]]) {
        const r = ratio(resolve(theme, name), colour);
        if (r < 3) failures.push(`--${name} on ${surface}: ${r.toFixed(2)}`);
      }
    }
    assert.deepEqual(failures, []);
  });
}

test("the two themes really differ: dim is dark, light is light", () => {
  assert.ok(luminance(resolve(LIGHT, "bg")) > 0.8, "light background is light");
  assert.ok(luminance(resolve(DIM, "bg")) < 0.02, "dim background is dark");
  assert.ok(luminance(resolve(DIM, "text")) > 0.8, "dim text is light");
});
