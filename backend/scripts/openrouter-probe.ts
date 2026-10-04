/**
 * OpenRouter live probe: finds out, against the REAL OpenRouter API, whether OpenRouter works for
 * ZARVIS, and which model to configure. Nothing else in this repository has ever called the live
 * API (the build sandbox cannot reach openrouter.ai), so this is the one place that proves the
 * adapter's wire format, the API key, the account's privacy and credit settings, and a model's
 * tool support.
 *
 * It uses this repository's own adapter (`src/ai/openRouterProvider.ts`), not a separate client:
 *
 *   1. the public model list: how many free models support tools (no key is sent);
 *   2. for the configured model, and then down a ranked list of free models that the list says
 *      support tools (until a few of them answer): a plain request, then a tool-call request;
 *   3. for the models that called the tool (a pinned model before a router, up to three), one real
 *      ZARVIS turn (planner prompt with the real skill registry) through an OpenRouter-only
 *      ModelGateway. That turn is the verdict: a model is recommended only when it answers it
 *      correctly.
 *
 * The API key is only ever sent as the Authorization header by the adapter. It is registered with
 * the log redactor and never printed. Output is one `PASS|WARN|FAIL|SKIP name — detail` line per
 * check, then the settings to copy into Vercel (they contain no secret).
 *
 * Run it from GitHub Actions (`.github/workflows/openrouter-probe.yml`, manual), or locally:
 *   OPENROUTER_API_KEY=... npx tsx scripts/openrouter-probe.ts
 * Optional: PROBE_MODEL=<model id>, PROBE_CANDIDATES=<0-5>, OPENROUTER_BASE_URL=<https url>.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { withModelCallLog, type ModelCallRecord } from "../src/ai/callTrace.js";
import { AIProviderError } from "../src/ai/geminiErrors.js";
import { DEFAULT_OPENROUTER_BASE_URL, OpenRouterProvider } from "../src/ai/openRouterProvider.js";
import type { AIRequest, ToolDefinition } from "../src/ai/provider.js";
import { redactString, registerSecret } from "../src/security/redact.js";

export type RowStatus = "PASS" | "WARN" | "FAIL" | "SKIP" | "INFO";
export interface ProbeRow {
  status: RowStatus;
  name: string;
  detail: string;
}
export interface ModelResult {
  model: string;
  text: ProbeRow;
  tools: ProbeRow;
  /** The real ZARVIS turn, for a model that was given one. */
  turn?: ProbeRow;
}
export interface ProbeOptions {
  apiKey: string | undefined;
  /** Defaults to the public OpenRouter API. */
  baseUrl?: string;
  /** The model to test first; blank means `openrouter/free`, the gateway's default. */
  model?: string;
  /** How many other free models that the public list says support tools to try (0 to 5). */
  candidates?: number;
  /** Where lines go; defaults to the console. */
  print?: (line: string) => void;
}
export interface ProbeOutcome {
  /** True when some tested model called the tool and then answered a real ZARVIS turn correctly. */
  ok: boolean;
  /** The model to configure: the first one that did. */
  recommended?: string;
  rows: ProbeRow[];
  results: ModelResult[];
}

const DEFAULT_MODEL = "openrouter/free";
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const MIN_CONTEXT_FOR_CANDIDATES = 32_000;
const REQUEST_TIMEOUT_MS = 45_000;
/**
 * Output budget of the plain and tool-call requests. A reasoning model spends part of it thinking
 * before it writes: with 32 tokens the first live run got an empty message from `openrouter/free`.
 */
const PROBE_MAX_TOKENS = 256;
/** How many more candidates than asked for may be tried when some refuse (each costs a free-tier request). */
const EXTRA_CANDIDATE_ATTEMPTS = 4;
/** How many models are given a real ZARVIS turn when the earlier ones do not answer it correctly. */
const MAX_TURN_TRIES = 3;
/** A failure keeps this much of OpenRouter's explanation: a routing refusal lists its reasons last. */
const MAX_DETAIL_CHARS = 900;

// ---- the public model list ----------------------------------------------------------------------

export interface CatalogModel {
  id: string;
  contextLength: number;
  free: boolean;
  tools: boolean;
}

const isZeroPrice = (value: unknown): boolean => (typeof value === "string" ? value.trim() !== "" && Number(value) === 0 : value === 0);

/** Reads OpenRouter's `GET /models` payload defensively: an entry without an id is ignored. */
export function parseModelList(json: unknown): CatalogModel[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const models: CatalogModel[] = [];
  for (const entry of data) {
    const item = entry as { id?: unknown; context_length?: unknown; pricing?: { prompt?: unknown; completion?: unknown }; supported_parameters?: unknown } | null;
    // An id that is not a plain model id is never printed or sent back to the API.
    if (!item || typeof item.id !== "string" || !MODEL_ID.test(item.id)) continue;
    const contextLength = Number(item.context_length);
    models.push({
      id: item.id,
      contextLength: Number.isFinite(contextLength) ? contextLength : 0,
      free: item.id.endsWith(":free") || (isZeroPrice(item.pricing?.prompt) && isZeroPrice(item.pricing?.completion)),
      tools: Array.isArray(item.supported_parameters) && item.supported_parameters.includes("tools"),
    });
  }
  return models;
}

/** Free models with tool support and a usable context, largest context first (a stable order). */
export function pickCandidates(models: readonly CatalogModel[], count: number, exclude: readonly string[]): CatalogModel[] {
  return models
    .filter((m) => m.free && m.tools && m.contextLength >= MIN_CONTEXT_FOR_CANDIDATES && !exclude.includes(m.id) && !m.id.startsWith("openrouter/"))
    .sort((a, b) => b.contextLength - a.contextLength || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, count));
}

async function fetchModelList(baseUrl: string): Promise<CatalogModel[]> {
  // Public endpoint: no credentials are sent.
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseModelList(await res.json());
}

// ---- one model: a plain request, then a tool call -----------------------------------------------

/**
 * Text from the network on one log line: GitHub Actions reads a line that starts with `::` as a
 * workflow command, so a line break inside what a server sent must not start a new line.
 */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** What an operator needs from a failure: the structured kind, the HTTP status and a bounded, scrubbed message. */
function describeError(error: unknown): string {
  if (error instanceof AIProviderError) return oneLine(`${error.kind} (HTTP ${error.status || "none"}): ${redactString(error.message)}`).slice(0, MAX_DETAIL_CHARS);
  return oneLine(redactString(error instanceof Error ? error.message : String(error))).slice(0, MAX_DETAIL_CHARS);
}

const seconds = (started: number): string => ((Date.now() - started) / 1000).toFixed(1);

/** The model OpenRouter says answered, when it is not the one asked for: a router picks its own. */
function servedInstead(records: readonly ModelCallRecord[], model: string): string | undefined {
  const served = records.find((record) => record.servedModel)?.servedModel;
  return served && served !== model ? served : undefined;
}

const servedNote = (served: string | undefined): string => (served ? ` (served by ${served})` : "");

const ADD_TOOL: ToolDefinition = {
  // A dotted name on purpose: ZARVIS skill ids contain dots, which the adapter must encode and decode.
  name: "probe.add",
  description: "Adds two numbers and returns their sum.",
  inputSchema: { requiredFields: ["a", "b"], properties: { a: "number", b: "number" } },
};

function request(model: string, overrides: Partial<AIRequest>): AIRequest {
  return {
    systemPrompt: "You are a connectivity probe. Follow the instruction exactly and briefly.",
    messages: [],
    modelConfig: { provider: "openrouter", model, maxTokens: PROBE_MAX_TOKENS },
    ...overrides,
  };
}

interface Probed {
  row: ProbeRow;
  /** The model that answered when a router picked another one than was asked for. */
  served?: string;
}
interface TextProbe extends Probed {
  /** True when OpenRouter rejected the key itself (HTTP 401): no model can get around that, so none is tried. */
  keyRejected: boolean;
}

async function probeText(provider: OpenRouterProvider, model: string): Promise<TextProbe> {
  const name = `${model} · plain request`;
  const records: ModelCallRecord[] = [];
  const started = Date.now();
  try {
    const response = await withModelCallLog(records, () =>
      provider.generate(request(model, { messages: [{ role: "user", content: "Reply with the single word OK." }], purpose: "generation" })),
    );
    const answer = response.message.content.trim();
    const served = servedInstead(records, model);
    if (!answer) {
      // A reasoning model can spend its whole budget thinking and write nothing: the token count shows it.
      const used = response.usage.completionTokens;
      return { row: { status: "WARN", name, detail: `the model returned an empty message${servedNote(served)}; it used ${used} of ${PROBE_MAX_TOKENS} completion tokens` }, served, keyRejected: false };
    }
    return { row: { status: "PASS", name, detail: `"${oneLine(redactString(answer)).slice(0, 40)}" from ${served ?? model} in ${seconds(started)} s` }, served, keyRejected: false };
  } catch (error) {
    return { row: { status: "FAIL", name, detail: describeError(error) }, keyRejected: error instanceof AIProviderError && error.status === 401 };
  }
}

async function probeTools(provider: OpenRouterProvider, model: string): Promise<Probed> {
  const name = `${model} · tool call`;
  const records: ModelCallRecord[] = [];
  const started = Date.now();
  try {
    const response = await withModelCallLog(records, () =>
      provider.generate(
        request(model, { messages: [{ role: "user", content: "Use the probe.add tool to add 2 and 3. Call the tool; do not answer in text." }], tools: [ADD_TOOL], purpose: "planner" }),
      ),
    );
    const served = servedInstead(records, model);
    const call = response.toolCalls.find((candidate) => candidate.skillId === ADD_TOOL.name);
    if (call) {
      const { a, b } = call.input as { a?: unknown; b?: unknown };
      const numeric = Number(a) === 2 && Number(b) === 3;
      return numeric
        ? { row: { status: "PASS", name, detail: `called ${call.skillId} with a=2, b=3 in ${seconds(started)} s${servedNote(served)}` }, served }
        : { row: { status: "WARN", name, detail: `called ${call.skillId} but with unexpected arguments: ${oneLine(redactString(JSON.stringify(call.input))).slice(0, 80)}${servedNote(served)}` }, served };
    }
    return { row: { status: "WARN", name, detail: `the model answered in text and did not call the tool, so tool support is unclear${servedNote(served)}` }, served };
  } catch (error) {
    return { row: { status: "FAIL", name, detail: describeError(error) } };
  }
}

// ---- one real ZARVIS turn through an OpenRouter-only gateway ------------------------------------

async function realTurn(options: { apiKey: string; baseUrl: string | undefined; model: string }): Promise<ProbeRow[]> {
  const name = "a real ZARVIS turn (OpenRouter only)";
  const started = Date.now();
  try {
    const [{ buildContainer }, { InMemoryStore }, { createModelGateway }, { env }] = await Promise.all([
      import("../src/container.js"),
      import("../src/store/inMemoryStore.js"),
      import("../src/ai/providerFactory.js"),
      import("../src/config/env.js"),
    ]);
    const gateway = createModelGateway(
      {
        ...env,
        geminiApiKey: undefined,
        openRouterApiKey: options.apiKey,
        openRouterBaseUrl: options.baseUrl,
        openRouterModel: options.model,
        openRouterModelCapabilities: "tools",
        aiPrimaryProvider: "openrouter",
        aiFallbackProvider: "none",
      },
      { isProduction: true },
    );
    // The orchestrator keeps its own call log, so the models that answered are read where the gateway
    // reports them: on each response's `meta` (a router such as openrouter/free picks its own model).
    const servedBy = new Set<string>();
    const generate = gateway.generate.bind(gateway);
    gateway.generate = async (aiRequest) => {
      const response = await generate(aiRequest);
      if (response.meta?.model) servedBy.add(response.meta.model);
      return response;
    };
    const store = new InMemoryStore();
    const container = buildContainer(store, { modelGateway: gateway });
    const user = await store.createUser(`probe-${randomUUID()}@probe.invalid`, "x");
    const account = await store.createAccountForUser(user.id);
    const result = await container.orchestrator.runTurn({ accountId: account.id, utterance: "What is 2 plus 2? Answer in one short sentence.", locale: "en" });
    const counters = gateway.getProviderStatus().counters;
    const tools = result.toolCalls.map((call) => call.skillId);
    const message = oneLine(redactString(result.message));
    const correct = /\b(4|four)\b/i.test(message);
    const served = [...servedBy];
    return [
      {
        status: correct ? "PASS" : "WARN",
        name,
        detail: `${correct ? "answered" : "answered, but not with 4"}: "${message.slice(0, 120)}" (tools used: ${tools.length ? tools.join(", ") : "none"}; served by ${served.length ? served.join(", ") : options.model}) in ${seconds(started)} s`,
      },
      { status: counters.failed === 0 ? "PASS" : "WARN", name: "gateway counters for that turn", detail: `calls=${counters.calls} succeeded=${counters.succeeded} failed=${counters.failed} fallbacks=${counters.fallbacks}` },
    ];
  } catch (error) {
    return [{ status: "FAIL", name, detail: `${describeError(error)} (model ${options.model})` }];
  }
}

// ---- the whole probe ----------------------------------------------------------------------------

export async function runProbe(options: ProbeOptions): Promise<ProbeOutcome> {
  const print = options.print ?? ((line: string) => console.log(line));
  const rows: ProbeRow[] = [];
  const results: ModelResult[] = [];
  const add = (row: ProbeRow): ProbeRow => {
    rows.push(row);
    print(`${row.status.padEnd(4)} ${row.name} — ${row.detail}`);
    return row;
  };

  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    add({ status: "FAIL", name: "OPENROUTER_API_KEY", detail: "not set. Add it as a repository secret (Settings, Secrets and variables, Actions) and run the workflow again." });
    return { ok: false, rows, results };
  }
  registerSecret(apiKey);
  add({ status: "PASS", name: "OPENROUTER_API_KEY", detail: "present (its value is never printed)" });

  const baseUrl = options.baseUrl?.trim() || DEFAULT_OPENROUTER_BASE_URL;
  const model = options.model?.trim() || DEFAULT_MODEL;
  if (!MODEL_ID.test(model)) {
    add({ status: "FAIL", name: "model id", detail: "is not a valid OpenRouter model id (letters, digits and . _ : / - only)" });
    return { ok: false, rows, results };
  }
  // A blank or non-numeric setting means the default of 2; the range is 0 to 5.
  const requested = options.candidates;
  const candidateCount = requested !== undefined && Number.isFinite(requested) ? Math.min(5, Math.max(0, Math.trunc(requested))) : 2;

  let catalog: CatalogModel[] = [];
  try {
    catalog = await fetchModelList(baseUrl);
    const free = catalog.filter((m) => m.free);
    const freeWithTools = free.filter((m) => m.tools).sort((a, b) => b.contextLength - a.contextLength || a.id.localeCompare(b.id));
    add({ status: "PASS", name: "public model list", detail: `${catalog.length} models, ${free.length} free, ${freeWithTools.length} free with tool support` });
    if (freeWithTools.length > 0) {
      // So a model can be chosen by hand (the workflow's `model` input) when the walk below does not find one.
      const shown = freeWithTools.slice(0, 30).map((m) => `${m.id} (${Math.round(m.contextLength / 1000)}k)`);
      add({ status: "INFO", name: "free models with tool support", detail: `${shown.join(", ")}${freeWithTools.length > shown.length ? `, and ${freeWithTools.length - shown.length} more` : ""}` });
    }
    const listed = catalog.find((m) => m.id === model);
    if (listed) {
      add({ status: listed.tools ? "PASS" : "WARN", name: `${model} · per the public list`, detail: `context ${listed.contextLength}, ${listed.free ? "free" : "paid"}, tool support ${listed.tools ? "yes" : "no"}` });
    } else if (!model.startsWith("openrouter/")) {
      add({ status: "WARN", name: `${model} · per the public list`, detail: "not found; check the spelling on openrouter.ai/models" });
    }
  } catch (error) {
    add({ status: "WARN", name: "public model list", detail: `unavailable (${describeError(error)}); the list's candidates are skipped` });
  }

  const provider = new OpenRouterProvider({ apiKey, baseUrl, timeoutMs: REQUEST_TIMEOUT_MS });
  // The candidates are a queue to walk, not a fixed few. A model can be listed as free with tool support
  // and still refuse an ordinary app (HTTP 403 "only available on agentic harnesses") or be removed by the
  // account's data policy (HTTP 404). The walk goes on until `candidateCount` of them answered; the cap
  // bounds the free-tier requests it spends.
  const maxCandidates = candidateCount > 0 ? candidateCount + EXTRA_CANDIDATE_ATTEMPTS : 0;
  const ranked = maxCandidates > 0 ? pickCandidates(catalog, maxCandidates, [model]).map((m) => m.id) : [];
  const queue = [model];
  let answering = 0;
  let keyRejected = false;
  for (let index = 0; index < queue.length; index += 1) {
    if (index > 0 && (keyRejected || answering >= candidateCount)) break;
    const id = queue[index]!;
    const plain = await probeText(provider, id);
    const text = add(plain.row);
    keyRejected = plain.keyRejected;
    // A rejected key, an empty balance or a privacy block already ended the plain request: do not spend more.
    const toolsProbe: Probed =
      text.status === "FAIL" ? { row: { status: "SKIP", name: `${id} · tool call`, detail: "not tried: the plain request failed" } } : await probeTools(provider, id);
    const tools = add(toolsProbe.row);
    results.push({ model: id, text, tools });
    if (index > 0 && text.status !== "FAIL") answering += 1;
    if (index === 0 && maxCandidates > 0) {
      // A router (openrouter/free) serves a different model per request. Those models are known to be
      // reachable with this key and this account's settings, so they are tried before the list's ranking.
      for (const next of [plain.served, toolsProbe.served, ...ranked]) {
        if (next && MODEL_ID.test(next) && !queue.includes(next)) queue.push(next);
      }
      queue.length = Math.min(queue.length, 1 + maxCandidates);
    }
  }
  if (keyRejected && queue.length > 1) {
    add({ status: "SKIP", name: "other models", detail: "not tried: OpenRouter rejected the API key (HTTP 401), and no other model can change that" });
  }

  // A model is given a real turn once it has called the tool; that turn, not the plain request, decides.
  // A pinned model goes before a router (a router can serve each request with a different model, and an
  // account's data policy can leave its pool empty for one request and not for the next), unless a model was
  // asked for by name. A few more models get a turn when the first does not answer it correctly.
  const isRouter = (id: string): boolean => id.startsWith("openrouter/");
  const asked = Boolean(options.model?.trim());
  const rank = (r: ModelResult): number => (asked && r.model === model ? 0 : isRouter(r.model) ? 2 : 1);
  const eligible = results.filter((r) => r.text.status !== "FAIL" && r.tools.status === "PASS").sort((a, b) => rank(a) - rank(b));
  let recommended: ModelResult | undefined;
  for (const candidate of eligible.slice(0, MAX_TURN_TRIES)) {
    const turn = await realTurn({ apiKey, baseUrl: options.baseUrl?.trim() || undefined, model: candidate.model });
    for (const row of turn) add(row);
    candidate.turn = turn[0];
    if (turn[0]?.status === "PASS") {
      recommended = candidate;
      break;
    }
  }
  if (eligible.length === 0) {
    add({ status: "SKIP", name: "a real ZARVIS turn (OpenRouter only)", detail: "not run: no tested model passed the tool-call request" });
  }

  const alsoPassed = results.filter((r) => r !== recommended && r.text.status === "PASS" && r.tools.status === "PASS").map((r) => r.model);
  print("");
  if (recommended) {
    print("Settings to copy into Vercel (Preview and Production; no secret in them):");
    print(`  OPENROUTER_MODEL=${recommended.model}`);
    print("  OPENROUTER_MODEL_CAPABILITIES=tools");
    if (isRouter(recommended.model)) {
      print(`${recommended.model} is a router: each request can be served by a different free model (the lines above name who answered). To pin one, set OPENROUTER_MODEL to a model id that passed.`);
    } else if (results.some((r) => isRouter(r.model) && r.text.status !== "FAIL" && r.tools.status === "PASS")) {
      print("A pinned model is the predictable choice: a router such as openrouter/free can serve each request with a different free model, and an account's data policy can leave its pool empty for a request.");
    }
    if (alsoPassed.length > 0) print(`Also passed the plain and tool-call requests (no real turn run): ${alsoPassed.join(", ")}`);
  } else if (eligible.length > 0) {
    print("A model called the tool, but none of the models given a real ZARVIS turn answered it correctly: see the lines above. Try another model with the workflow's `model` input.");
  } else if (results.some((r) => r.text.status === "PASS")) {
    print("OpenRouter answers plain requests, but no tested model passed the tool-call request, so chat turns cannot fall back to it yet (text-only skills can). Try another model with the workflow's `model` input.");
  } else if (results.some((r) => r.text.status === "WARN")) {
    print("OpenRouter accepted the requests, but the tested models returned empty messages and none called the tool. Try another model with the workflow's `model` input.");
  } else {
    print("No tested model answered. The FAIL lines above carry the structured kind and HTTP status; the troubleshooting table in AI_MODEL_GATEWAY.md explains each.");
  }
  writeStepSummary(results, recommended?.model);
  return { ok: recommended !== undefined, recommended: recommended?.model, rows, results };
}

const escapeCell = (text: string): string => text.replace(/[|`\r\n]+/g, " ").trim();
const cell = (row: ProbeRow): string => `${row.status}: ${escapeCell(row.detail)}`;

/** Mirrors the result into the GitHub Actions job summary, when running there. */
function writeStepSummary(results: readonly ModelResult[], recommended: string | undefined): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const lines = ["## OpenRouter live probe", "", "| Model | Plain request | Tool call | Real ZARVIS turn |", "|---|---|---|---|"];
  for (const r of results) lines.push(`| \`${escapeCell(r.model)}\` | ${cell(r.text)} | ${cell(r.tools)} | ${r.turn ? cell(r.turn) : "not run"} |`);
  lines.push("");
  lines.push(
    recommended
      ? `**Recommended:** \`OPENROUTER_MODEL=${escapeCell(recommended)}\` and \`OPENROUTER_MODEL_CAPABILITIES=tools\` (Vercel, Preview and Production).`
      : "**No model has passed a real ZARVIS turn yet.** See the job log for the structured error of each failure.",
  );
  try {
    appendFileSync(path, lines.join("\n") + "\n");
  } catch {
    // The summary is a convenience; the log lines above are the record.
  }
}

// ---- command line -------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const outcome = await runProbe({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: process.env.OPENROUTER_BASE_URL,
    model: process.env.PROBE_MODEL,
    candidates: Number.parseInt(process.env.PROBE_CANDIDATES ?? "2", 10),
  });
  process.exitCode = outcome.ok ? 0 : 1;
}
