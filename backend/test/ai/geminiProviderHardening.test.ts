import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { GeminiProvider } from "../../src/ai/geminiProvider.js";
import type { AIRequest } from "../../src/ai/provider.js";

vi.mock("../../src/ai/geminiErrors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/ai/geminiErrors.js")>()),
  sleep: async () => {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const request: AIRequest = {
  systemPrompt: "You are ZARVIS.",
  messages: [{ role: "user", content: "hello" }],
  modelConfig: { provider: "google", model: "gemini-3.6-flash" },
};
const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const reset = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
const error = async (promise: Promise<unknown>) => (await promise.then(() => undefined, (e: unknown) => e)) as AIProviderError;
const sse = (text: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;

describe("Gemini: temporary network failures", () => {
  it("retries a connection reset and succeeds, counting every request", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw reset();
      return ok("back");
    }));
    const trace = { httpRequests: 0, responseIds: [] as string[] };

    const response = await new GeminiProvider("k").generate({ ...request, trace });

    expect(response.message.content).toBe("back");
    expect(calls).toBe(3);
    expect(trace.httpRequests).toBe(3);
  });

  it("gives up after a bounded number of attempts with a structured, retryable error (never a bare Error)", async () => {
    const fetchMock = vi.fn(async () => {
      throw reset();
    });
    vi.stubGlobal("fetch", fetchMock);

    const failure = await error(new GeminiProvider("k").generate(request));

    expect(fetchMock).toHaveBeenCalledTimes(6); // 3 attempts on each of the two models
    expect(failure).toBeInstanceOf(AIProviderError);
    expect(failure).toMatchObject({ code: "AI_UNAVAILABLE", kind: "AI_PROVIDER_UNAVAILABLE", retryable: true, provider: "google" });
  });

  it("does not turn a bug in this application into a provider outage", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Cannot read properties of undefined");
    });
    vi.stubGlobal("fetch", fetchMock);

    const failure = await error(new GeminiProvider("k").generate(request));

    expect(failure).toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Gemini: timeouts are structured and not retried", () => {
  it("reports AI_PROVIDER_TIMEOUT with the long-standing message", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = error(new GeminiProvider("k").generate(request));
    await vi.advanceTimersByTimeAsync(90_001);
    const failure = await pending;

    expect(failure).toBeInstanceOf(AIProviderError);
    expect(failure).toMatchObject({ message: "Gemini request timed out", kind: "AI_PROVIDER_TIMEOUT", code: "AI_UNAVAILABLE", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1); // the provider may still be working: never repeated blindly
  });
});

describe("Gemini: bodies and keys", () => {
  it("a 200 whose body is not JSON is a provider failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>oops</html>", { status: 200 })));
    expect(await error(new GeminiProvider("k").generate(request))).toMatchObject({ kind: "AI_PROVIDER_UNAVAILABLE" });
  });

  it("reads the key when a request is made, and refuses to call without one", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ok("hi"));
    vi.stubGlobal("fetch", fetchMock);
    let key: string | undefined;
    const provider = new GeminiProvider(() => key);

    expect(await error(provider.generate(request))).toMatchObject({ provider: "google", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();

    key = "late-key-1234567890";
    await provider.generate(request);
    expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({ "x-goog-api-key": "late-key-1234567890" });
  });
});

describe("Gemini: streaming cleanup", () => {
  it("cancels the upstream response when the consumer stops early", async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const events = [sse("one "), sse("two "), sse("three")];
    let index = 0;
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < events.length) controller.enqueue(encoder.encode(events[index++]));
            else controller.close();
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200 },
      ),
    ));
    const iterator = new GeminiProvider("k").streamGenerate(request)[Symbol.asyncIterator]();

    expect((await iterator.next()).value).toEqual({ delta: "one ", done: false });
    await iterator.return?.();

    expect(cancelled).toBe(true);
  });

  it("a malformed event or a body cut short is a provider failure, not a crash", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("data: {not json\n\n")); controller.close(); } }), { status: 200 })));
    const consume = async () => {
      for await (const _chunk of new GeminiProvider("k").streamGenerate(request)) {
        // nothing expected
      }
    };
    expect(await error(consume())).toMatchObject({ kind: "AI_PROVIDER_UNAVAILABLE", provider: "google" });
  });
});
