import { afterEach, describe, expect, it, vi } from "vitest";
import { parseModelList, pickCandidates, runProbe, type ProbeOptions } from "../../scripts/openrouter-probe.js";
import { OPENROUTER_KEY, openRouterCall, openRouterFail, openRouterText, stubProviders, type RecordedCall, type Responder } from "../ai/gatewayHarness.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** OpenRouter's public `GET /models` payload, in the shape the API documents. */
const catalogBody = (
  models: Array<{ id: string; context?: number; prompt?: string; completion?: string; params?: string[] }> = [
    { id: "openrouter/free", context: 200000, prompt: "0", completion: "0", params: ["tools"] },
    { id: "vendor/big-free:free", context: 131072, prompt: "0", completion: "0", params: ["tools", "temperature"] },
    { id: "vendor/small-free:free", context: 8192, prompt: "0", completion: "0", params: ["tools"] },
    { id: "vendor/free-no-tools:free", context: 262144, prompt: "0", completion: "0", params: ["temperature"] },
    { id: "vendor/paid-tools", context: 1000000, prompt: "0.000003", completion: "0.000015", params: ["tools"] },
    { id: "vendor/mid-free:free", context: 65536, prompt: "0", completion: "0", params: ["tools"] },
  ],
) => ({ data: models.map((m) => ({ id: m.id, context_length: m.context, pricing: { prompt: m.prompt, completion: m.completion }, supported_parameters: m.params })) });

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** The kinds of request the probe sends, told apart the way OpenRouter would see them. */
const isModelList = (call: RecordedCall) => call.url.endsWith("/models");
const isToolProbe = (call: RecordedCall) => call.body?.tools?.length === 1 && call.body.tools[0].function.name === "probe-add";
const isPlanner = (call: RecordedCall) => (call.body?.tools?.length ?? 0) > 1;

interface Script {
  catalog?: unknown;
  text?: Responder;
  tools?: Responder;
  planner?: Responder;
  /** Per-model overrides, keyed by model id; they win over `text` and `tools`. */
  textBy?: Record<string, Responder>;
  toolsBy?: Record<string, Responder>;
}

/** An OpenRouter that answers by the kind of request (and, for the overrides, by the model asked for). */
function openRouter(script: Script = {}): Responder {
  return (call) => {
    if (isModelList(call)) return json(script.catalog ?? catalogBody());
    const model = String(call.body?.model);
    if (isToolProbe(call)) return (script.toolsBy?.[model] ?? script.tools ?? openRouterCall("probe-add", { a: 2, b: 3 }))(call);
    if (isPlanner(call)) return (script.planner ?? openRouterText("2 plus 2 is 4."))(call);
    return (script.textBy?.[model] ?? script.text ?? openRouterText("OK"))(call);
  };
}

async function probe(options: Partial<ProbeOptions>, script: Script = {}) {
  const lines: string[] = [];
  const stub = stubProviders({ openrouter: openRouter(script) });
  const outcome = await runProbe({ apiKey: OPENROUTER_KEY, candidates: 0, ...options, print: (line) => lines.push(line) });
  return { outcome, lines, stub, output: lines.join("\n") };
}

describe("the public model list", () => {
  it("reads free, tool-capable models defensively and ignores entries it cannot use", () => {
    const parsed = parseModelList({
      data: [
        { id: "a/free:free", context_length: 32768, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
        { id: "b/paid", context_length: 8000, pricing: { prompt: "0.1", completion: "0.2" }, supported_parameters: [] },
        { id: "c/zero-priced", context_length: "65536", pricing: { prompt: "0", completion: "0" } },
        { id: "d/empty-price", context_length: 1000, pricing: { prompt: "", completion: "" } },
        { context_length: 5 },
        null,
        "garbage",
      ],
    });

    expect(parsed).toEqual([
      { id: "a/free:free", contextLength: 32768, free: true, tools: true },
      { id: "b/paid", contextLength: 8000, free: false, tools: false },
      { id: "c/zero-priced", contextLength: 65536, free: true, tools: false },
      { id: "d/empty-price", contextLength: 1000, free: false, tools: false },
    ]);
    expect(parseModelList(undefined)).toEqual([]);
    expect(parseModelList({ data: "nope" })).toEqual([]);
  });

  it("picks only free models with tools and a usable context, largest first, never the requested one or a router", () => {
    const models = parseModelList(catalogBody());

    expect(pickCandidates(models, 5, []).map((m) => m.id)).toEqual(["vendor/big-free:free", "vendor/mid-free:free"]);
    expect(pickCandidates(models, 1, []).map((m) => m.id)).toEqual(["vendor/big-free:free"]);
    expect(pickCandidates(models, 5, ["vendor/big-free:free"]).map((m) => m.id)).toEqual(["vendor/mid-free:free"]);
    expect(pickCandidates(models, 0, [])).toEqual([]);
  });
});

describe("runProbe against a stubbed OpenRouter", () => {
  it("passes end to end: plain request, tool call, a real ZARVIS turn, and recommends the settings", async () => {
    const { outcome, output, stub } = await probe({});

    expect(outcome.ok).toBe(true);
    expect(outcome.recommended).toBe("openrouter/free");
    expect(output).toMatch(/PASS public model list — 6 models, 5 free, 4 free with tool support/);
    expect(output).toMatch(/PASS openrouter\/free · plain request — "OK" from vendor\/served-free-model:free/);
    expect(output).toMatch(/PASS openrouter\/free · tool call — called probe\.add with a=2, b=3/);
    expect(output).toMatch(/PASS a real ZARVIS turn \(OpenRouter only\) — answered: "2 plus 2 is 4\."/);
    expect(output).toMatch(/OPENROUTER_MODEL=openrouter\/free\n {2}OPENROUTER_MODEL_CAPABILITIES=tools/);

    // The real turn's planner request carried the whole skill registry, not a toy tool.
    const planner = stub.openrouter.find(isPlanner)!;
    expect(planner.body.tools.length).toBeGreaterThan(5);
    expect(planner.body.model).toBe("openrouter/free");
  });

  it("sends the key only as an Authorization header to the chat endpoint, never to the public list, and never prints it", async () => {
    const { stub, output } = await probe({}, { text: openRouterFail(401, `bad key ${OPENROUTER_KEY}`) });

    const list = stub.openrouter.find(isModelList)!;
    expect(list.headers.authorization).toBeUndefined();
    for (const call of stub.openrouter.filter((c) => !isModelList(c))) {
      expect(call.headers.authorization).toBe(`Bearer ${OPENROUTER_KEY}`);
      expect(call.url).not.toContain(OPENROUTER_KEY);
      expect(JSON.stringify(call.body)).not.toContain(OPENROUTER_KEY);
    }
    expect(output).not.toContain(OPENROUTER_KEY);
    expect(output).not.toContain("testkeyBBBB2222");
  });

  it("does not spend a tool-call request on a model whose plain request failed", async () => {
    const { outcome, output, stub } = await probe({}, { text: openRouterFail(401, "No auth credentials found") });

    expect(outcome.ok).toBe(false);
    expect(outcome.results[0]!.text.status).toBe("FAIL");
    expect(outcome.results[0]!.text.detail).toMatch(/^AI_PROVIDER_AUTH_ERROR \(HTTP 401\)/);
    expect(outcome.results[0]!.tools.status).toBe("SKIP");
    expect(stub.openrouter.filter((c) => !isModelList(c))).toHaveLength(1);
    expect(output).toMatch(/SKIP a real ZARVIS turn \(OpenRouter only\) — not run/);
    expect(output).toMatch(/No tested model answered/);
  });

  it("reports a model without tool support as such, and says chat turns cannot fall back to it", async () => {
    const { outcome, output } = await probe({}, { tools: openRouterFail(404, "No endpoints found that support tool use") });

    expect(outcome.ok).toBe(false);
    expect(outcome.recommended).toBeUndefined();
    expect(outcome.results[0]!.text.status).toBe("PASS");
    expect(outcome.results[0]!.tools.status).toBe("FAIL");
    expect(outcome.results[0]!.tools.detail).toMatch(/^AI_PROVIDER_CAPABILITY_UNSUPPORTED \(HTTP 404\): .*support tool use/);
    expect(output).toMatch(/OpenRouter answers plain requests, but no tested model passed the tool-call request/);
    expect(output).not.toMatch(/OPENROUTER_MODEL=/);
  });

  it("a model that answers in text without calling the tool is a warning, not a pass", async () => {
    const { outcome, output } = await probe({}, { tools: openRouterText("The sum is 5.") });

    expect(outcome.results[0]!.tools.status).toBe("WARN");
    expect(output).toMatch(/WARN openrouter\/free · tool call — the model answered in text and did not call the tool/);
    expect(outcome.ok).toBe(false);
  });

  it("tries free tool-capable candidates from the public list, and recommends the first model that passes both", async () => {
    const { outcome, output, stub } = await probe({ candidates: 2 }, { toolsBy: { "openrouter/free": openRouterFail(404, "No endpoints found that support tool use") } });

    expect(outcome.results.map((r) => r.model)).toEqual(["openrouter/free", "vendor/big-free:free", "vendor/mid-free:free"]);
    expect(outcome.recommended).toBe("vendor/big-free:free");
    expect(outcome.ok).toBe(true);
    expect(output).toMatch(/OPENROUTER_MODEL=vendor\/big-free:free/);
    // The real turn ran on the winner, not on the configured model that failed.
    expect(stub.openrouter.find(isPlanner)!.body.model).toBe("vendor/big-free:free");
  });

  it("tests the model you ask for first", async () => {
    const { outcome, stub } = await probe({ model: "vendor/mid-free:free" });

    expect(outcome.results[0]!.model).toBe("vendor/mid-free:free");
    expect(outcome.recommended).toBe("vendor/mid-free:free");
    expect(stub.openrouter.filter((c) => !isModelList(c)).every((c) => c.body.model === "vendor/mid-free:free")).toBe(true);
  });

  it("warns about a model that is not in the public list, and about one the list says has no tool support", async () => {
    const unknown = await probe({ model: "vendor/typo:free" });
    expect(unknown.output).toMatch(/WARN vendor\/typo:free · per the public list — not found/);

    const noTools = await probe({ model: "vendor/free-no-tools:free" });
    expect(noTools.output).toMatch(/WARN vendor\/free-no-tools:free · per the public list — context 262144, free, tool support no/);
  });

  it("still runs when the public list is unavailable, and skips the candidates", async () => {
    const lines: string[] = [];
    const stub = stubProviders({ openrouter: (call) => (isModelList(call) ? new Response("down", { status: 503 }) : openRouter()(call)) });

    const outcome = await runProbe({ apiKey: OPENROUTER_KEY, candidates: 3, print: (line) => lines.push(line) });

    expect(outcome.results.map((r) => r.model)).toEqual(["openrouter/free"]);
    expect(lines.join("\n")).toMatch(/WARN public model list — unavailable/);
    expect(outcome.ok).toBe(true);
    expect(stub.openrouter.filter(isModelList)).toHaveLength(1);
  });

  it("without a key it says so and touches no network", async () => {
    const { outcome, output, stub } = await probe({ apiKey: "  " });

    expect(outcome.ok).toBe(false);
    expect(output).toMatch(/^FAIL OPENROUTER_API_KEY — not set/);
    expect(stub.calls).toHaveLength(0);
  });

  it("refuses an invalid model id before any request", async () => {
    const { outcome, output, stub } = await probe({ model: "bad model; rm -rf" });

    expect(outcome.ok).toBe(false);
    expect(output).toMatch(/FAIL model id — is not a valid OpenRouter model id/);
    expect(stub.calls).toHaveLength(0);
  });

  it("treats a blank or non-numeric candidate count as the default of two, and clamps the range", async () => {
    const blank = await probe({ candidates: Number.NaN });
    expect(blank.outcome.results).toHaveLength(1 + 2);

    const clamped = await probe({ candidates: 99 });
    expect(clamped.outcome.results).toHaveLength(1 + 2); // only two qualify in the stub catalog, and 5 is the cap anyway

    const none = await probe({ candidates: -4 });
    expect(none.outcome.results).toHaveLength(1);
  });
});
