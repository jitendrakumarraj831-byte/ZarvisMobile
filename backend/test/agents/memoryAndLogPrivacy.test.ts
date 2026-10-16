import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIRequest, AIResponse } from "../../src/ai/provider.js";
import { auth, harness, newGuest, say, STORES, type Guest, type Harness } from "../helpers/api.js";

/**
 * Phase 1 reliability: memory is only what the user saved, it stays with its account, and what people say or save is
 * never written to the server log. Later phases (memory proposals, the phone agent, the PC companion) build on these.
 */

type Generate = (request: AIRequest) => Promise<AIResponse>;

/** Replaces the planner's model with a script; skills' own generation still goes to the real (mock) provider. */
function scriptPlanner(h: Harness, steps: Array<Pick<AIResponse, "toolCalls"> & { text?: string }>, seen: string[] = []): string[] {
  const provider = h.container.orchestrator as unknown as { provider: { generate: Generate } };
  const original = provider.provider.generate.bind(provider.provider);
  let step = 0;
  provider.provider.generate = async (req) => {
    if (req.purpose !== "planner") return original(req);
    seen.push(req.systemPrompt);
    const next = steps[Math.min(step++, steps.length - 1)]!;
    return { message: { role: "assistant", content: next.text ?? "" }, toolCalls: next.toolCalls, usage: { promptTokens: 0, completionTokens: 0 } };
  };
  return seen;
}

const memoryOf = async (h: Harness, who: Guest) => (await request(h.app).get("/api/v1/memory").set(auth(who))).body as { personal: unknown[] };
const notesOf = async (h: Harness, who: Guest) => (await request(h.app).get("/api/v1/notes?kind=memory").set(auth(who))).body.notes as unknown[];

describe.each(STORES)("memory is user-controlled (%s)", (_label, makeStore) => {
  let h: Harness;
  let me: Guest;

  beforeEach(async () => {
    h = harness(makeStore());
    me = await newGuest(h.app);
  });

  it("a chat turn never saves memory, even when the user asks it to remember something", async () => {
    for (const utterance of ["remember that my bank PIN is 4321", "mera naam yaad rakhna, main Jitendra hoon", "मेरा जन्मदिन 5 मई है, याद रखना"]) {
      await say(h.app, me, utterance);
    }
    expect((await memoryOf(h, me)).personal).toEqual([]);
    expect(await notesOf(h, me)).toEqual([]);
  });

  it("the model cannot save memory by naming a tool: no such tool is offered, and nothing is stored or run", async () => {
    const seen = scriptPlanner(h, [
      { toolCalls: [{ id: "t1", skillId: "memory.save", input: { content: "User's PIN is 4321" } }] },
      { toolCalls: [], text: "I can't save that from here; you can add it in Settings > Memory." },
    ]);
    const body = await say(h.app, me, "please remember my PIN 4321");
    expect(seen.length).toBeGreaterThan(0);
    expect(body.toolCalls).toEqual([]);
    expect(body.message).toContain("Settings > Memory");
    expect(await notesOf(h, me)).toEqual([]);
    const runs = (await request(h.app).get("/api/v1/executions").set(auth(me))).body;
    expect(JSON.stringify(runs)).not.toContain("memory.save");
  });

  it("one account's saved memory never reaches another account's planner", async () => {
    const other = await newGuest(h.app);
    await request(h.app).post("/api/v1/notes").set(auth(other)).send({ kind: "memory", content: "OTHER-ACCOUNT-PRIVATE-FACT lives in Pune" });
    await request(h.app).post("/api/v1/notes").set(auth(me)).send({ kind: "memory", content: "I prefer short answers" });
    const seen = scriptPlanner(h, [{ toolCalls: [], text: "Sure." }]);
    await say(h.app, me, "what should I cook tonight please");
    expect(seen.some((prompt) => prompt.includes("I prefer short answers"))).toBe(true);
    expect(seen.some((prompt) => prompt.includes("OTHER-ACCOUNT-PRIVATE-FACT"))).toBe(false);
  });
});

describe.each(STORES)("the server log never holds what people say or save (%s)", (_label, makeStore) => {
  let h: Harness;
  let me: Guest;
  let lines: string[];

  beforeEach(async () => {
    h = harness(makeStore());
    me = await newGuest(h.app);
    lines = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a turn with saved memory, a tool call and a hidden tool logs ids and counts, never the text", async () => {
    const SAID = "UTTERANCE-MARK-7f3a";
    const SAVED = "MEMORY-MARK-91c2";
    const TOOL_INPUT = "TOOL-INPUT-MARK-5d0e";
    const HIDDEN_INPUT = "HIDDEN-TOOL-MARK-2b8f";
    await request(h.app).post("/api/v1/notes").set(auth(me)).send({ kind: "memory", content: `My code word is ${SAVED}` });
    scriptPlanner(h, [
      {
        toolCalls: [
          { id: "t1", skillId: "creative.write_poem", input: { prompt: `a short poem about ${TOOL_INPUT}` } },
          { id: "t2", skillId: "memory.save", input: { content: HIDDEN_INPUT } },
        ],
      },
      { toolCalls: [], text: "Here is your poem." },
    ]);
    const body = await say(h.app, me, `please write a poem for me about ${SAID}`);
    expect(body.toolCalls.map((call) => call.skillId)).toEqual(["creative.write_poem"]);

    const log = lines.join("\n");
    expect(log).toContain("Turn finished"); // the turn was logged...
    for (const mark of [SAID, SAVED, TOOL_INPUT, HIDDEN_INPUT]) expect(log).not.toContain(mark); // ...without its content
  });
});
