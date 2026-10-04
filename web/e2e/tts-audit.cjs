/**
 * Spoken-reply audit: the real web client, in a real Chromium, against any running ZARVIS backend,
 * a local one or a deployed Vercel preview:
 *
 *   ZARVIS_URL=https://…vercel.app [BYPASS=<Vercel protection bypass>] node web/e2e/tts-audit.cjs
 *
 * What is real: the page, its audio engine (AudioContext scheduling, the Listen button's <audio>),
 * the TTS endpoints, the voice behind them and the audio they return. What is stubbed: only the
 * AI answer (a fixed reply per scenario, so the language and the length are known and a spent AI
 * quota cannot hide a voice problem). `AUDIT_REAL_AI=1` adds one scenario with a real AI answer.
 *
 * It answers, one PASS / FAIL / WARN line each: does an English, a Hindi and a Hinglish reply come
 * back as audio in the right voice; does a long reply stream in order, two requests at a time, with
 * no overlap; does Stop silence it and start nothing new; does a new message (typed, or spoken)
 * cancel the reply being spoken; does the Listen button (the WAV endpoint) play; and when the voice
 * fails, does the AI's reply still appear and the next one still work.
 *
 * Environment:
 *   ZARVIS_URL / BASE_URL   the deployment (default http://localhost:3100)
 *   BYPASS                  Vercel Deployment Protection bypass secret; sent only to that origin
 *   EXPECT_HI_VOICE, EXPECT_EN_VOICE, EXPECT_HINGLISH_VOICE
 *                           the voices the deployment is configured with (defaults: the built-in ones)
 *   AUDIT_FAILURES          intercept (default): the browser makes the TTS endpoints fail
 *                           natural: nothing is intercepted, the server's own voice is failing, and only
 *                           the failure scenario runs (a failing server cannot pass the others)
 *                           skip: no failure scenarios
 *   AUDIT_REAL_AI=1        one extra scenario with a real AI answer (WARN if the AI has no quota)
 *   AUDIT_ONLY             a regular expression: run only the scenarios whose name matches
 *   AUDIT_LIVE=0|1         force the "deployed site" behaviour (audio length checks, longer waits) off or on
 *   AUDIT_SLOW_STARTUP_MS  delay the page's two start-up requests (skills, tasks) by this long, as a cold serverless
 *                          function would: a turn that starts before start-up ends must still keep its state
 *
 * Against anything but localhost it also checks that the audio is as long as the text says it should
 * be (a voice that answers 200 with a second of noise is not a pass). The account each scenario
 * uses is a guest account, deleted afterwards. No token or secret is ever printed.
 *
 * Needs Playwright (+ Chromium), resolved like the other e2e scripts: local, then global.
 */
"use strict";
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

const BASE = (process.env.ZARVIS_URL || process.env.BASE_URL || "http://localhost:3100").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const BYPASS = process.env.BYPASS || "";
const LIVE = process.env.AUDIT_LIVE ? process.env.AUDIT_LIVE === "1" : !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(BASE).hostname);
const FAILURES = process.env.AUDIT_FAILURES || "intercept";
const REAL_AI = process.env.AUDIT_REAL_AI === "1";
const ONLY = process.env.AUDIT_ONLY ? new RegExp(process.env.AUDIT_ONLY, "i") : null;
const SLOW_STARTUP_MS = Number(process.env.AUDIT_SLOW_STARTUP_MS || 0);
const EXPECT = {
  hi: process.env.EXPECT_HI_VOICE || "hi-IN-SwaraNeural",
  en: process.env.EXPECT_EN_VOICE || "en-US-JennyNeural",
  hinglish: process.env.EXPECT_HINGLISH_VOICE || process.env.EXPECT_HI_VOICE || "hi-IN-SwaraNeural",
};

// One sentence per streamed piece of the reply, each longer than the 220 characters at which the web
// client asks for a sentence's audio, so a reply of N sentences is N separate voice requests.
const SENTENCES = {
  en: [
    "This is the first part of a long answer, written in plain English with ordinary words, so that the voice has something real to say for a while before the sentence finally comes to an end, and the speech keeps a steady pace, and nothing is hurried. ",
    "Here is the second part, which also runs on for a good number of words, so that it becomes its own separate piece of speech and the browser has to ask the server for it on its own, while the first part is still playing, and nothing is hurried. ",
    "The third part follows in the same way, with enough words in it to be spoken as one more request while the previous part is still playing out loud for the person who is listening, without any gap or overlap between them, and nothing is hurried. ",
    "And this is the last part of the answer, finished off with a short closing remark about how the weather looks today in the city, which is clear, calm and quite pleasant, so a walk before the evening would be a good idea, and nothing is hurried. ",
  ],
  hi: [
    "यह एक लंबे जवाब का पहला हिस्सा है, जो साधारण हिंदी शब्दों में लिखा गया है, ताकि आवाज़ को कुछ देर तक बोलने के लिए असली सामग्री मिले और वाक्य अपने अंत तक पहुँचने से पहले चलता रहे, और सुनने वाले को हर शब्द साफ़ सुनाई दे, और सब कुछ बिना किसी जल्दबाज़ी के आराम से कहा जाए। ",
    "यह दूसरा हिस्सा है, जो काफ़ी शब्दों तक चलता है ताकि यह बोले जाने का अपना अलग टुकड़ा बने, और ब्राउज़र को इसके लिए सर्वर से अलग से माँग करनी पड़े, जबकि पिछला हिस्सा अभी बज रहा हो और सब कुछ ठीक क्रम में चले, और सब कुछ बिना किसी जल्दबाज़ी के आराम से कहा जाए। ",
    "तीसरा हिस्सा भी उसी तरह आता है, इसमें इतने शब्द हैं कि इसे एक और अनुरोध की तरह बोला जा सके, जबकि सुनने वाले के लिए पिछला हिस्सा अभी ऊँची आवाज़ में चल रहा है और बीच में कोई रुकावट या दोहराव न आए, और सब कुछ बिना किसी जल्दबाज़ी के आराम से कहा जाए। ",
    "और यह जवाब का आख़िरी हिस्सा है, जिसे आज शहर के मौसम के बारे में एक छोटी सी बात के साथ पूरा किया गया है, जो साफ़, शांत और काफ़ी सुहावना है, इसलिए आप चाहें तो शाम से पहले बाहर टहलने जा सकते हैं, और सब कुछ बिना किसी जल्दबाज़ी के आराम से कहा जाए। ",
  ],
  hinglish: [
    "Yeh ek lambe jawab ka pehla hissa hai, jo saadhaaran Hinglish mein likha gaya hai, taaki awaaz ko kuch der tak bolne ke liye asli saamagri mile aur vaakya apne ant tak pahunchne se pehle chalta rahe, aur sunne wale ko saaf sunaai de. ",
    "Yeh doosra hissa hai, jo kaafi shabdon tak chalta hai taaki yeh bole jaane ka apna alag tukda bane, aur browser ko iske liye server se alag se maang karni pade, jabki pichla hissa abhi baj raha ho aur sab kuch kram mein chale, aur sab kuch bina kisi jaldbaazi ke araam se kaha jaaye. ",
    "Teesra hissa bhi usi tarah aata hai, isme itne shabd hain ki ise ek aur anurodh ki tarah bola ja sake, jabki sunne wale ke liye pichla hissa abhi oonchi awaaz mein chal raha hai aur beech mein koi rukaavat na aaye, aur sab kuch bina kisi jaldbaazi ke araam se kaha jaaye. ",
    "Aur yeh jawab ka aakhri hissa hai, jise aaj shehar ke mausam ke baare mein ek chhoti si baat ke saath poora kiya gaya hai, jo saaf, shaant aur kaafi suhaavna hai, isliye aap chahein to bahar tehalne ja sakte hain, aur sab kuch bina kisi jaldbaazi ke araam se kaha jaaye. ",
  ],
};
for (const [language, list] of Object.entries(SENTENCES)) {
  for (const sentence of list) assert.ok(sentence.length >= 225, `a ${language} test sentence is only ${sentence.length} characters`);
}
const SECOND_REPLY = ["Second reply: this one answers the new message. ", "It is short, and it replaces the first. "];
const SHORT = { en: "Hello, this is a short reply. ", hi: "नमस्ते, यह एक छोटा सा जवाब है। " };

/** Runs in the page before its own scripts: a fake microphone, and eyes on the audio and the orb. */
const INIT = `
  localStorage.setItem("zarvis.speak", "on");
  class FakeRecognition extends EventTarget {
    start() { window.__recognitionStarts = (window.__recognitionStarts || 0) + 1; window.__recognition = this; }
    stop() { this.dispatchEvent(new Event("end")); }
    abort() { this.stop(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  window.__say = (text) => {
    window.__sayAt = performance.now();
    const ev = new Event("result");
    ev.results = [[{ transcript: text }]];
    window.__recognition.dispatchEvent(ev);
    window.__recognition.dispatchEvent(new Event("end"));
  };
  window.__sources = [];
  window.__stops = 0;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, ...rest) {
    window.__sources.push({ when: when || 0, duration: this.buffer ? this.buffer.duration : 0, at: performance.now() });
    return start.call(this, when, ...rest);
  };
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (...args) { window.__stops += 1; return stop.apply(this, args); };
  window.__media = { playing: 0, ended: 0 };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    this.addEventListener("playing", () => { window.__media.playing += 1; }, { once: true });
    this.addEventListener("ended", () => { window.__media.ended += 1; }, { once: true });
    return play.apply(this, args);
  };
  window.__wavs = [];
  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    const promise = nativeFetch.call(this, input, init);
    if (url.split("?")[0].endsWith("/tts/synthesize")) {
      promise.then(
        (res) => res.clone().arrayBuffer().then((buf) => { window.__wavs.push({ status: res.status, bytes: buf.byteLength, head: Array.from(new Uint8Array(buf.slice(0, 48))) }); }, () => {}),
        () => {},
      );
    }
    return promise;
  };
  window.__states = [];
  setInterval(() => {
    const orb = document.querySelector("#orb");
    const s = orb && orb.dataset.state;
    const last = window.__states[window.__states.length - 1];
    if (s && (!last || last.s !== s)) window.__states.push({ s, at: performance.now() });
  }, 20);
`;

const results = [];

async function step(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  const started = Date.now();
  const took = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
  try {
    const outcome = (await fn()) || {};
    if (outcome.warn) {
      results.push({ name, status: "WARN" });
      console.log("WARN", name, "—", outcome.warn);
      if (process.env.GITHUB_ACTIONS) console.log(`::warning::${name}: ${outcome.warn}`);
    } else {
      results.push({ name, status: "PASS" });
      console.log("PASS", name, outcome.detail ? `— ${outcome.detail}` : "", `(${took()})`);
    }
  } catch (err) {
    results.push({ name, status: "FAIL" });
    const message = err && err.message ? err.message.split("\n").slice(0, 18).join("\n    ") : String(err);
    console.log("FAIL", name, `(${took()})\n    ${message}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error::${name}: ${String(err && err.message).split("\n")[0]}`);
  }
}

const sse = (parts) =>
  [
    ["meta", { conversationId: "00000000-0000-4000-8000-000000000001", turnId: "t" }],
    ...parts.map((text) => ["delta", { text }]),
    ["done", { message: parts.join(""), toolCalls: [], conversationId: "00000000-0000-4000-8000-000000000001", turnId: "t" }],
  ]
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");

/** Answers the page's turns with these replies, in order (the last one repeats). */
async function stubTurns(page, replies) {
  let count = 0;
  await page.route("**/api/v1/orchestrator/turn-stream", (route) => {
    const parts = replies[Math.min(count, replies.length - 1)];
    count += 1;
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(parts) });
  });
  return { get count() { return count; } };
}

/** Every request the page makes to the TTS endpoints, with what came back. */
function trackTts(page) {
  const entries = [];
  const pending = new Set();
  const byRequest = new Map();
  let inFlight = 0;
  let peak = 0;
  page.on("request", (request) => {
    if (!request.url().includes("/api/v1/tts/")) return;
    let text = "";
    try {
      text = JSON.parse(request.postData() || "{}").text || "";
    } catch {
      /* not JSON */
    }
    const entry = { endpoint: request.url().split("/tts/")[1], text, startedAt: Date.now(), status: undefined, type: undefined, engine: undefined, voice: undefined, bytes: 0, failed: undefined, finishedAt: undefined };
    byRequest.set(request, entry);
    entries.push(entry);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
  });
  page.on("response", (response) => {
    const entry = byRequest.get(response.request());
    if (!entry) return;
    const headers = response.headers();
    entry.status = response.status();
    entry.type = headers["content-type"];
    entry.engine = headers["x-zarvis-tts"];
    entry.voice = headers["x-zarvis-tts-voice"];
  });
  page.on("requestfinished", (request) => {
    const entry = byRequest.get(request);
    if (!entry) return;
    inFlight -= 1;
    entry.finishedAt = Date.now();
    const job = request
      .response()
      .then((response) => response && response.body())
      .then((body) => {
        entry.bytes = body ? body.length : 0;
      })
      .catch(() => undefined)
      .finally(() => pending.delete(job));
    pending.add(job);
  });
  page.on("requestfailed", (request) => {
    const entry = byRequest.get(request);
    if (!entry) return;
    inFlight -= 1;
    entry.failed = (request.failure() && request.failure().errorText) || "failed";
    entry.finishedAt = Date.now();
  });
  return {
    entries,
    get peak() {
      return peak;
    },
    settle: () => Promise.all([...pending]),
  };
}

const sum = (numbers) => numbers.reduce((a, b) => a + b, 0);
const seconds = (pcmBytes) => pcmBytes / 2 / 24000;

/** The facts of a 16-bit PCM WAV from its first bytes and its total size, or null when it is not one. */
function wavHead(head, total) {
  if (head.length < 44 || head.subarray(0, 4).toString("ascii") !== "RIFF" || head.subarray(8, 12).toString("ascii") !== "WAVE") return null;
  const sampleRate = head.readUInt32LE(24);
  const channels = head.readUInt16LE(22);
  const bits = head.readUInt16LE(34);
  return { sampleRate, channels, bits, seconds: (total - 44) / (sampleRate * channels * (bits / 8)) };
}

async function openChat(page) {
  await page.goto(BASE);
  await page.waitForFunction(() => !!localStorage.getItem("zarvis.accessToken"), null, { timeout: 45_000 });
  // The orb starts as IDLE in the markup, before the app has finished starting. The last start-up step (after the
  // session, the skills and the tasks have loaded) sets it again and records it on <body>, and it overwrites whatever
  // a turn begun before it has set by then. On a cold serverless function start-up takes seconds, so wait for that step.
  await page.waitForFunction(() => document.body.dataset.orbState === "IDLE", null, { timeout: 45_000 });
  await page.waitForFunction(() => document.querySelector("#orb") && document.querySelector("#orb").dataset.state === "IDLE", null, { timeout: 45_000 });
  await page.evaluate(() => document.querySelector('[data-view="chat"]').click());
}

/** The nth microphone press, then the words: the page treats it as a spoken message, so its reply is spoken. */
async function say(page, text, nth) {
  await page.click("#mic-btn");
  await page.waitForFunction((n) => window.__recognitionStarts === n, nth, { timeout: 10_000 });
  await page.evaluate((words) => window.__say(words), text);
}

const FIRST_AUDIO_MS = LIVE ? 60_000 : 20_000;
const orbIs = (state) => `document.querySelector("#orb").dataset.state === "${state}"`;
const waitOrb = (page, state, timeout) => page.waitForFunction((s) => document.querySelector("#orb").dataset.state === s, state, { timeout });
const waitFirstAudio = (page) => page.waitForFunction(() => window.__sources.length > 0, null, { timeout: FIRST_AUDIO_MS });
const assistantBubbles = (page) => page.evaluate(() => [...document.querySelectorAll(".bubble.assistant .bubble-body")].map((node) => node.textContent || ""));

async function deleteGuest(page) {
  try {
    await page.evaluate(async () => {
      const token = localStorage.getItem("zarvis.accessToken");
      if (token) await fetch("/api/v1/account", { method: "DELETE", headers: { authorization: "Bearer " + token } });
    });
  } catch {
    /* best effort: the page may be gone */
  }
}

/** A fresh browser context (so a fresh guest account and its own rate limit) around one scenario. */
async function scenario(browser, { replies }, body) {
  const context = await browser.newContext({ viewport: { width: 412, height: 860 }, permissions: ["microphone"] });
  await context.addInitScript({ content: INIT });
  if (BYPASS) {
    // Only the deployment itself gets the secret; the page also loads fonts from Google.
    await context.route("**/*", (route) => {
      const request = route.request();
      if (request.url().startsWith(ORIGIN + "/")) return route.continue({ headers: { ...request.headers(), "x-vercel-protection-bypass": BYPASS } });
      return route.continue();
    });
  }
  const page = await context.newPage();
  if (SLOW_STARTUP_MS) {
    await page.route(/\/api\/v1\/(skills|tasks)(\?|$)/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_STARTUP_MS));
      await route.fallback();
    });
  }
  const errors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const tts = trackTts(page);
  const turns = replies ? await stubTurns(page, replies) : undefined;
  try {
    await openChat(page);
    const result = await body({ page, tts, turns });
    assert.deepEqual(errors, [], "the page raised errors");
    assert.deepEqual(consoleErrors.filter((text) => /Content Security Policy/i.test(text)), [], "the Content Security Policy blocked something");
    return result;
  } finally {
    await deleteGuest(page);
    await context.close();
  }
}

async function snapshot(page, tts) {
  await tts.settle();
  const data = await page.evaluate(() => ({ sources: window.__sources, states: window.__states, stops: window.__stops, media: window.__media, sayAt: window.__sayAt }));
  return { ...data, tts: tts.entries, peak: tts.peak };
}

/** What the voice requests and the orb did, for the message of a failed check. */
function describeRun(run) {
  const t0 = Math.min(Date.now(), ...run.tts.map((entry) => entry.startedAt));
  const rows = run.tts.slice(0, 12).map((entry) => `    ${entry.endpoint} +${entry.startedAt - t0} ms, status ${entry.status ?? "none"}${entry.failed ? `, failed ${entry.failed}` : ""}, ${entry.finishedAt ? `ended +${entry.finishedAt - t0} ms` : "still open"}, ${entry.bytes} B for ${entry.text.length} characters`);
  const orb = run.states.slice(0, 16).map((state) => `${state.s}@${Math.round(state.at)}`).join(" > ");
  return `  voice requests (${run.tts.length}):\n${rows.join("\n")}\n  orb: ${orb}`;
}

/** What a spoken reply must look like once it has been spoken; a failure carries what the page and the service did. */
function expectSpoken(run, options) {
  try {
    return checkSpoken(run, options);
  } catch (error) {
    if (error instanceof Error) error.message += `\n${describeRun(run)}`;
    throw error;
  }
}

function checkSpoken(run, { voice, requests }) {
  const streams = run.tts.filter((entry) => entry.endpoint === "synthesize-stream");
  assert.ok(streams.length >= requests, `expected at least ${requests} stream requests, saw ${streams.length}`);
  for (const entry of streams) {
    assert.equal(entry.status, 200, `a stream request answered ${entry.status} (${entry.failed || "no failure"})`);
    assert.equal(entry.type, "audio/l16; codec=pcm; rate=24000");
    assert.equal(entry.engine, "edge-stream");
    assert.equal(entry.voice, voice, `the voice that spoke was ${entry.voice}, not ${voice}`);
    assert.ok(entry.bytes > 0 && entry.bytes % 2 === 0, `a stream body of ${entry.bytes} bytes is not whole 16-bit samples`);
    if (LIVE) assert.ok(seconds(entry.bytes) >= entry.text.length / 40, `${entry.text.length} characters came back as only ${seconds(entry.bytes).toFixed(1)} s of audio`);
  }
  assert.ok(run.peak <= 2, `${run.peak} voice requests were in flight at once (the client allows 2)`);
  const received = seconds(sum(streams.map((entry) => entry.bytes)));
  const scheduled = sum(run.sources.map((source) => source.duration));
  assert.ok(Math.abs(scheduled - received) < 0.25, `${received.toFixed(2)} s of audio arrived but ${scheduled.toFixed(2)} s was scheduled`);
  const byWhen = [...run.sources].sort((a, b) => a.when - b.when);
  assert.deepEqual(run.sources.map((source) => source.when), byWhen.map((source) => source.when), "audio was scheduled out of order");
  let overlap = 0;
  for (let i = 1; i < byWhen.length; i += 1) overlap = Math.max(overlap, byWhen[i - 1].when + byWhen[i - 1].duration - byWhen[i].when);
  assert.ok(overlap < 0.01, `consecutive audio overlapped by ${overlap.toFixed(3)} s`);
  assert.ok(run.states.some((state) => state.s === "SPEAKING"), "the orb never showed that it was speaking");
  assert.equal(run.states[run.states.length - 1].s, "IDLE", "the orb did not end idle");
  // ...and not before the speech has ended: the orb says "speaking" for as long as the scheduled audio plays.
  const speakingFrom = run.states.find((state) => state.s === "SPEAKING").at;
  const idleAt = run.states[run.states.length - 1].at;
  const timeline = Math.max(...run.sources.map((source) => source.when + source.duration)) - Math.min(...run.sources.map((source) => source.when));
  assert.ok((idleAt - speakingFrom) / 1000 >= timeline - 1.5, `the orb went idle ${(timeline - (idleAt - speakingFrom) / 1000).toFixed(1)} s before the ${timeline.toFixed(1)} s of speech had ended`);
  const firstAudio = run.sources.length && run.sayAt ? Math.round(run.sources[0].at - run.sayAt) : undefined;
  return `${streams.length} requests, ${received.toFixed(1)} s of audio, voice ${voice}${firstAudio === undefined ? "" : `, first sound ${firstAudio} ms after the message`}`;
}

async function speakWholeReply(browser, language, voice) {
  return scenario(browser, { replies: [SENTENCES[language]] }, async ({ page, tts }) => {
    await say(page, "namaste zarvis", 1);
    await page.waitForFunction(() => window.__states.some((state) => state.s === "SPEAKING"), null, { timeout: FIRST_AUDIO_MS });
    await waitOrb(page, "IDLE", LIVE ? 180_000 : 60_000);
    await page.waitForTimeout(300);
    const bubbles = await assistantBubbles(page);
    assert.ok(bubbles.some((text) => text.includes(SENTENCES[language][0].slice(0, 30))), "the reply text is not on screen");
    return { detail: expectSpoken(await snapshot(page, tts), { voice, requests: SENTENCES[language].length }) };
  });
}

async function main() {
  console.log(`Deployment: ${BASE}  (${LIVE ? "a deployed site" : "local"}${BYPASS ? ", protection bypass configured" : ""})`);
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    if (FAILURES !== "natural") {
      await step("an English reply is spoken, in the English voice", () => speakWholeReply(browser, "en", EXPECT.en));
      await step("a Hindi reply is spoken, in the Hindi voice", () => speakWholeReply(browser, "hi", EXPECT.hi));
      await step("a Hinglish reply is spoken, in the Hinglish voice", () => speakWholeReply(browser, "hinglish", EXPECT.hinglish));

      await step("a long reply streams in order, two requests at a time, without overlap", () =>
        scenario(browser, { replies: [[...SENTENCES.en, ...SENTENCES.en]] }, async ({ page, tts }) => {
          await say(page, "tell me everything", 1);
          await page.waitForFunction(() => window.__states.some((state) => state.s === "SPEAKING"), null, { timeout: FIRST_AUDIO_MS });
          await waitOrb(page, "IDLE", LIVE ? 300_000 : 90_000);
          await page.waitForTimeout(300);
          const run = await snapshot(page, tts);
          const detail = expectSpoken(run, { voice: EXPECT.en, requests: SENTENCES.en.length * 2 });
          const order = run.tts.filter((entry) => entry.endpoint === "synthesize-stream").map((entry) => entry.text.trim());
          assert.deepEqual(order, [...SENTENCES.en, ...SENTENCES.en].map((text) => text.trim()), "sentences were asked for out of order");
          return { detail };
        }),
      );

      await step("Stop silences the reply, starts no new request, and the next reply is spoken normally", () =>
        scenario(browser, { replies: [SENTENCES.en, SECOND_REPLY] }, async ({ page, tts }) => {
          await say(page, "tell me something", 1);
          await waitFirstAudio(page);
          await page.waitForTimeout(700); // past the 600 ms in which a click on Stop is ignored
          await page.click("#send-btn");
          await page.waitForTimeout(500);
          const started = tts.entries.length;
          await page.waitForTimeout(2000);
          assert.equal(tts.entries.length, started, "a voice request started after Stop");
          const stopped = await snapshot(page, tts);
          assert.ok(stopped.stops >= 1, "Stop did not stop the audio that was scheduled");
          assert.equal(stopped.states[stopped.states.length - 1].s, "IDLE", "the orb did not go idle");
          assert.equal(await page.evaluate(() => document.querySelector("#send-btn").classList.contains("stop-mode")), false, "the Stop button is still showing");
          assert.ok(stopped.tts.every((entry) => entry.finishedAt), "a voice request was left open after Stop");
          // Nothing is left behind: the next spoken reply plays from its start to its end.
          const before = stopped.sources.length;
          await say(page, "and now?", 2);
          await page.waitForFunction((n) => window.__sources.length > n, before, { timeout: FIRST_AUDIO_MS });
          await waitOrb(page, "IDLE", LIVE ? 90_000 : 30_000);
          return { detail: `${stopped.stops} sources stopped, ${started} requests, none after Stop; the next reply played` };
        }),
      );

      await step("a new typed message cancels the reply being spoken, and nothing of the old reply is asked for again", () =>
        scenario(browser, { replies: [SENTENCES.en, SECOND_REPLY] }, async ({ page, tts }) => {
          await say(page, "tell me something", 1);
          await waitFirstAudio(page);
          await page.waitForTimeout(700);
          await page.fill("#text-input", "Second question, please");
          const cutAt = Date.now();
          await page.click("#send-btn");
          await page.waitForFunction(() => window.__stops >= 1, null, { timeout: 5000 });
          await page.waitForFunction(() => [...document.querySelectorAll(".bubble.assistant .bubble-body")].some((node) => (node.textContent || "").includes("Second reply")), null, { timeout: 20_000 });
          await page.waitForTimeout(2500);
          const run = await snapshot(page, tts);
          const old = new Set(SENTENCES.en.map((text) => text.trim()));
          const late = run.tts.filter((entry) => entry.startedAt > cutAt + 300 && old.has(entry.text.trim()));
          assert.equal(late.length, 0, `${late.length} voice requests for the old reply started after the new message`);
          assert.equal(run.states[run.states.length - 1].s, "IDLE", "the orb did not end idle");
          return { detail: `${run.stops} sources stopped; the new reply is on screen; no request of the old reply after the message` };
        }),
      );

      await step("a new spoken message cancels the reply being spoken, and the new reply is spoken", () =>
        scenario(browser, { replies: [SENTENCES.en, SENTENCES.hi] }, async ({ page, tts }) => {
          await say(page, "tell me something", 1);
          await waitFirstAudio(page);
          await page.waitForTimeout(700);
          const cutAt = Date.now();
          await say(page, "kuch aur batao", 2); // the microphone press itself cancels the reply being spoken
          await page.waitForFunction(() => window.__stops >= 1, null, { timeout: 5000 });
          await page.waitForFunction(() => window.__states.filter((state) => state.s === "SPEAKING").length >= 2, null, { timeout: FIRST_AUDIO_MS });
          await waitOrb(page, "IDLE", LIVE ? 180_000 : 60_000);
          await page.waitForTimeout(300);
          const run = await snapshot(page, tts);
          const old = new Set(SENTENCES.en.map((text) => text.trim()));
          const fresh = new Set(SENTENCES.hi.map((text) => text.trim()));
          const lateOld = run.tts.filter((entry) => entry.startedAt > cutAt + 300 && old.has(entry.text.trim()));
          assert.equal(lateOld.length, 0, `${lateOld.length} voice requests for the old reply started after the new message`);
          const newReply = run.tts.filter((entry) => fresh.has(entry.text.trim()));
          assert.ok(newReply.length >= 1, "the new reply was never asked for");
          assert.ok(newReply.every((entry) => entry.status === 200 && entry.voice === EXPECT.hi), "the new reply was not spoken in the Hindi voice");
          return { detail: `${run.stops} sources stopped; ${newReply.length} requests for the new reply, in ${EXPECT.hi}` };
        }),
      );

      for (const [language, label] of [["en", "English"], ["hi", "Hindi"]]) {
        await step(`the Listen button plays a ${label} reply (the WAV endpoint)`, () =>
          scenario(browser, { replies: [[SHORT[language]]] }, async ({ page, tts }) => {
            await page.fill("#text-input", "Please answer");
            await page.click("#send-btn");
            await page.waitForSelector(".bubble.assistant .bubble-actions button");
            await page.locator(".bubble.assistant .bubble-actions button", { hasText: /Listen|सुनें/ }).first().click();
            await page.waitForFunction(() => window.__media.ended >= 1, null, { timeout: LIVE ? 90_000 : 30_000 });
            await waitOrb(page, "IDLE", 10_000);
            await page.waitForTimeout(100); // the orb is sampled every 20 ms
            const run = await snapshot(page, tts);
            const wavs = run.tts.filter((entry) => entry.endpoint === "synthesize");
            assert.equal(wavs.length, 1, `${wavs.length} WAV requests`);
            const [entry] = wavs;
            assert.equal(entry.status, 200, `the WAV endpoint answered ${entry.status}`);
            assert.match(entry.type || "", /audio\/wav/);
            assert.equal(entry.engine, "edge");
            assert.equal(entry.voice, EXPECT[language], `the voice that spoke was ${entry.voice}`);
            const received = (await page.evaluate(() => window.__wavs))[0];
            assert.ok(received, "the page received no WAV");
            const wav = wavHead(Buffer.from(received.head), received.bytes);
            assert.ok(wav && wav.sampleRate === 24000 && wav.channels === 1 && wav.bits === 16, `not a 24 kHz mono 16-bit WAV: ${JSON.stringify(wav)}`);
            if (LIVE) assert.ok(wav.seconds >= SHORT[language].length / 40, `${SHORT[language].length} characters came back as ${wav.seconds.toFixed(1)} s`);
            assert.ok(run.media.playing >= 1 && run.media.ended >= 1, "the browser never played the audio to its end");
            assert.equal(run.states[run.states.length - 1].s, "IDLE", "the orb did not end idle");
            return { detail: `${wav.seconds.toFixed(1)} s, 24 kHz mono, voice ${entry.voice}, played to the end` };
          }),
        );
      }
    }

    if (FAILURES !== "skip") {
      const failing = (name, fulfil) =>
        step(name, () =>
          scenario(browser, { replies: [SENTENCES.en, SECOND_REPLY] }, async ({ page, tts }) => {
            if (fulfil) await page.route("**/api/v1/tts/**", fulfil);
            await say(page, "tell me something", 1);
            await page.waitForFunction(() => [...document.querySelectorAll(".bubble.assistant .bubble-body")].some((node) => (node.textContent || "").length > 100), null, { timeout: 30_000 });
            await waitOrb(page, "IDLE", 60_000);
            const bubbles = await assistantBubbles(page);
            assert.ok(bubbles.some((text) => text.includes(SENTENCES.en[0].slice(0, 30))), "the reply text is not on screen");
            const run = await snapshot(page, tts);
            assert.ok(run.tts.length >= 1, "the page never asked for the voice");
            if (fulfil) {
              // The browser made every request fail, so none may have succeeded and no sound may have started.
              // (A server that fails for real may still have sent part of a sentence before it failed.)
              assert.ok(run.tts.every((entry) => entry.status !== 200), "a voice request succeeded although it was meant to fail");
              assert.equal(run.sources.length, 0, "audio was scheduled although the voice failed");
            }
            // The Listen button says so in words instead of staying silent.
            await page.locator(".bubble.assistant .bubble-actions button", { hasText: /Listen|सुनें/ }).first().click();
            await page.waitForFunction(() => { const toast = document.getElementById("toast"); return !!toast && !toast.hidden && /Spoken reply|बोलकर जवाब/.test(toast.textContent || ""); }, null, { timeout: 15_000 });
            // And the conversation goes on: the next message is answered.
            await page.fill("#text-input", "Second question, please");
            await page.click("#send-btn");
            await page.waitForFunction(() => [...document.querySelectorAll(".bubble.assistant .bubble-body")].some((node) => (node.textContent || "").includes("Second reply")), null, { timeout: 20_000 });
            await waitOrb(page, "IDLE", 30_000);
            const kinds = [...new Set(run.tts.map((entry) => entry.status || entry.failed))].join("/");
            return { detail: `${run.tts.length} voice requests failed (${kinds}); the reply is on screen, the orb is idle, the next message was answered` };
          }),
        );
      if (FAILURES === "natural") {
        await failing("the server's voice is failing: the reply still appears and the conversation goes on", undefined);
      } else {
        await failing("the voice answers 503: the reply still appears and the conversation goes on", (route) =>
          route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Voice synthesis isn't available right now. The reply is still shown as text.", code: "tts_unavailable", retryable: true }) }),
        );
        await failing("the voice cannot be reached at all: the reply still appears and the conversation goes on", (route) => route.abort("connectionfailed"));
      }
    }

    if (REAL_AI && FAILURES !== "natural") {
      await step("a real AI answer is spoken", () =>
        scenario(browser, { replies: undefined }, async ({ page, tts }) => {
          await say(page, "Reply with exactly one short English sentence about the weather.", 1);
          const outcome = await page
            .waitForFunction(
              () => {
                if ([...document.querySelectorAll(".bubble.assistant .bubble-body")].some((node) => (node.textContent || "").trim().length > 3)) return "answer";
                if (document.querySelector(".bubble.system .bubble-error-text")) return "refused";
                return false;
              },
              null,
              { timeout: 120_000 },
            )
            .then((handle) => handle.jsonValue());
          if (outcome === "refused") {
            const why = await page.evaluate(() => (document.querySelector(".bubble.system .bubble-error-text") || {}).textContent || "");
            return { warn: `the AI did not answer (${why.slice(0, 80)}); the spoken path with a real answer was not exercised` };
          }
          await page.waitForFunction(() => window.__states.some((state) => state.s === "SPEAKING"), null, { timeout: FIRST_AUDIO_MS });
          await waitOrb(page, "IDLE", 120_000);
          const run = await snapshot(page, tts);
          const streams = run.tts.filter((entry) => entry.endpoint === "synthesize-stream");
          assert.ok(streams.length >= 1 && streams.every((entry) => entry.status === 200 && entry.bytes > 0), "the real answer was not spoken");
          return { detail: `${streams.length} voice requests; voice ${streams[0].voice}` };
        }),
      );
    }
  } finally {
    await browser.close();
  }

  const count = (status) => results.filter((result) => result.status === status).length;
  console.log(`\n${count("PASS")} passed, ${count("WARN")} warnings, ${count("FAIL")} failed`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map((result) => `| ${result.name} | ${result.status} |`).join("\n");
    require("node:fs").appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Spoken replies in a real browser on ${BASE}\n\n| Scenario | Result |\n| --- | --- |\n${rows}\n\n`);
  }
  if (results.length === 0) {
    console.log("FAIL no scenario ran (check AUDIT_ONLY)");
    process.exit(1);
  }
  process.exit(count("FAIL") ? 1 : 0);
}

main().catch((error) => {
  console.log("FAIL audit run —", error && error.message ? error.message : error);
  process.exit(1);
});
