/**
 * Live probe of the Gemini key, through this repository's own code: does chat answer, which speech models
 * does the key list, and does the Gemini voice (the second voice behind Edge, `tts/geminiTtsProvider.ts`)
 * produce audio. It exists because the voice has only ever been tested against fakes: the build
 * environment cannot reach Google, and a model id or a free-tier quota can make every request fail.
 *
 * Run by the "Gemini live probe" workflow (`.github/workflows/gemini-probe.yml`) with the repository secret
 * GEMINI_API_KEY. The key is only sent in the `x-goog-api-key` header; it is registered with the log redactor
 * and never printed. A run sends a handful of short requests (one chat, up to six speech), so it is never
 * scheduled. Output is one `PASS|WARN|FAIL|SKIP|INFO name — detail` line per finding.
 */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { AIProviderError } from "../src/ai/geminiErrors.js";
import { redactString, registerSecret } from "../src/security/redact.js";
import { DEFAULT_GEMINI_TTS_MODEL, DEFAULT_GEMINI_TTS_VOICE, GeminiTtsProvider } from "../src/tts/geminiTtsProvider.js";
import { TtsProviderError } from "../src/tts/provider.js";
import { TTS_SAMPLE_RATE } from "../src/tts/wav.js";

export type RowStatus = "PASS" | "WARN" | "FAIL" | "SKIP" | "INFO";
export interface ProbeRow {
  status: RowStatus;
  name: string;
  detail: string;
}
export interface GeminiProbeOptions {
  apiKey: string | undefined;
  /** Defaults to Google's public API. */
  baseUrl?: string;
  /** Where lines go; defaults to the console. */
  print?: (line: string) => void;
}
export interface GeminiProbeOutcome {
  /** True when no check failed. */
  ok: boolean;
  /** True when some speech model produced audio. */
  voiceWorks: boolean;
  rows: ProbeRow[];
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const ENGLISH = "Hello. This is a short test of the ZARVIS voice.";
const HINDI = "नमस्ते, यह ज़ार्विस की आवाज़ का एक छोटा परीक्षण है।";
/** The other speech models tried, one request each, only when the configured one did not work. */
const MAX_OTHER_MODELS = 3;
const MAX_DETAIL_CHARS = 600;
const BYTES_PER_SECOND = TTS_SAMPLE_RATE * 2;

/** Text from the network on one log line: GitHub Actions reads a line that starts with `::` as a workflow command. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
const seconds = (started: number): string => ((Date.now() - started) / 1000).toFixed(1);

/** The structured kind, the HTTP status and Google's own (bounded, key-scrubbed) explanation. */
function describeError(error: unknown): string {
  if (error instanceof TtsProviderError) {
    const cause = error.cause instanceof Error ? error.cause.message : "";
    return oneLine(`${error.kind}: ${redactString(error.message)}${cause ? ` — ${redactString(cause)}` : ""}`).slice(0, MAX_DETAIL_CHARS);
  }
  if (error instanceof AIProviderError) return oneLine(`${error.kind} (HTTP ${error.status || "none"}): ${redactString(error.message)}`).slice(0, MAX_DETAIL_CHARS);
  return oneLine(redactString(error instanceof Error ? error.message : String(error))).slice(0, MAX_DETAIL_CHARS);
}

// ---- chat ---------------------------------------------------------------------------------------

async function chatCheck(apiKey: string): Promise<ProbeRow> {
  const name = "Gemini chat";
  const started = Date.now();
  try {
    const [{ createModelGateway }, { env }] = await Promise.all([import("../src/ai/providerFactory.js"), import("../src/config/env.js")]);
    // Gemini alone: the question is whether this key answers, not whether a fallback does.
    const gateway = createModelGateway(
      { ...env, geminiApiKey: apiKey, openRouterApiKey: undefined, aiPrimaryProvider: "gemini", aiFallbackProvider: "none", openRouterDiscovery: "off" },
      { isProduction: true },
    );
    const answer = await gateway.generate({
      systemPrompt: "You are a connectivity probe. Answer in one short sentence.",
      messages: [{ role: "user", content: "What is 2 plus 2?" }],
      modelConfig: { provider: "gateway", model: "ignored-by-routing", maxTokens: 64 },
      purpose: "generation",
    });
    const text = oneLine(redactString(answer.message.content ?? "")).slice(0, 120);
    const correct = /\b(4|four)\b/i.test(text);
    return { status: correct ? "PASS" : "WARN", name, detail: `${correct ? "answered" : "answered, but not with 4"}: "${text}" by ${answer.meta?.model ?? "?"} in ${seconds(started)} s` };
  } catch (error) {
    return { status: "FAIL", name, detail: describeError(error) };
  }
}

// ---- the speech models the key can see ------------------------------------------------------------

interface ListedModel {
  id: string;
  methods: string[];
}

async function listModels(apiKey: string, baseUrl: string): Promise<ListedModel[]> {
  const models: ListedModel[] = [];
  let pageToken = "";
  for (let page = 0; page < 6; page += 1) {
    const url = `${baseUrl.replace(/\/$/, "")}/models?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await fetch(url, { headers: { "x-goog-api-key": apiKey, accept: "application/json" }, signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${oneLine(redactString(await res.text().catch(() => ""))).slice(0, 300)}`);
    const json = (await res.json()) as { models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown }>; nextPageToken?: unknown };
    for (const item of json.models ?? []) {
      if (typeof item.name !== "string") continue;
      const id = item.name.replace(/^models\//, "");
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(id)) continue;
      models.push({ id, methods: Array.isArray(item.supportedGenerationMethods) ? item.supportedGenerationMethods.filter((m): m is string => typeof m === "string") : [] });
    }
    if (typeof json.nextPageToken !== "string" || !json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return models;
}

// ---- one speech request, through the provider ZARVIS uses ------------------------------------------

async function speak(options: { apiKey: string; baseUrl: string; model: string; text: string; label: string }): Promise<{ row: ProbeRow; servedModel?: string }> {
  const attempts: Array<{ model: string; status: number }> = [];
  // Records which model each request went to and what Google answered, so a failure names every model tried.
  const recorder: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    attempts.push({ model: /models\/([^:]+):/.exec(String(input))?.[1] ?? "?", status: response.status });
    return response;
  };
  const provider = new GeminiTtsProvider({
    apiKey: options.apiKey,
    model: options.model,
    voice: DEFAULT_GEMINI_TTS_VOICE,
    baseUrl: options.baseUrl,
    fetchImpl: recorder,
    timeoutMs: 30_000,
    // No waiting between tries: the probe wants the answer, and must not burn the quota it is measuring.
    retryDelayMs: () => null,
  });
  const name = `Gemini voice · ${options.label}`;
  const started = Date.now();
  let bytes = 0;
  try {
    for await (const pcm of provider.synthesizeStream(options.text)) bytes += pcm.length;
  } catch (error) {
    const tried = attempts.map((a) => `${a.model} → HTTP ${a.status}`).join(", ");
    return { row: { status: "FAIL", name, detail: `${describeError(error)}${tried ? ` (tried: ${tried})` : ""}` } };
  }
  const served = [...attempts].reverse().find((a) => a.status === 200)?.model;
  const audio = bytes / BYTES_PER_SECOND;
  return {
    servedModel: served,
    row: {
      status: bytes > 0 ? "PASS" : "FAIL",
      name,
      detail: `${audio.toFixed(1)} s of 24 kHz 16-bit mono audio from ${served ?? options.model} in ${seconds(started)} s${attempts.length > 1 ? ` (after ${attempts.slice(0, -1).map((a) => `${a.model} HTTP ${a.status}`).join(", ")})` : ""}`,
    },
  };
}

// ---- the whole probe --------------------------------------------------------------------------------

export async function runGeminiProbe(options: GeminiProbeOptions): Promise<GeminiProbeOutcome> {
  const print = options.print ?? ((line: string) => console.log(line));
  const rows: ProbeRow[] = [];
  const add = (row: ProbeRow): ProbeRow => {
    rows.push(row);
    print(`${row.status.padEnd(4)} ${row.name} — ${row.detail}`);
    return row;
  };

  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    add({ status: "FAIL", name: "GEMINI_API_KEY", detail: "not set. Add it as a repository secret (Settings, Secrets and variables, Actions) and run the workflow again." });
    return { ok: false, voiceWorks: false, rows };
  }
  registerSecret(apiKey);
  add({ status: "PASS", name: "GEMINI_API_KEY", detail: "present (its value is never printed)" });
  const baseUrl = options.baseUrl?.trim() || DEFAULT_BASE_URL;

  add(await chatCheck(apiKey));

  let speechModels: string[] = [];
  try {
    const listed = await listModels(apiKey, baseUrl);
    speechModels = listed.filter((model) => /tts/i.test(model.id)).map((model) => model.id);
    add({ status: "PASS", name: "model list", detail: `${listed.length} models visible to this key, ${speechModels.length} speech (tts)` });
    add({
      status: speechModels.length > 0 ? "INFO" : "WARN",
      name: "speech models",
      detail: speechModels.length > 0 ? speechModels.join(", ") : "none: this key lists no model with tts in its name, so the Gemini voice has nothing to speak with",
    });
    if (speechModels.length > 0 && !speechModels.includes(DEFAULT_GEMINI_TTS_MODEL)) {
      add({
        status: "WARN",
        name: `${DEFAULT_GEMINI_TTS_MODEL} · per the model list`,
        detail: `the default speech model is not offered to this key; set GEMINI_TTS_MODEL to one of the speech models above (for example ${speechModels[0]})`,
      });
    }
  } catch (error) {
    add({ status: "WARN", name: "model list", detail: `unavailable (${describeError(error)})` });
  }

  let voiceWorks = false;
  const first = await speak({ apiKey, baseUrl, model: DEFAULT_GEMINI_TTS_MODEL, text: ENGLISH, label: `English, ${DEFAULT_GEMINI_TTS_MODEL}` });
  add(first.row);
  let working = first.row.status === "PASS" ? (first.servedModel ?? DEFAULT_GEMINI_TTS_MODEL) : undefined;
  voiceWorks = working !== undefined;

  if (!working) {
    // The configured model did not work: say whether any other speech model on the list does.
    const others = speechModels.filter((id) => id !== DEFAULT_GEMINI_TTS_MODEL).slice(0, MAX_OTHER_MODELS);
    for (const model of others) {
      const result = await speak({ apiKey, baseUrl, model, text: ENGLISH, label: `English, ${model}` });
      add(result.row);
      if (result.row.status === "PASS") {
        working = result.servedModel ?? model;
        voiceWorks = true;
        break;
      }
    }
    if (working) add({ status: "INFO", name: "recommended setting", detail: `GEMINI_TTS_MODEL=${working}` });
  }
  if (working) {
    const hindi = await speak({ apiKey, baseUrl, model: working, text: HINDI, label: "Hindi" });
    add(hindi.row);
  } else {
    add({ status: "SKIP", name: "Gemini voice · Hindi", detail: "not tried: no speech model produced audio" });
  }

  writeStepSummary(rows);
  print("");
  if (!voiceWorks) {
    print("No Gemini speech model produced audio with this key. The FAIL lines above carry the structured kind, the HTTP status and Google's own explanation.");
  }
  return { ok: !rows.some((row) => row.status === "FAIL"), voiceWorks, rows };
}

const escapeCell = (text: string): string => text.replace(/[|`\r\n]+/g, " ").trim();

/** Mirrors the result into the GitHub Actions job summary, when running there. */
function writeStepSummary(rows: readonly ProbeRow[]): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const lines = ["## Gemini live probe", "", "| Check | Result |", "|---|---|", ...rows.map((row) => `| ${escapeCell(row.name)} | ${row.status}: ${escapeCell(row.detail)} |`), ""];
  try {
    appendFileSync(path, lines.join("\n") + "\n");
  } catch {
    // The summary is a convenience; the log lines above are the record.
  }
}

// ---- command line -------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const outcome = await runGeminiProbe({ apiKey: process.env.GEMINI_API_KEY, baseUrl: process.env.GEMINI_BASE_URL });
  process.exitCode = outcome.ok ? 0 : 1;
}
