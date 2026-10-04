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
 *   2. for the configured model, and for a few free models that the list says support tools:
 *      a plain request, then a tool-call request;
 *   3. for the first model that passes both, one real ZARVIS turn (planner prompt with the real
 *      skill registry) through an OpenRouter-only ModelGateway.
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

export type RowStatus = "PASS" | "WARN" | "FAIL" | "SKIP";
export interface ProbeRow {
  status: RowStatus;
  name: string;
  detail: string;
}
export interface ModelResult {
  model: string;
  text: ProbeRow;
  tools: ProbeRow;
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
  /** True when some tested model passed both checks and the real turn did not fail. */
  ok: boolean;
  /** The model to configure, when one passed both checks. */
  recommended?: string;
  rows: ProbeRow[];
  results: ModelResult[];
}

const DEFAULT_MODEL = "openrouter/free";
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const MIN_CONTEXT_FOR_CANDIDATES = 32_000;
const REQUEST_TIMEOUT_MS = 45_000;

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
    if (!item || typeof item.id !== "string" || item.id === "") continue;
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

/** What an operator needs from a failure: the structured kind, the HTTP status and a bounded, scrubbed message. */
function describeError(error: unknown): string {
  if (error instanceof AIProviderError) return `${error.kind} (HTTP ${error.status || "none"}): ${redactString(error.message)}`.slice(0, 300);
  return redactString(error instanceof Error ? error.message : String(error)).slice(0, 300);
}

const seconds = (started: number): string => ((Date.now() - started) / 1000).toFixed(1);

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
    modelConfig: { provider: "openrouter", model, maxTokens: 128 },
    ...overrides,
  };
}

async function probeText(provider: OpenRouterProvider, model: string): Promise<ProbeRow> {
  const name = `${model} · plain request`;
  const records: ModelCallRecord[] = [];
  const started = Date.now();
  try {
    const response = await withModelCallLog(records, () =>
      provider.generate(request(model, { messages: [{ role: "user", content: "Reply with the single word OK." }], purpose: "generation", modelConfig: { provider: "openrouter", model, maxTokens: 32 } })),
    );
    const answer = response.message.content.trim();
    if (!answer) return { status: "WARN", name, detail: "the model returned an empty message" };
    const served = records.find((record) => record.servedModel)?.servedModel;
    return { status: "PASS", name, detail: `"${redactString(answer).slice(0, 40)}" from ${served ?? model} in ${seconds(started)} s` };
  } catch (error) {
    return { status: "FAIL", name, detail: describeError(error) };
  }
}

async function probeTools(provider: OpenRouterProvider, model: string): Promise<ProbeRow> {
  const name = `${model} · tool call`;
  const started = Date.now();
  try {
    const response = await provider.generate(
      request(model, { messages: [{ role: "user", content: "Use the probe.add tool to add 2 and 3. Call the tool; do not answer in text." }], tools: [ADD_TOOL], purpose: "planner" }),
    );
    const call = response.toolCalls.find((candidate) => candidate.skillId === ADD_TOOL.name);
    if (call) {
      const { a, b } = call.input as { a?: unknown; b?: unknown };
      const numeric = Number(a) === 2 && Number(b) === 3;
      return numeric
        ? { status: "PASS", name, detail: `called ${call.skillId} with a=2, b=3 in ${seconds(started)} s` }
        : { status: "WARN", name, detail: `called ${call.skillId} but with unexpected arguments: ${redactString(JSON.stringify(call.input)).slice(0, 80)}` };
    }
    return { status: "WARN", name, detail: "the model answered in text and did not call the tool, so tool support is unclear" };
  } catch (error) {
    return { status: "FAIL", name, detail: describeError(error) };
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
    const store = new InMemoryStore();
    const container = buildContainer(store, { modelGateway: gateway });
    const user = await store.createUser(`probe-${randomUUID()}@probe.invalid`, "x");
    const account = await store.createAccountForUser(user.id);
    const result = await container.orchestrator.runTurn({ accountId: account.id, utterance: "What is 2 plus 2? Answer in one short sentence.", locale: "en" });
    const counters = gateway.getProviderStatus().counters;
    const tools = result.toolCalls.map((call) => call.skillId);
    const message = redactString(result.message).replace(/\s+/g, " ").trim();
    const correct = /\b(4|four)\b/i.test(message);
    return [
      {
        status: correct ? "PASS" : "WARN",
        name,
        detail: `${correct ? "answered" : "answered, but not with 4"}: "${message.slice(0, 120)}" (tools used: ${tools.length ? tools.join(", ") : "none"}) in ${seconds(started)} s`,
      },
      { status: counters.failed === 0 ? "PASS" : "WARN", name: "gateway counters for that turn", detail: `calls=${counters.calls} succeeded=${counters.succeeded} failed=${counters.failed} fallbacks=${counters.fallbacks}` },
    ];
  } catch (error) {
    return [{ status: "FAIL", name, detail: describeError(error) }];
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
    add({ status: "PASS", name: "public model list", detail: `${catalog.length} models, ${free.length} free, ${free.filter((m) => m.tools).length} free with tool support` });
    const listed = catalog.find((m) => m.id === model);
    if (listed) {
      add({ status: listed.tools ? "PASS" : "WARN", name: `${model} · per the public list`, detail: `context ${listed.contextLength}, ${listed.free ? "free" : "paid"}, tool support ${listed.tools ? "yes" : "no"}` });
    } else if (!model.startsWith("openrouter/")) {
      add({ status: "WARN", name: `${model} · per the public list`, detail: "not found; check the spelling on openrouter.ai/models" });
    }
  } catch (error) {
    add({ status: "WARN", name: "public model list", detail: `unavailable (${describeError(error)}); other candidates are skipped` });
  }

  const provider = new OpenRouterProvider({ apiKey, baseUrl, timeoutMs: REQUEST_TIMEOUT_MS });
  const toTest = [model, ...pickCandidates(catalog, candidateCount, [model]).map((m) => m.id)];
  for (const id of toTest) {
    const text = add(await probeText(provider, id));
    // A rejected key, an empty balance or a privacy block already ended the plain request: do not spend more.
    const tools =
      text.status === "FAIL"
        ? add({ status: "SKIP", name: `${id} · tool call`, detail: "not tried: the plain request failed" })
        : add(await probeTools(provider, id));
    results.push({ model: id, text, tools });
  }

  const winner = results.find((r) => r.text.status === "PASS" && r.tools.status === "PASS");
  let turnFailed = false;
  if (winner) {
    const turn = await realTurn({ apiKey, baseUrl: options.baseUrl?.trim() || undefined, model: winner.model });
    for (const row of turn) add(row);
    turnFailed = turn.some((row) => row.status === "FAIL");
  } else {
    add({ status: "SKIP", name: "a real ZARVIS turn (OpenRouter only)", detail: "not run: no tested model passed both the plain and the tool-call request" });
  }

  const recommended = winner && !turnFailed ? winner.model : undefined;
  if (recommended) {
    print("");
    print("Settings to copy into Vercel (Preview and Production; no secret in them):");
    print(`  OPENROUTER_MODEL=${recommended}`);
    print("  OPENROUTER_MODEL_CAPABILITIES=tools");
  } else if (results.some((r) => r.text.status === "PASS")) {
    print("");
    print("OpenRouter answers plain requests, but no tested model passed the tool-call request, so chat turns cannot fall back to it yet (text-only skills can). Try another model with the workflow's `model` input.");
  } else {
    print("");
    print("No tested model answered. The FAIL lines above carry the structured kind and HTTP status; the troubleshooting table in AI_MODEL_GATEWAY.md explains each.");
  }
  writeStepSummary(results, recommended);
  return { ok: recommended !== undefined, recommended, rows, results };
}

const escapeCell = (text: string): string => text.replace(/[|`\r\n]+/g, " ").trim();

/** Mirrors the result into the GitHub Actions job summary, when running there. */
function writeStepSummary(results: readonly ModelResult[], recommended: string | undefined): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const lines = ["## OpenRouter live probe", "", "| Model | Plain request | Tool call |", "|---|---|---|"];
  for (const r of results) lines.push(`| \`${escapeCell(r.model)}\` | ${r.text.status}: ${escapeCell(r.text.detail)} | ${r.tools.status}: ${escapeCell(r.tools.detail)} |`);
  lines.push("");
  lines.push(
    recommended
      ? `**Recommended:** \`OPENROUTER_MODEL=${escapeCell(recommended)}\` and \`OPENROUTER_MODEL_CAPABILITIES=tools\` (Vercel, Preview and Production).`
      : "**No model passed both checks yet.** See the job log for the structured error of each failure.",
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
