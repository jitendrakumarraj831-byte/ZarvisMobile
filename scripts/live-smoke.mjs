#!/usr/bin/env node
/**
 * Live API smoke test for a deployed ZARVIS (Vercel preview or production), the way the web
 * client uses it. Run by .github/workflows/preview-smoke.yml after each successful deployment:
 *
 *   BASE_URL=https://…vercel.app [BYPASS=<Vercel protection bypass>] node scripts/live-smoke.mjs
 *
 * Every check prints PASS, WARN or FAIL. WARN is for an honest provider-side condition that is
 * not a deployment defect (an exhausted AI quota) or for something the model chose not to do;
 * it is never counted as a pass in the reports. Any FAIL exits 1.
 *
 * No token, password or secret is ever printed. The sign-up account this creates is deleted at
 * the end. Gemini cost per run: 1 model answer, 1 web search turn (~3 requests). The voice checks
 * (about 25 requests, see voiceChecks) go to the Edge voice service, which needs no key and costs
 * nothing; they print a VOICE SUMMARY at the end.
 *
 * `ONLY=tts` runs just the health check, a guest session and the voice checks: against any
 * deployment, a preview or production, without spending any AI quota or creating any other account.
 * `EXPECT_EN_VOICE`, `EXPECT_HI_VOICE`, `EXPECT_HINGLISH_VOICE` say which voices the deployment is
 * configured with (defaults: the built-in ones). `VOICE_LENGTH_CHECK=off` skips the check that the
 * audio is as long as the text says it should be (only for a stand-in that answers every text with
 * the same clip).
 */
import { appendFileSync } from "node:fs";

let BASE = (process.env.BASE_URL || "").replace(/\/$/, "");
if (!BASE) {
  console.error("BASE_URL is required");
  process.exit(2);
}
const BYPASS = process.env.BYPASS || "";
const results = [];

function report(status, name, detail = "") {
  results.push(status);
  console.log(`${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ""}`);
  if (status === "WARN" && process.env.GITHUB_ACTIONS) console.log(`::warning::${name}: ${detail}`);
  if (status === "FAIL" && process.env.GITHUB_ACTIONS) console.log(`::error::${name}: ${detail}`);
}

/** The facts of a 16-bit PCM WAV file, or null when the bytes are not one. */
function wavFacts(bytes) {
  if (bytes.length < 44 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WAVE") return null;
  const sampleRate = bytes.readUInt32LE(24);
  const channels = bytes.readUInt16LE(22);
  const bits = bytes.readUInt16LE(34);
  const dataBytes = bytes.readUInt32LE(40);
  return { sampleRate, channels, bits, seconds: dataBytes / (sampleRate * channels * (bits / 8)) };
}

async function call(method, path, { token, body, raw, headers = {}, timeoutMs = 60_000 } = {}) {
  const h = { ...headers };
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) {
    h["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  const bytes = method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await res.arrayBuffer());
  const text = bytes.toString("utf8");
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, headers: res.headers, text, json, bytes };
}

/** POST /orchestrator/turn-stream; returns the parsed SSE events. */
async function turn(token, utterance, extra = {}) {
  const res = await call("POST", "/api/v1/orchestrator/turn-stream", { token, body: { utterance, locale: "en", history: [], ...extra }, timeoutMs: 120_000 });
  const events = [];
  for (const frame of res.text.split("\n\n")) {
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    if (!event) continue;
    let parsed;
    try { parsed = data ? JSON.parse(data) : undefined; } catch { parsed = undefined; }
    events.push({ event, data: parsed });
  }
  return { status: res.status, events, done: events.find((e) => e.event === "done")?.data, error: events.find((e) => e.event === "error")?.data };
}

const quota = (code) => code === "AI_QUOTA_EXCEEDED" || code === "AI_RATE_LIMITED";

/** A one-page PDF whose text is "ZARVIS smoke test" (valid xref offsets computed below). */
function tinyPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null, // content stream, below
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 18 Tf 20 70 Td (ZARVIS smoke test) Tj ET";
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** "www.example.com" and "example.com" are the same site; anything else is not. */
function sameSite(a, b) {
  const strip = (host) => host.toLowerCase().replace(/^www\./, "");
  return strip(a) === strip(b);
}

/**
 * Where a redirect from GET /health points: Vercel's own login (Deployment Protection), the
 * same site's canonical address (e.g. apex -> www, followed once: tokens and the bypass secret
 * are only ever sent to that same site), or somewhere else (reported, never followed).
 */
function classifyRedirect(status, location) {
  if (!location) return { kind: "unknown" };
  let target;
  try { target = new URL(location, BASE + "/health"); } catch { return { kind: "unknown" }; }
  if (/(^|\.)vercel\.com$/i.test(target.hostname) || /sso|login/i.test(target.pathname)) return { kind: "protection", target };
  const base = new URL(BASE);
  const protocolOk = target.protocol === "https:" || base.protocol === "http:";
  if (protocolOk && sameSite(target.hostname, base.hostname) && target.pathname.replace(/\/$/, "") === "/health") {
    return { kind: "canonical", target };
  }
  return { kind: "elsewhere", target };
}

// ---- Voice (TTS) -------------------------------------------------------------------------------
// Spoken replies use Edge's neural voices: an unofficial service, reached from the network this API
// runs on. So this is the check that proves the voice works where it is deployed, and the one thing
// that cannot be proved anywhere else: whether Microsoft's service accepts this deployment's address.
// It needs no key. What it asks, in order: does English come back as real audio in the right voice
// on both endpoints, then Hindi, then Hinglish; does a long reply stream progressively; does the WAV
// endpoint cope with the longest text it accepts; does a client that walks away mid-stream leave the
// service able to serve the next request; do bad requests get plain answers.

const VOICE_TEXT = {
  en: "Hello from ZARVIS. The weather is clear today, and the voice should sound natural and calm.",
  hi: "नमस्ते, मैं ज़ारविस हूँ। आज मौसम साफ़ है, और मेरी आवाज़ स्वाभाविक और शांत सुनाई देनी चाहिए।",
  hinglish: "Namaste, main ZARVIS hoon. Aaj mausam saaf hai, aur meri awaaz natural aur shaant sunaai deni chahiye.",
};
const EXPECT_VOICE = {
  en: process.env.EXPECT_EN_VOICE || "en-US-JennyNeural",
  hi: process.env.EXPECT_HI_VOICE || "hi-IN-SwaraNeural",
  hinglish: process.env.EXPECT_HINGLISH_VOICE || process.env.EXPECT_HI_VOICE || "hi-IN-SwaraNeural",
};
const SENTENCE = "The assistant keeps talking in plain English so that the reply is long enough to be heard for a while, and each sentence is spoken in turn. ";
const LONG_STREAM_TEXT = SENTENCE.repeat(8).slice(0, 1150); // the stream endpoint takes 1200 characters
const LONG_UNARY_TEXT = SENTENCE.repeat(14).slice(0, 1950); // the WAV endpoint takes 2000
const PCM_RATE = 24000;
// A voice that answers 200 with a second of noise is not a pass: speech runs at roughly 15 characters
// a second, so between 0.025 s and one second per character is generous on both sides.
const lengthPlausible = (text, seconds) => process.env.VOICE_LENGTH_CHECK === "off" || (seconds >= text.length / 40 && seconds <= text.length);

/** Why a response was not audio: the API's own code, or the platform's (Vercel's error header or page). */
function whyNot(res) {
  const platform = res.headers.get("x-vercel-error");
  const body = res.json?.code ?? (res.text ? res.text.replace(/\s+/g, " ").slice(0, 100) : "");
  return `HTTP ${res.status}${platform ? ` ${platform}` : ""}${body ? ` ${body}` : ""}`;
}

/** POST /tts/synthesize-stream, reading the body as it arrives; `abortAfterBytes` walks away mid-stream. */
async function streamCall(token, body, { abortAfterBytes, timeoutMs = 90_000 } = {}) {
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  if (BYPASS) headers["x-vercel-protection-bypass"] = BYPASS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/api/v1/tts/synthesize-stream`, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal, redirect: "manual" });
    const firstByteMs = Date.now() - started; // the headers are sent when the first audio exists
    const chunks = [];
    let total = 0;
    let aborted = false;
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (abortAfterBytes && total >= abortAfterBytes) {
        aborted = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    const bytes = Buffer.concat(chunks);
    const text = res.status === 200 ? "" : bytes.toString("utf8");
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, headers: res.headers, bytes, text, json, firstByteMs, totalMs: Date.now() - started, aborted };
  } finally {
    clearTimeout(timer);
  }
}

async function voiceChecks(token) {
  const groups = { reach: [], english: [], hindi: [], hinglish: [], streaming: [], unary: [], cancellation: [] };
  const verdict = (statuses) => (statuses.length === 0 ? "NOT RUN" : statuses.includes("FAIL") ? "FAIL" : statuses.includes("WARN") ? "WARN" : "PASS");
  const vreport = (names, status, name, detail) => {
    report(status, name, detail);
    for (const group of names) groups[group].push(status);
  };

  const unary = (body, timeoutMs = 90_000) => call("POST", "/api/v1/tts/synthesize", { token, body, timeoutMs });
  const checkWav = (res, text, expected) => {
    const wav = wavFacts(res.bytes);
    const voice = res.headers.get("x-zarvis-tts-voice");
    if (res.status !== 200 || !/audio\/wav/.test(res.headers.get("content-type") || "") || !wav) return { ok: false, why: `${whyNot(res)} ${wav ? "" : "(not a WAV file)"}` };
    if (wav.sampleRate !== PCM_RATE || wav.channels !== 1 || wav.bits !== 16) return { ok: false, why: `WAV is ${JSON.stringify(wav)}, not 24 kHz mono 16-bit` };
    if (!lengthPlausible(text, wav.seconds)) return { ok: false, why: `${text.length} characters came back as ${wav.seconds.toFixed(1)} s of audio` };
    if (res.headers.get("x-zarvis-tts") !== "edge") return { ok: false, why: `X-Zarvis-TTS was ${res.headers.get("x-zarvis-tts")}, not edge` };
    if (expected && voice !== expected) return { ok: false, why: `spoken by ${voice}, expected ${expected}` };
    return { ok: true, detail: `${wav.seconds.toFixed(1)} s, 24 kHz mono 16-bit, ${(res.bytes.length / 1024).toFixed(0)} KB, voice ${voice}` };
  };
  const checkStream = (res, text, expected) => {
    const type = res.headers.get("content-type") || "";
    const voice = res.headers.get("x-zarvis-tts-voice");
    if (res.status !== 200 || !/audio\/l16/.test(type) || !/rate=24000/.test(type)) return { ok: false, why: `${whyNot(res)} ${type}` };
    if (res.bytes.length === 0 || res.bytes.length % 2 !== 0 || res.bytes.subarray(0, 4).toString("ascii") === "RIFF") return { ok: false, why: `${res.bytes.length} bytes is not headerless 16-bit PCM` };
    const seconds = res.bytes.length / 2 / PCM_RATE;
    if (!lengthPlausible(text, seconds)) return { ok: false, why: `${text.length} characters came back as ${seconds.toFixed(1)} s of audio` };
    if (res.headers.get("x-zarvis-tts") !== "edge-stream") return { ok: false, why: `X-Zarvis-TTS was ${res.headers.get("x-zarvis-tts")}, not edge-stream` };
    if (expected && voice !== expected) return { ok: false, why: `spoken by ${voice}, expected ${expected}` };
    return { ok: true, seconds, detail: `${seconds.toFixed(1)} s of 16-bit mono, first audio after ${res.firstByteMs} ms, complete after ${res.totalMs} ms, voice ${voice}` };
  };

  // ---- Is the voice service reachable from here at all? English first; the rest is pointless if not.
  const first = await unary({ text: VOICE_TEXT.en });
  if (first.status === 503 && first.json?.code === "tts_disabled") {
    report("WARN", "voice", "spoken replies are switched off on this server (TTS_PROVIDER=none); no audio verified");
    printVoiceSummary(groups, verdict, "TTS_PROVIDER=none");
    return;
  }
  const firstWav = checkWav(first, VOICE_TEXT.en, EXPECT_VOICE.en);
  vreport(["reach", "english", "unary"], firstWav.ok ? "PASS" : "FAIL", "voice: English, WAV endpoint", firstWav.ok ? firstWav.detail : firstWav.why);
  const firstStream = await streamCall(token, { text: VOICE_TEXT.en });
  const firstStreamCheck = checkStream(firstStream, VOICE_TEXT.en, EXPECT_VOICE.en);
  vreport(["reach", "english", "streaming"], firstStreamCheck.ok ? "PASS" : "FAIL", "voice: English, stream endpoint", firstStreamCheck.ok ? firstStreamCheck.detail : firstStreamCheck.why);
  if (!firstWav.ok && !firstStreamCheck.ok) {
    // Nothing else can be learned, and every further attempt could wait out the service's timeouts.
    for (const [group, name] of [["hindi", "Hindi"], ["hinglish", "Hinglish"]]) vreport([group, "streaming", "unary"], "FAIL", `voice: ${name}`, "not run: English failed on both endpoints, so the voice is not usable here (see above)");
    vreport(["streaming", "unary"], "FAIL", "voice: long text", "not run: English failed on both endpoints, so the voice is not usable here (see above)");
    vreport(["cancellation"], "FAIL", "voice: cancelling mid-stream", "not run: English failed on both endpoints, so the voice is not usable here (see above)");
    printVoiceSummary(groups, verdict);
    return;
  }

  // ---- Hindi and Hinglish, on both endpoints.
  for (const [group, key, label] of [["hindi", "hi", "Hindi"], ["hinglish", "hinglish", "Hinglish"]]) {
    const wav = checkWav(await unary({ text: VOICE_TEXT[key] }), VOICE_TEXT[key], EXPECT_VOICE[key]);
    vreport([group, "unary"], wav.ok ? "PASS" : "FAIL", `voice: ${label}, WAV endpoint`, wav.ok ? wav.detail : wav.why);
    const stream = checkStream(await streamCall(token, { text: VOICE_TEXT[key] }), VOICE_TEXT[key], EXPECT_VOICE[key]);
    vreport([group, "streaming"], stream.ok ? "PASS" : "FAIL", `voice: ${label}, stream endpoint`, stream.ok ? stream.detail : stream.why);
  }

  // ---- A long reply: does the stream arrive progressively, or in one piece at the end?
  const long = await streamCall(token, { text: LONG_STREAM_TEXT });
  const longCheck = checkStream(long, LONG_STREAM_TEXT, EXPECT_VOICE.en);
  if (!longCheck.ok) vreport(["streaming"], "FAIL", "voice: long text, stream endpoint", longCheck.why);
  else if (longCheck.seconds > 20 && long.firstByteMs > long.totalMs * 0.9) {
    // The audio is right, but the platform held it back: the client's first sound would wait for all of it.
    vreport(["streaming"], "WARN", "voice: long text, stream endpoint", `${longCheck.detail}; the first byte came at ${long.firstByteMs} of ${long.totalMs} ms, so the platform is probably delivering the stream in one piece`);
  } else vreport(["streaming"], "PASS", "voice: long text, stream endpoint", `${longCheck.detail} (progressive: first audio at ${Math.round((100 * long.firstByteMs) / long.totalMs)}% of the time)`);

  // ---- The longest text the WAV endpoint accepts. Vercel answers at most about 4.5 MB in one piece, and a
  // function has a maximum duration, so this is where a limit of the platform would show: said plainly.
  const longUnary = await unary({ text: LONG_UNARY_TEXT }, 120_000);
  const longWav = checkWav(longUnary, LONG_UNARY_TEXT, EXPECT_VOICE.en);
  if (longWav.ok) vreport(["unary"], "PASS", "voice: longest text, WAV endpoint", longWav.detail);
  else if ([413, 502, 504].includes(longUnary.status) && (longUnary.headers.get("x-vercel-error") || !longUnary.json)) {
    vreport(["unary"], "WARN", "voice: longest text, WAV endpoint", `the platform refused it (${whyNot(longUnary)}); about ${Math.round(LONG_UNARY_TEXT.length / 15)} s of speech does not fit in one response here, so a long Listen will fail`);
  } else vreport(["unary"], "FAIL", "voice: longest text, WAV endpoint", longWav.why);

  // ---- A client that walks away. Six streams abandoned after the first bytes, two WAV requests dropped
  // while the voice is working, and then the service must still serve the next request.
  let abandoned = 0;
  const otherAnswers = [];
  for (let i = 0; i < 6; i += 1) {
    const dropped = await streamCall(token, { text: LONG_STREAM_TEXT }, { abortAfterBytes: 4000 }).catch((error) => ({ failure: error instanceof Error ? error.name : "error" }));
    if (dropped?.aborted) abandoned += 1;
    else otherAnswers.push(dropped?.status ?? dropped?.failure ?? "no answer");
  }
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}`, ...(BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {}) };
  for (let i = 0; i < 2; i += 1) {
    await fetch(`${BASE}/api/v1/tts/synthesize`, { method: "POST", headers, body: JSON.stringify({ text: LONG_UNARY_TEXT }), signal: AbortSignal.timeout(400) }).catch(() => undefined);
  }
  const after = await streamCall(token, { text: VOICE_TEXT.en });
  const afterCheck = checkStream(after, VOICE_TEXT.en, EXPECT_VOICE.en);
  if (abandoned === 6 && afterCheck.ok) vreport(["cancellation"], "PASS", "voice: cancelling mid-stream", `6 streams abandoned after their first bytes and 2 WAV requests dropped; the next request was served in ${after.totalMs} ms`);
  else vreport(["cancellation"], "FAIL", "voice: cancelling mid-stream", abandoned === 6 ? `the next request after the cancellations failed: ${afterCheck.why}` : `only ${abandoned} of 6 streams could be abandoned mid-way (the others: ${otherAnswers.join(", ")})`);

  // ---- Bad requests get plain answers, and a caller's voice is honoured only from the allow-list.
  const noToken = await call("POST", "/api/v1/tts/synthesize", { body: { text: "Hello" } });
  vreport(["unary"], noToken.status === 401 ? "PASS" : "FAIL", "voice: no token is refused (WAV endpoint)", `HTTP ${noToken.status}`);
  const empty = await call("POST", "/api/v1/tts/synthesize-stream", { token, body: { text: "   " } });
  vreport(["streaming"], empty.status === 400 ? "PASS" : "FAIL", "voice: empty text is 400 (stream endpoint)", `HTTP ${empty.status}`);
  const silent = await unary({ text: "... !!!" });
  vreport(["unary"], silent.status === 400 && silent.json?.code === "tts_invalid_request" ? "PASS" : "FAIL", "voice: text with nothing to say is 400 tts_invalid_request", `HTTP ${silent.status} ${silent.json?.code ?? ""}`);
  const chosen = await unary({ text: VOICE_TEXT.en, voice: "en-US-GuyNeural" });
  const chosenCheck = checkWav(chosen, VOICE_TEXT.en, "en-US-GuyNeural");
  vreport(["english", "unary"], chosenCheck.ok ? "PASS" : "FAIL", "voice: a caller can choose an allowed voice", chosenCheck.ok ? chosenCheck.detail : chosenCheck.why);
  const refused = await unary({ text: VOICE_TEXT.en, voice: "xx-XX-NotARealNeural" });
  const refusedCheck = checkWav(refused, VOICE_TEXT.en, EXPECT_VOICE.en);
  vreport(["english", "unary"], refusedCheck.ok ? "PASS" : "FAIL", "voice: an unknown voice is ignored, the usual one speaks", refusedCheck.ok ? refusedCheck.detail : refusedCheck.why);

  printVoiceSummary(groups, verdict);
}

function printVoiceSummary(groups, verdict, note = "") {
  const rows = [
    ["Live voice service reached (this deployment to Microsoft)", "reach"],
    ["English", "english"],
    ["Hindi", "hindi"],
    ["Hinglish", "hinglish"],
    ["Streaming", "streaming"],
    ["Unary", "unary"],
    ["Cancellation", "cancellation"],
  ];
  console.log(`\nVOICE SUMMARY (${BASE})${note ? ` — ${note}` : ""}`);
  for (const [label, key] of rows) console.log(`  ${label.padEnd(58)} ${verdict(groups[key])}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const table = rows.map(([label, key]) => `| ${label} | ${verdict(groups[key])} |`).join("\n");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Voice (Edge neural voices) on ${BASE}\n\n| Check | Result |\n| --- | --- |\n${table}\n\n`);
  }
}

async function main() {
  console.log(`Deployment: ${BASE}`);
  console.log(`Vercel protection bypass secret: ${BYPASS ? "configured" : "not configured"}`);

  // ---- Health ------------------------------------------------------------------------------
  let health = await call("GET", "/health");
  if ([301, 302, 303, 307, 308].includes(health.status)) {
    const location = health.headers.get("location");
    const redirect = classifyRedirect(health.status, location);
    if (redirect.kind === "canonical") {
      const from = BASE;
      BASE = redirect.target.origin;
      console.log(`     ${from} redirects (HTTP ${health.status}) to ${BASE}; testing that address`);
      health = await call("GET", "/health");
    } else if (redirect.kind === "protection") {
      report("FAIL", "reach the API", `Vercel Deployment Protection answered HTTP ${health.status} (redirect to its login); the API was not reached. ${BYPASS ? "The bypass secret was rejected." : "Set the VERCEL_AUTOMATION_BYPASS_SECRET repository secret."}`);
      return;
    } else {
      report("FAIL", "reach the API", `HTTP ${health.status} redirect to ${redirect.target ? redirect.target.href : "(no Location header)"}; not followed (another site or path), so the API was not reached`);
      return;
    }
  }
  if ((health.status === 401 && /vercel/i.test(health.text)) || [301, 302, 303, 307, 308].includes(health.status)) {
    report("FAIL", "reach the API", `Vercel Deployment Protection answered HTTP ${health.status}; the API was not reached. ${BYPASS ? "The bypass secret was rejected." : "Set the VERCEL_AUTOMATION_BYPASS_SECRET repository secret."}`);
    return;
  }
  const h = health.json ?? {};
  console.log(`     health: ${JSON.stringify({ status: h.status, provider: h.provider, aiFallback: h.aiFallback, aiFallbackTools: h.aiFallbackTools, database: h.database, reason: h.reason })}`);
  report(health.status === 200 && h.database !== undefined ? "PASS" : "FAIL", "GET /health", `HTTP ${health.status}`);
  if (h.aiFallback && h.aiFallbackTools === false) {
    // Not a failure: the deployment works as configured. But a fallback that cannot take a chat turn's
    // planner step does nothing for chat when the primary provider is out of quota or down.
    report("WARN", "the AI fallback cannot serve chat turns", "a fallback provider is configured but its model does not declare tool support, so chat turns will not fall back (set OPENROUTER_MODEL_CAPABILITIES=tools for a model that supports tool calling)");
  }
  const provider = h.provider;
  // The providers that can answer a chat turn. Web search needs Gemini's Google Search grounding.
  const liveProvider = provider === "google" ? "Gemini" : provider === "openrouter" ? "OpenRouter" : undefined;

  // ---- Auth lifecycle ----------------------------------------------------------------------
  const guest = await call("POST", "/api/v1/auth/guest");
  report(guest.status === 201 ? "PASS" : "FAIL", "guest session", `HTTP ${guest.status}`);
  if (guest.status !== 201) return;
  const guestToken = guest.json.accessToken;
  if (process.env.ONLY === "tts") {
    await voiceChecks(guestToken);
    return;
  }
  const me = await call("GET", "/api/v1/auth/me", { token: guestToken });
  report(me.status === 200 ? "PASS" : "FAIL", "GET /auth/me with the guest token (session persists across instances)", `HTTP ${me.status}`);

  const email = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `Smoke-${crypto.randomUUID()}`;
  const signup = await call("POST", "/api/v1/auth/signup", { body: { email, password } });
  report(signup.status === 201 ? "PASS" : "FAIL", "email sign-up", `HTTP ${signup.status}${signup.json?.code ? " " + signup.json.code : ""}`);
  let accountToken;
  if (signup.status === 201) {
    const login = await call("POST", "/api/v1/auth/login", { body: { email, password } });
    report(login.status === 200 ? "PASS" : "FAIL", "email login with the new account", `HTTP ${login.status}`);
    const wrong = await call("POST", "/api/v1/auth/login", { body: { email, password: password + "x" } });
    report(wrong.status === 401 ? "PASS" : "FAIL", "login with a wrong password is refused", `HTTP ${wrong.status}`);
    if (login.status === 200) {
      const refreshed = await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: login.json.refreshToken } });
      report(refreshed.status === 200 && refreshed.json?.refreshToken !== login.json.refreshToken ? "PASS" : "FAIL", "refresh rotates the refresh token", `HTTP ${refreshed.status}`);
      const replay = await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: login.json.refreshToken } });
      report(replay.status === 401 ? "PASS" : "FAIL", "replaying a used refresh token is refused", `HTTP ${replay.status} ${replay.json?.code ?? ""}`);
      // The replay revoked that session (by design), so sign in again for the rest.
      const again = await call("POST", "/api/v1/auth/login", { body: { email, password } });
      accountToken = again.json?.accessToken;
      const logout = await call("POST", "/api/v1/auth/logout", { token: accountToken });
      const after = await call("GET", "/api/v1/auth/me", { token: accountToken });
      report(logout.status === 204 && after.status === 401 ? "PASS" : "FAIL", "logout revokes the access token", `logout HTTP ${logout.status}, then /auth/me HTTP ${after.status}`);
      accountToken = (await call("POST", "/api/v1/auth/login", { body: { email, password } })).json?.accessToken;
    }
  }

  // ---- Error handling ----------------------------------------------------------------------
  const noAuth = await call("POST", "/api/v1/orchestrator/turn", { body: { utterance: "Hi" } });
  report(noAuth.status === 401 ? "PASS" : "FAIL", "a turn without a token is refused", `HTTP ${noAuth.status}`);
  const malformed = await call("POST", "/api/v1/orchestrator/turn", { token: guestToken, raw: "{not json", headers: { "content-type": "application/json" } });
  report(malformed.status === 400 && malformed.json?.code === "invalid_json" ? "PASS" : "FAIL", "malformed JSON is 400 invalid_json", `HTTP ${malformed.status} ${malformed.json?.code ?? ""}`);
  const badKey = await call("POST", "/api/v1/orchestrator/turn", { token: guestToken, body: { utterance: "Hi", clientTurnId: "x y" } });
  report(badKey.status === 400 ? "PASS" : "FAIL", "a malformed clientTurnId is 400", `HTTP ${badKey.status} ${badKey.json?.code ?? ""}`);

  // ---- Chat: streaming, idempotency, a real model answer -------------------------------------
  const clientTurnId = `smoke-${crypto.randomUUID()}`;
  const hi = await turn(guestToken, "Hi", { isFirstTurn: true, clientTurnId });
  report(hi.status === 200 && hi.done ? "PASS" : "FAIL", "streamed greeting turn (meta/delta/done; no AI call)", `events: ${hi.events.map((e) => e.event).join(",")}`);
  const replay = await turn(guestToken, "Hi", { clientTurnId });
  report(replay.done?.replayed === true && replay.done?.message === hi.done?.message ? "PASS" : "FAIL", "re-sent turn with the same clientTurnId is replayed, not run again", `replayed=${replay.done?.replayed}`);

  const model = await turn(guestToken, "Reply with the single word OK.");
  if (model.done) {
    // The response deliberately does not say which provider produced it, so this can only name the
    // deployment's DEFAULT provider (from /health). With a fallback configured the answer may have
    // come from either; the function log's `AI call` line records which.
    report(
      liveProvider ? "PASS" : "FAIL",
      "a turn that needs the AI model",
      liveProvider
        ? `an AI answer was returned (default provider: ${liveProvider}${h.aiFallback ? "; a fallback provider is also configured, and the response does not say which one answered" : ""})`
        : `answered by provider ${provider}, not a live AI provider`,
    );
  } else if (quota(model.error?.code)) {
    report("WARN", "a turn that needs the AI model", `the AI provider is reachable but out of quota (${model.error.code}); no answer verified`);
  } else if (model.error?.code === "AI_UNAVAILABLE" && model.error.retryable) {
    report("WARN", "a turn that needs the AI model", "the AI provider is temporarily unavailable; no answer verified");
  } else {
    report("FAIL", "a turn that needs the AI model", `no answer: ${JSON.stringify({ status: model.status, code: model.error?.code, retryable: model.error?.retryable })}`);
  }

  // ---- Web Search ----------------------------------------------------------------------------
  // Web search needs Google Search grounding, which only Gemini provides: a deployment without
  // Gemini cannot search, and says so instead of failing.
  if (provider !== "google") {
    report("WARN", "web search", `needs Gemini (Google Search grounding); this deployment answers with provider ${provider}, so search was not exercised`);
  } else {
    const searchPrompt = "Use web search to find the capital city of Australia, then answer in one sentence with the source.";
    let search = await turn(guestToken, searchPrompt);
    let searches = (search.done?.toolCalls ?? []).filter((c) => c.skillId === "web.search");
    if (searches.length === 1 && searches[0].outcome?.result?.reason === "ai_rate_limited") {
      // A per-minute limit, usually from the model calls just before. Respect it: wait out one
      // window and ask once more (a new turn). A daily quota is not retried.
      console.log("     web search hit the per-minute limit; waiting 65 s, then one more attempt");
      await new Promise((resolve) => setTimeout(resolve, 65_000));
      search = await turn(guestToken, searchPrompt);
      searches = (search.done?.toolCalls ?? []).filter((c) => c.skillId === "web.search");
    }
    if (searches.length === 1 && searches[0].result?.status === "COMPLETED") {
      const sources = (searches[0].outcome?.result?.output?.results ?? []).length;
      report(provider === "google" ? "PASS" : "FAIL", "web search ran exactly once and completed", provider === "google" ? `${sources} sources` : `provider ${provider}: not a real search`);
    } else if (searches.length > 1) {
      report("FAIL", "web search ran exactly once", `${searches.length} executions for one request`);
    } else if (searches.length === 1 && /quota|rate/.test(searches[0].outcome?.result?.reason ?? "")) {
      // The user-facing message carries the provider's advised wait; no secret is in it.
      report("WARN", "web search", `ran once; Gemini quota: ${searches[0].outcome.result.reason} (${String(searches[0].outcome.result.userMessage ?? "").slice(0, 160)})`);
    } else if (quota(search.error?.code)) {
      report("WARN", "web search", `planner out of quota (${search.error.code}); search not exercised`);
    } else if (searches.length === 0 && search.done) {
      report("WARN", "web search", "the model answered without calling web.search; search not exercised");
    } else {
      report("FAIL", "web search", JSON.stringify({ status: search.status, code: search.error?.code, result: searches[0]?.result?.status }));
    }
  }

  // ---- File upload ---------------------------------------------------------------------------
  const form = new FormData();
  form.append("file", new Blob([tinyPdf()], { type: "application/pdf" }), "smoke.pdf");
  const upload = await call("POST", "/api/v1/documents/extract", { token: guestToken, raw: form });
  report(upload.status === 200 && /ZARVIS smoke test/.test(upload.json?.text ?? "") ? "PASS" : "FAIL", "PDF upload is extracted", `HTTP ${upload.status} ${upload.json?.error ?? ""}`);
  const bad = new FormData();
  bad.append("file", new Blob([Buffer.from("MZ\u0090\u0000")], { type: "application/x-msdownload" }), "smoke.exe");
  const unsupported = await call("POST", "/api/v1/documents/extract", { token: guestToken, raw: bad });
  report(unsupported.status === 415 ? "PASS" : "FAIL", "an unsupported file type is refused (415)", `HTTP ${unsupported.status}`);

  // ---- Voice (TTS) ---------------------------------------------------------------------------
  await voiceChecks(guestToken);

  // ---- Cleanup -------------------------------------------------------------------------------
  if (accountToken) {
    const del = await call("DELETE", "/api/v1/account", { token: accountToken });
    const gone = await call("POST", "/api/v1/auth/login", { body: { email, password } });
    report(del.status === 204 && gone.status === 401 ? "PASS" : "FAIL", "delete the sign-up account; its login stops working", `delete HTTP ${del.status}, login HTTP ${gone.status}`);
  }
}

main()
  .catch((err) => report("FAIL", "smoke run", err instanceof Error ? err.message : String(err)))
  .finally(() => {
    const count = (s) => results.filter((r) => r === s).length;
    console.log(`\n${count("PASS")} passed, ${count("WARN")} warnings, ${count("FAIL")} failed`);
    process.exit(count("FAIL") ? 1 : 0);
  });
