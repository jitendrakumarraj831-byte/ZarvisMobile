import { afterEach, describe, expect, it, vi } from "vitest";
import { runGeminiProbe } from "../../scripts/gemini-probe.js";
import { DAILY, quotaBody } from "../ai/geminiFixtures.js";
import { GEMINI_KEY, geminiFail, geminiText, sseResponse, stubProviders, type RecordedCall, type Responder } from "../ai/gatewayHarness.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** One second of 24 kHz 16-bit mono "audio", as Gemini's speech models stream it (base64 PCM in SSE frames). */
const speech = (): Response => {
  const pcm = Buffer.alloc(48_000, 1).toString("base64");
  return sseResponse([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm } }] } }] })}\n\n`]);
};

const modelOf = (call: RecordedCall): string => /models\/([^:/?]+)[:?]/.exec(call.url)?.[1] ?? "";
const isList = (call: RecordedCall): boolean => /\/models\?/.test(call.url);
const isSpeech = (call: RecordedCall): boolean => call.url.includes(":streamGenerateContent");

const LISTED = { models: [{ name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3.8-flash-lite-tts", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-9-voice-tts", supportedGenerationMethods: ["generateContent"] }] };

/** A Google that answers by kind of request; `speechBy` decides per speech model. */
function google(options: { list?: Response | (() => Response); chat?: Responder; speechBy?: (model: string) => Response } = {}): Responder {
  return (call) => {
    if (isList(call)) return typeof options.list === "function" ? options.list() : (options.list ?? json(LISTED));
    if (isSpeech(call)) return (options.speechBy ?? (() => speech()))(modelOf(call));
    return (options.chat ?? geminiText("2 plus 2 is 4."))(call);
  };
}

async function run(responder: Responder, options: { apiKey?: string | undefined } = {}) {
  const lines: string[] = [];
  const stub = stubProviders({ gemini: responder });
  const outcome = await runGeminiProbe({ apiKey: "apiKey" in options ? options.apiKey : GEMINI_KEY, print: (line) => lines.push(line) });
  return { outcome, output: lines.join("\n"), stub };
}

describe("the Gemini live probe", () => {
  it("passes when chat answers and the default speech model produces English and Hindi audio", async () => {
    const { outcome, output, stub } = await run(google());

    expect(output).toMatch(/PASS Gemini chat — answered: "2 plus 2 is 4\."/);
    expect(output).toMatch(/PASS model list — 3 models visible to this key, 2 speech \(tts\)/);
    expect(output).toMatch(/INFO speech models — gemini-3\.8-flash-lite-tts, gemini-9-voice-tts/);
    expect(output).toMatch(/PASS Gemini voice · English, gemini-3\.8-flash-lite-tts — 1\.0 s of 24 kHz 16-bit mono audio from gemini-3\.8-flash-lite-tts/);
    expect(output).toMatch(/PASS Gemini voice · Hindi — 1\.0 s/);
    expect(outcome).toMatchObject({ ok: true, voiceWorks: true });
    // The key travels in a header, never in a URL, and is never printed.
    for (const call of stub.gemini) {
      expect(call.headers["x-goog-api-key"]).toBe(GEMINI_KEY);
      expect(call.url).not.toContain(GEMINI_KEY);
    }
    expect(output).not.toContain(GEMINI_KEY);
  });

  it("with no key, says what to add and sends nothing", async () => {
    const { outcome, output, stub } = await run(google(), { apiKey: undefined });
    expect(output).toMatch(/FAIL GEMINI_API_KEY — not set/);
    expect(stub.calls).toHaveLength(0);
    expect(outcome.ok).toBe(false);
  });

  it("when the configured speech model is not offered, finds another that works and names the setting to change", async () => {
    const speechBy = (model: string) => (model === "gemini-9-voice-tts" ? speech() : json({ error: { code: 404, status: "NOT_FOUND", message: `models/${model} is not found for API version v1beta` } }, 404));
    const { outcome, output } = await run(google({ speechBy }));

    expect(output).toMatch(/FAIL Gemini voice · English, gemini-3\.8-flash-lite-tts — .*REJECTED.*HTTP 404.*\(tried: gemini-3\.8-flash-lite-tts → HTTP 404, gemini-3\.8-flash-tts → HTTP 404/);
    expect(output).toMatch(/PASS Gemini voice · English, gemini-9-voice-tts/);
    expect(output).toMatch(/INFO recommended setting — GEMINI_TTS_MODEL=gemini-9-voice-tts/);
    expect(output).toMatch(/PASS Gemini voice · Hindi/);
    expect(outcome.voiceWorks).toBe(true);
    expect(outcome.ok).toBe(false);
  });

  it("warns that the default speech model is not on the key's list, and which one to use", async () => {
    const list = json({ models: [{ name: "models/gemini-9-voice-tts" }] });
    const { output } = await run(google({ list }));
    expect(output).toMatch(/WARN gemini-3\.8-flash-lite-tts · per the model list — the default speech model is not offered to this key; set GEMINI_TTS_MODEL to one of the speech models above \(for example gemini-9-voice-tts\)/);
  });

  it("a spent free-tier quota is reported with Google's own words and every model tried, and Hindi is not attempted", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const quota = () => new Response(quotaBody(DAILY, "75789s"), { status: 429 });
    const { outcome, output } = await run(google({ speechBy: quota, chat: geminiFail(429, quotaBody(DAILY, "75789s")) }));

    expect(output).toMatch(/FAIL Gemini chat — AI_PROVIDER_QUOTA_EXCEEDED/);
    expect(output).toMatch(/FAIL Gemini voice · English, gemini-3\.8-flash-lite-tts — UNAVAILABLE: The Gemini voice has used up its quota/);
    expect(output).toMatch(/\(tried: gemini-3\.8-flash-lite-tts → HTTP 429, gemini-3\.8-flash-tts → HTTP 429\)/);
    expect(output).toMatch(/SKIP Gemini voice · Hindi — not tried: no speech model produced audio/);
    expect(output).toMatch(/No Gemini speech model produced audio with this key/);
    expect(outcome).toMatchObject({ ok: false, voiceWorks: false });
  });

  it("an unreadable model list is a warning, not the end: the voice is still tried", async () => {
    const { outcome, output } = await run(google({ list: () => new Response("busy", { status: 503 }) }));
    expect(output).toMatch(/WARN model list — unavailable/);
    expect(output).toMatch(/PASS Gemini voice · English/);
    expect(outcome.voiceWorks).toBe(true);
  });

  it("a text Google echoes in an error never carries the key into the log", async () => {
    const speechBy = () => json({ error: { code: 400, status: "INVALID_ARGUMENT", message: `API key not valid: ${GEMINI_KEY}` } }, 400);
    const { output } = await run(google({ speechBy }));
    expect(output).not.toContain(GEMINI_KEY);
  });
});
