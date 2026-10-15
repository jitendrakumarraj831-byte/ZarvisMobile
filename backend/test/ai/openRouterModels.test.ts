import { afterEach, describe, expect, it, vi } from "vitest";
import { requirementsFor } from "../../src/ai/capabilities.js";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { openRouterEntry } from "../../src/ai/modelCatalog.js";
import {
  OpenRouterCatalog,
  OpenRouterModelDirectory,
  entryFromInfo,
  parseOpenRouterModels,
  selectOpenRouterModels,
  type OpenRouterModelInfo,
  type OpenRouterRoutingPolicy,
} from "../../src/ai/openRouterModels.js";
import { OPENROUTER_KEY } from "./gatewayHarness.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- fixtures: the shape of OpenRouter's GET /models ---------------------------------------------

interface RawModel {
  id: string;
  context_length?: number;
  input?: string[];
  prompt?: string;
  completion?: string;
  parameters?: string[];
  expiration_date?: string | null;
}

const raw = (model: RawModel) => ({
  id: model.id,
  context_length: model.context_length ?? 32_768,
  architecture: { input_modalities: model.input ?? ["text"] },
  pricing: { prompt: model.prompt ?? "0", completion: model.completion ?? "0" },
  supported_parameters: model.parameters ?? ["tools", "max_tokens", "temperature"],
  expiration_date: model.expiration_date ?? null,
});

const listBody = (...models: RawModel[]) => ({ data: models.map(raw) });

const LIVE = listBody(
  { id: "vendor/a:free", context_length: 131_072 },
  { id: "vendor/b:free", context_length: 262_144, parameters: ["tools", "structured_outputs", "response_format"] },
  { id: "vendor/c:free", context_length: 1_000_000, parameters: ["max_tokens"] },
  { id: "vendor/vision:free", context_length: 65_536, input: ["text", "image"], parameters: ["tools"] },
  { id: "vendor/paid", context_length: 2_000_000, prompt: "0.000001", completion: "0.000002" },
  { id: "vendor/pricey", context_length: 2_000_000, prompt: "0.00002", completion: "0.00008" },
  { id: "openrouter/free", context_length: 200_000, prompt: "-1", completion: "-1" },
  { id: "openrouter/auto", context_length: 2_000_000, prompt: "-1", completion: "-1" },
);

const infos = (body = LIVE) => parseOpenRouterModels(body);
const NOW = Date.parse("2026-10-15T12:00:00Z");
const freePolicy: OpenRouterRoutingPolicy = { allowPaid: false, explicitAlternates: [] };
const toolsNeeds = requirementsFor({ systemPrompt: "", messages: [], modelConfig: { provider: "", model: "" }, tools: [{ name: "t", description: "", inputSchema: { requiredFields: [] } }] });
const textNeeds = requirementsFor({ systemPrompt: "", messages: [], modelConfig: { provider: "", model: "" } });

function select(declaredModel: string | undefined, over: Partial<Parameters<typeof selectOpenRouterModels>[0]> = {}) {
  return selectOpenRouterModels({
    infos: infos(),
    declared: declaredModel ? [openRouterEntry({ model: declaredModel, extraCapabilities: ["tools"], contextTokens: 32_768 })] : [],
    needs: toolsNeeds,
    policy: freePolicy,
    isUnavailable: () => false,
    now: NOW,
    ...over,
  });
}
const ids = (selection: { models: Array<{ model: string }> }) => selection.models.map((entry) => entry.model);

// ---- the parser ---------------------------------------------------------------------------------

describe("parseOpenRouterModels", () => {
  it("reads context, modalities, parameters, and prices as US dollars per million tokens", () => {
    const [paid] = infos(listBody({ id: "vendor/paid", context_length: 4096, input: ["text", "image"], prompt: "0.0000005", completion: "0.0000015", parameters: ["tools", "reasoning"] }));
    expect(paid).toMatchObject({ id: "vendor/paid", contextLength: 4096, inputModalities: ["text", "image"], supportedParameters: ["tools", "reasoning"], free: false });
    expect(paid!.promptPricePerM).toBeCloseTo(0.5);
    expect(paid!.completionPricePerM).toBeCloseTo(1.5);
  });

  it("knows what is free: the :free variants, zero-priced models and the free router, and gives them a price of zero", () => {
    const byId = new Map(infos().map((info) => [info.id, info]));
    expect(byId.get("vendor/a:free")).toMatchObject({ free: true, promptPricePerM: 0, completionPricePerM: 0 });
    expect(byId.get("openrouter/free")).toMatchObject({ free: true, promptPricePerM: 0 });
    expect(byId.get("vendor/paid")!.free).toBe(false);
    // A router's price varies (-1): that is not a fixed price, so it is not treated as one.
    expect(byId.get("openrouter/auto")).toMatchObject({ free: false });
    expect(byId.get("openrouter/auto")!.promptPricePerM).toBeUndefined();
    expect(infos(listBody({ id: "vendor/zero", prompt: "0", completion: "0" }))[0]!.free).toBe(true);
  });

  it("does not mistake a price that is blank or missing for zero (an unpriced model is not free)", () => {
    const parsed = parseOpenRouterModels({ data: [{ id: "v/blank", pricing: { prompt: "", completion: "  " } }, { id: "v/none" }, { id: "v/null", pricing: { prompt: null, completion: null } }] });
    expect(parsed.map((info) => info.free)).toEqual([false, false, false]);
    expect(parsed.every((info) => info.promptPricePerM === undefined)).toBe(true);
  });

  it("reads the expiry date a model announces", () => {
    expect(infos(listBody({ id: "vendor/old:free", expiration_date: "2026-10-01" }))[0]!.expiresAt).toBe(Date.parse("2026-10-01"));
  });

  it("ignores what it cannot use: a payload that is not a list, entries without a plain model id, and absurd lists", () => {
    expect(parseOpenRouterModels(null)).toEqual([]);
    expect(parseOpenRouterModels({ data: "nope" })).toEqual([]);
    const parsed = parseOpenRouterModels({ data: [null, 5, { id: 7 }, { id: "bad id with spaces" }, { id: "../../etc/passwd\n" }, { id: "ok/model:free" }] });
    expect(parsed.map((info) => info.id)).toEqual(["ok/model:free"]);
    const huge = { data: Array.from({ length: 10_000 }, (_, index) => ({ id: `v/m${index}` })) };
    expect(parseOpenRouterModels(huge).length).toBeLessThanOrEqual(3_000);
  });
});

describe("entryFromInfo: what a model's metadata proves", () => {
  it("derives tools, structured output, vision and reasoning from supported parameters and modalities", () => {
    const entry = entryFromInfo(infos(listBody({ id: "v/m:free", context_length: 200_000, input: ["text", "image"], parameters: ["tools", "structured_outputs", "reasoning"] }))[0]!);
    expect(entry.capabilities).toMatchObject({ text: true, streaming: true, tools: true, structuredOutput: true, vision: true, reasoning: true, longContext: true });
    expect(entry.jsonSchema).toBe(true);
    expect(entry.imageMimeTypes).toContain("image/png");
    expect(entry.free).toBe(true);
  });

  it("does not claim a capability the metadata lacks, and a response_format model takes JSON but not a schema", () => {
    const entry = entryFromInfo(infos(listBody({ id: "v/m", parameters: ["max_tokens", "response_format"] }))[0]!);
    expect(entry.capabilities).toMatchObject({ tools: false, vision: false, structuredOutput: true });
    expect(entry.jsonSchema).toBe(false);
  });

  it("keeps what the operator declared on top of what the list says", () => {
    const declared = openRouterEntry({ model: "v/m", extraCapabilities: ["tools", "coding"], contextTokens: 8_000 });
    const entry = entryFromInfo(infos(listBody({ id: "v/m", context_length: 64_000, parameters: ["max_tokens"] }))[0]!, declared);
    expect(entry.capabilities).toMatchObject({ tools: true, coding: true });
    expect(entry.contextTokens).toBe(64_000);
  });
});

// ---- the selection policy -----------------------------------------------------------------------

describe("selectOpenRouterModels", () => {
  it("keeps the configured model when OpenRouter still offers it, and adds free alternates that can do the work", () => {
    const selection = select("vendor/a:free");
    expect(ids(selection)).toEqual(["vendor/a:free", "vendor/b:free", "openrouter/free"]);
  });

  it("replaces a configured model OpenRouter withdrew: largest-context free model with tools first, the free router last", () => {
    const selection = select("inclusionai/ling-3.0-flash-sante:free");
    expect(selection.notes).toContain("inclusionai/ling-3.0-flash-sante:free: not_in_live_list");
    // vendor/c:free has the biggest context but declares no tools, so a tool request does not get it.
    expect(ids(selection)).toEqual(["vendor/b:free", "vendor/a:free", "openrouter/free"]);
  });

  it("serves a plain text request from any free model", () => {
    expect(ids(select("gone/model:free", { needs: textNeeds }))).toEqual(["vendor/c:free", "vendor/b:free", "openrouter/free"]);
  });

  it("never picks a paid model unless the operator allows it, and a price limit holds either way", () => {
    expect(ids(select(undefined)).every((id) => id === "openrouter/free" || id.endsWith(":free"))).toBe(true);
    const paid = ids(select(undefined, { policy: { ...freePolicy, allowPaid: true } }));
    expect(paid).toContain("vendor/paid");
    expect(paid).not.toContain("openrouter/auto");
    const capped = ids(select(undefined, { policy: { ...freePolicy, allowPaid: true, maxPricePromptPerM: 5, maxPriceCompletionPerM: 5 } }));
    expect(capped).toContain("vendor/paid");
    expect(capped).not.toContain("vendor/pricey");
    // With a limit set, a model whose price is unknown cannot be shown to be within it.
    expect(select("openrouter/auto", { policy: { ...freePolicy, maxPricePromptPerM: 5 } }).notes).toContain("openrouter/auto: over_price_limit");
  });

  it("applies the price limit to the configured model too, and says why it was skipped", () => {
    const selection = select("vendor/pricey", { policy: { ...freePolicy, maxPricePromptPerM: 1 } });
    expect(ids(selection)).not.toContain("vendor/pricey");
    expect(selection.notes).toContain("vendor/pricey: over_price_limit");
  });

  it("leaves out a model that lacks what the request needs, one that expired, and one OpenRouter just refused", () => {
    const expired = infos(listBody({ id: "vendor/old:free", expiration_date: "2026-10-01" }, { id: "vendor/new:free" }));
    expect(ids(select(undefined, { infos: expired }))).toEqual(["vendor/new:free"]);
    expect(ids(select("vendor/a:free", { isUnavailable: (id) => id === "vendor/a:free" }))).not.toContain("vendor/a:free");
    // A named alternate has no declared capabilities of its own, so the list's metadata decides: vendor/c:free has no tools.
    const named = select(undefined, { policy: { ...freePolicy, explicitAlternates: ["vendor/c:free"] } });
    expect(named.notes).toContain("vendor/c:free: missing:tools");
    expect(ids(named)).not.toContain("vendor/c:free");
  });

  it("asks for a JSON schema only of models whose metadata says they support structured outputs", () => {
    const needs = requirementsFor({ systemPrompt: "", messages: [], modelConfig: { provider: "", model: "" }, responseFormat: { type: "json_schema", name: "x", schema: { type: "object" } } });
    const selection = select(undefined, { needs });
    expect(ids(selection)).toEqual(["vendor/b:free"]);
  });

  it("chooses a vision model for an image, by the modalities OpenRouter lists", () => {
    const needs = requirementsFor({ systemPrompt: "", messages: [], modelConfig: { provider: "", model: "" } }, { image: { mimeType: "image/png" } });
    expect(ids(select(undefined, { needs }))).toEqual(["vendor/vision:free"]);
  });

  it("puts the operator's named alternates right after the configured model, and never exceeds OpenRouter's three", () => {
    const policy = { ...freePolicy, explicitAlternates: ["vendor/b:free", "vendor/unlisted:free", "vendor/vision:free"] };
    const selection = select("vendor/a:free", { policy });
    expect(ids(selection)).toEqual(["vendor/a:free", "vendor/b:free", "vendor/vision:free"]);
    expect(selection.notes).toContain("vendor/unlisted:free: not_in_live_list");
  });

  it("is the same answer for the same inputs", () => {
    expect(ids(select("gone/x:free"))).toEqual(ids(select("gone/x:free")));
  });

  it("returns nothing when no listed model can do the work, so the caller falls back to what was declared", () => {
    expect(select("gone/x:free", { infos: [] }).models).toEqual([]);
  });
});

// ---- the live directory -------------------------------------------------------------------------

interface Hit {
  url: string;
  headers: Record<string, string>;
  redirect?: string;
}

function stubList(responder: (url: string, hits: Hit[]) => Response | Promise<Response>) {
  const hits: Hit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[name.toLowerCase()] = value;
      hits.push({ url: String(input), headers, redirect: init?.redirect });
      return responder(String(input), hits);
    }),
  );
  return hits;
}

const ok = (body: unknown = LIVE) => new Response(JSON.stringify(body), { status: 200 });

function directory(options: { key?: string | undefined; now?: () => number } = {}) {
  const key = "key" in options ? options.key : OPENROUTER_KEY;
  return new OpenRouterModelDirectory({ apiKey: () => key, now: options.now });
}

describe("OpenRouterModelDirectory", () => {
  it("asks for the account's own list first (with the key), and reads it", async () => {
    const hits = stubList(() => ok());
    const dir = directory();
    await dir.ensureFresh();

    expect(hits.map((hit) => hit.url)).toEqual(["https://openrouter.ai/api/v1/models/user"]);
    expect(hits[0]!.headers.authorization).toBe(`Bearer ${OPENROUTER_KEY}`);
    expect(hits[0]!.headers["http-referer"]).toBeDefined();
    // The key is never sent anywhere a redirect could carry it.
    expect(hits[0]!.redirect).toBe("error");
    expect(dir.status()).toMatchObject({ loaded: true, fresh: true, models: 8, source: "account", authRejected: false });
    expect(dir.status().freeModelsWithTools).toBe(4);
  });

  it("uses the public list, with no credential at all, when there is no key", async () => {
    const hits = stubList(() => ok());
    const dir = directory({ key: undefined });
    await dir.ensureFresh();
    expect(hits.map((hit) => hit.url)).toEqual(["https://openrouter.ai/api/v1/models"]);
    expect(hits[0]!.headers.authorization).toBeUndefined();
    expect(dir.status().source).toBe("public");
  });

  it("never sends a key that cannot be a key (whitespace or a line break), and uses the public list instead", async () => {
    const hits = stubList(() => ok());
    await directory({ key: "sk-or-v1-abc\ndef ghi" }).ensureFresh();
    expect(hits.map((hit) => hit.url)).toEqual(["https://openrouter.ai/api/v1/models"]);
    expect(hits[0]!.headers.authorization).toBeUndefined();
  });

  it("falls back to the public list when the account endpoint does not exist, and does not ask for it again", async () => {
    let now = 0;
    const hits = stubList((url) => (url.endsWith("/models/user") ? new Response("{}", { status: 404 }) : ok()));
    const dir = directory({ now: () => now });
    await dir.ensureFresh();
    now += 16 * 60_000;
    await dir.ensureFresh();
    expect(hits.map((hit) => hit.url)).toEqual([
      "https://openrouter.ai/api/v1/models/user",
      "https://openrouter.ai/api/v1/models",
      "https://openrouter.ai/api/v1/models",
    ]);
  });

  it("a rejected key (401) is noted, the public list still works, and a later accepted answer clears the note", async () => {
    let now = 0;
    let accept = false;
    const hits = stubList((url) => (url.endsWith("/models/user") ? (accept ? ok() : new Response("{}", { status: 401 })) : ok()));
    const dir = directory({ now: () => now });
    await dir.ensureFresh();
    expect(dir.authRejected()).toBe(true);
    expect(dir.status()).toMatchObject({ loaded: true, source: "public", authRejected: true });
    expect(hits).toHaveLength(2);

    accept = true;
    now += 16 * 60_000;
    await dir.ensureFresh();
    expect(dir.authRejected()).toBe(false);
  });

  it("reads once for many callers, and again only after the list is stale", async () => {
    let now = 0;
    const hits = stubList(() => ok());
    const dir = directory({ now: () => now });
    await Promise.all([dir.ensureFresh(), dir.ensureFresh(), dir.ensureFresh()]);
    await dir.ensureFresh();
    expect(hits).toHaveLength(1);
    now += 14 * 60_000;
    await dir.ensureFresh();
    expect(hits).toHaveLength(1);
    now += 2 * 60_000;
    await dir.ensureFresh();
    expect(hits).toHaveLength(2);
  });

  it("keeps the last good list when a refresh fails, and waits before asking again", async () => {
    let now = 0;
    let down = false;
    const hits = stubList(() => (down ? new Response("busy", { status: 503 }) : ok()));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = directory({ now: () => now });
    await dir.ensureFresh();
    down = true;
    now += 16 * 60_000;
    await dir.ensureFresh();
    expect(dir.hasData()).toBe(true);
    expect(dir.models()).toHaveLength(8);
    const afterFailure = hits.length;
    now += 10_000;
    await dir.ensureFresh();
    expect(hits).toHaveLength(afterFailure);
    now += 60_000;
    await dir.ensureFresh();
    expect(hits.length).toBeGreaterThan(afterFailure);
  });

  it("does not rely on a list older than a day", async () => {
    let now = 0;
    let down = false;
    stubList(() => (down ? new Response("busy", { status: 503 }) : ok()));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = directory({ now: () => now });
    await dir.ensureFresh();
    down = true;
    now += 25 * 60 * 60_000;
    await dir.ensureFresh();
    expect(dir.hasData()).toBe(false);
    expect(dir.models()).toEqual([]);
  });

  it("never throws: a network error, a bad body and an oversized body all leave it without data", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubList(() => {
      throw new TypeError("fetch failed");
    });
    const down = directory();
    await expect(down.ensureFresh()).resolves.toBeUndefined();
    expect(down.hasData()).toBe(false);

    stubList(() => new Response("<html>not json</html>", { status: 200 }));
    const html = directory();
    await expect(html.ensureFresh()).resolves.toBeUndefined();
    expect(html.hasData()).toBe(false);

    stubList(() => new Response("{}", { status: 200, headers: { "content-length": String(50 * 1024 * 1024) } }));
    const huge = directory();
    await expect(huge.ensureFresh()).resolves.toBeUndefined();
    expect(huge.hasData()).toBe(false);
  });

  it("remembers a refused model for a while, then forgets it", async () => {
    let now = 0;
    stubList(() => ok());
    const dir = directory({ now: () => now });
    dir.markUnavailable("vendor/a:free");
    expect(dir.isUnavailable("vendor/a:free")).toBe(true);
    expect(dir.isUnavailable("vendor/b:free")).toBe(false);
    now += 16 * 60_000;
    expect(dir.isUnavailable("vendor/a:free")).toBe(false);
  });
});

describe("OpenRouterCatalog (what the gateway sees)", () => {
  const providerError = (status: number) => new AIProviderError("x", "AI_UNAVAILABLE", status, false);

  it("has nothing to say until the list has been read", async () => {
    stubList(() => ok());
    const catalog = new OpenRouterCatalog(directory(), freePolicy);
    expect(catalog.hasData()).toBe(false);
    expect(catalog.select(textNeeds, [])).toBeUndefined();
    await catalog.refresh();
    expect(catalog.hasData()).toBe(true);
    expect(catalog.select(textNeeds, [])!.models.length).toBeGreaterThan(0);
  });

  it("stops choosing a model after a 404 (no endpoints), but not after other errors", async () => {
    stubList(() => ok());
    const catalog = new OpenRouterCatalog(directory(), freePolicy);
    await catalog.refresh();
    catalog.noteFailure("vendor/b:free", providerError(429));
    catalog.noteFailure("vendor/vision:free", providerError(500));
    expect(catalog.select(toolsNeeds, [])!.models.map((entry) => entry.model)).toContain("vendor/b:free");
    catalog.noteFailure("vendor/b:free", providerError(404));
    const after = catalog.select(toolsNeeds, [])!.models.map((entry) => entry.model);
    expect(after).not.toContain("vendor/b:free");
    expect(after).toContain("vendor/vision:free");
  });
});
