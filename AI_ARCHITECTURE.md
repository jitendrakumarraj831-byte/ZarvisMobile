# AI ARCHITECTURE

Companion to [MASTER_SPEC.md §10 (AI Architecture)](./MASTER_SPEC.md#10-ai-architecture).

## Provider abstraction

No feature depends on a specific AI vendor's SDK or request/response shape. All AI calls
go through:

```ts
// backend/src/ai/provider.ts
export interface AIProvider {
  readonly id: string;
  generate(request: AIRequest): Promise<AIResponse>;
  streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk>;
}

export interface AIRequest {
  systemPrompt: string;
  messages: ConversationMessage[];
  tools?: ToolDefinition[];
  modelConfig: ModelConfiguration;
}

export interface AIResponse {
  message: ConversationMessage;
  toolCalls: ToolCall[];
  usage: TokenUsage;
}
```

`ProviderFactory.get(modelConfig)` resolves the concrete adapter. This repository ships a
`MockAIProvider` (deterministic, intent-keyword-based responses) as the default for local
development and CI, so the product runs and is demoable with zero external credentials.
Wiring a real provider (Anthropic, OpenAI, Google, or a local model) means implementing
`AIProvider` once and registering it in `ProviderFactory` — no caller changes.

## Gemini adapter (the first real provider wired here)

`backend/src/ai/geminiProvider.ts` implements `AIProvider` (`id: "google"`) against the
public Generative Language REST API (`generateContent` / `streamGenerateContent`) using the
platform `fetch` — no vendor SDK dependency, keeping the adapter a thin, auditable
translation layer:

- **Messages** → Gemini `contents` (`user`/`model` roles only). A `tool`-role message (a
  skill result fed back to the model) is passed through as a labelled `user` turn rather
  than Gemini's richer `functionResponse` part — a deliberate simplification matching
  `ConversationMessage`'s flat shape; extending that type with a structured tool-result
  variant is the natural next step if a future provider needs it.
- **Tools** → Gemini `functionDeclarations`, converting the minimal `JsonSchema`
  (`requiredFields` + `properties: Record<string,string>`) into Gemini's typed parameter
  schema (lowercase `"string"/"number"/...` → uppercase `"STRING"/"NUMBER"/...`).
- **Tool-call responses** → a `functionCall` part maps to a `ToolCallRequest`, which then
  runs through the same Tool pipeline (§7 of MASTER_SPEC.md) as every other provider's tool
  calls — Gemini's output is never trusted as authorization any more than the mock's is.
- **Streaming** → real SSE parsing of `streamGenerateContent?alt=sse`, yielding text deltas
  as they arrive (not the word-splitting simulation `MockAIProvider` uses).
- **Selection:** `providerFactory.ts`'s `defaultModelConfig` resolves to
  `{ provider: "google", model: env.geminiModel }` automatically whenever `GEMINI_API_KEY`
  is set (`config/env.ts`, `.env.example`), and to the mock otherwise — this is the
  "config-only change" MASTER_SPEC.md §10 describes for wiring a real provider.
- **Tests:** `backend/test/ai/geminiProvider.test.ts` mocks `fetch` to verify the request
  shape sent to Gemini and the response mapping back, including the non-2xx error path
  (never silently swallowed — Product Principle #4, "Never fake success").
- **Live-verified once, with a real key configured locally (never committed):**
  `GET /health` reported `provider: "google"`, and real turns correctly answered a direct
  question and picked the right skill (`web.search` / `docs.summarize`) via genuine
  Gemini function-calling rather than the mock's keyword heuristic. That same live call
  also caught two real bugs, both since fixed: `gemini-2.0-flash` (the adapter's original
  default) has been retired by Google — the default is now `gemini-3.6-flash`
  (`config/env.ts`, `.env.example`) — and the resulting API error crashed the whole backend
  process (see "Route safety" below), not just the one request.

## Native audio voice (Gemini TTS)

`backend/src/ai/geminiTts.ts` (`GeminiTtsProvider`) is a second, separate Gemini
capability from the text `AIProvider` above: it calls a Gemini model with
`generationConfig.responseModalities: ["AUDIO"]` and a `speechConfig.voiceConfig`
(`GEMINI_TTS_MODEL`/`GEMINI_TTS_VOICE`, `.env.example`) to get back real synthesized
speech — the same underlying voice technology behind the Gemini app's voice mode — using
the same `GEMINI_API_KEY`, not the separate Google Cloud Text-to-Speech product.

- Gemini returns raw base64-encoded PCM audio; browsers can't play raw PCM directly, so
  `pcmToWav()` wraps it in a standard 44-byte WAV header (Node has no built-in WAV
  encoder). The real sample rate is parsed from the response's `mimeType` (e.g.
  `audio/L16;rate=24000`) rather than assumed, falling back to 24kHz only if that's absent.
- Exposed as `POST /api/v1/tts/synthesize` (`api/routes/tts.ts`, authenticated, wrapped in
  `asyncHandler`), returning `audio/wav` directly. Text is capped at 2000 characters — the
  only cost guard in this pass; this call is not yet metered through the usage/credit
  ledger (§21), a known gap to close before this could scale beyond a single account.
- **Live-verified**, not just unit-tested: a real call with a configured key returned a
  genuine WAV file, confirmed to actually be speech (not silence) by checking its PCM
  sample RMS/peak amplitude with Python's `audioop`, not just a 200 status code.
- `web/app.js`'s `speak()` tries this endpoint first and falls back to the browser's
  built-in `speechSynthesis` if it fails for any reason (not configured, offline,
  rate-limited) — see DEVELOPMENT.md "Voice quality" for the full picture, including what
  this still isn't (Gemini's fuller real-time "native audio dialog"/Live API, a
  WebSocket-based bidirectional session materially different from this one-shot REST call).

## Route safety: don't let one provider failure crash every user's request

Express 4 does not catch a promise rejected inside an `async` route handler — it becomes an
unhandled rejection and kills the whole Node process. This was found live (see above): a
Gemini error inside the `/orchestrator/turn` handler took the entire backend down. Every
route handler that lacked its own `try`/`catch` is now wrapped in a shared `asyncHandler`
(`backend/src/api/asyncHandler.ts`), which forwards the rejection to `server.ts`'s error
middleware instead — that middleware logs it and returns an honest `500` (Product
Principle #4) without crashing. Any new route calling into a provider, GitHub, or another
fallible external dependency should use `asyncHandler` (or its own `try`/`catch`) for the
same reason.

## Loading credentials locally

`backend/src/bootstrapEnv.ts` (imported first in `src/index.ts`) calls Node's built-in
`process.loadEnvFile()` to load `backend/.env` before any other module (notably
`config/env.ts`) reads `process.env`. Missing the file is expected and ignored — the
zero-credential MockAIProvider default still works with no `.env` at all — any other
failure is not swallowed. No `dotenv` dependency is needed (Node 22+, see `package.json`
`engines`).

## Why the backend, never the device

- Provider API keys are never bundled in the APK **or the web client's static assets**
  (`web/` ships no key; `GEMINI_API_KEY` lives only in the backend's environment — see
  [SECURITY.md](./SECURITY.md)).
- A developer's personal Claude subscription (e.g. Claude Pro, or a Claude Code session
  like the one that built this repository) is a **development environment**, not a runtime
  API credential — the shipped app never assumes such a subscription exists on the user's
  device or account. Production traffic is billed to the product's own server-held
  provider account.
- Centralizing calls server-side also enables enforcing the Tool pipeline (permission →
  risk → entitlement → confirmation, [MASTER_SPEC.md §7](./MASTER_SPEC.md#7-tool-architecture))
  authoritatively, and lets usage/cost be metered accurately for billing (§21).

## Tool-calling loop

1. Orchestrator collects the currently-enabled `SkillDefinition`s for the account (already
   filtered by entitlement) and converts each to a `ToolDefinition` (name, description,
   JSON-schema input) for the provider's tool-use API.
2. `AIProvider.generate()` is called with the conversation + tool definitions.
3. If the model returns `toolCalls`, each one is run through the Tool pipeline
   (`domain`/`backend/src/tooling`) — never executed directly from the model's output.
4. Tool results are appended to the conversation as tool-result messages and, for
   multi-turn tool use, sent back to the provider until it returns a final natural-language
   message with no further tool calls.
5. The final message (plus a structured summary of what was done) is returned to the
   client for display/TTS.

**Where the current `Orchestrator.runTurn` actually is versus step 4 above, stated
honestly:** it does not yet send tool results back to the provider for a wrap-up pass — it
runs one `generate()` call, executes any resulting tool calls once, and builds the
returned message by prepending whatever text the model already included in that same
response (if any) to the tool pipeline's own outcome explanation (`explainOutcome()`).
That text-preservation step is what lets a first-turn welcome greeting (§ below) survive
even when the model also invokes a skill in the same turn — before it was added, any text
the model attached to a tool-calling response was silently discarded. The fuller loop step
4 describes (tool results fed back for a real follow-up natural-language reply) is not
implemented; closing that gap is future work, not a currently-working multi-turn loop.

## Streaming

`streamGenerate` yields incremental `AIResponseChunk`s so the UI can render partial text
and speak sentence-by-sentence rather than waiting for the full response — important for
the voice-first experience (`SPEAKING` state, [MASTER_SPEC.md §11](./MASTER_SPEC.md#11-voice-architecture)).

## Model configuration

`ModelConfiguration` carries `provider`, `model`, `temperature`, `maxTokens`, and an
optional `fallback` chain, so a request can degrade gracefully (e.g. to a smaller/cheaper
model) instead of failing outright when a provider is unavailable. Failures are always
surfaced honestly — this is Product Principle #4, "Never fake success"
([MASTER_SPEC.md §3](./MASTER_SPEC.md#3-product-principles)) — and are codified
operationally in the Task Engine's failure recovery
([MASTER_SPEC.md §18](./MASTER_SPEC.md#18-task-engine)): a failed AI call surfaces its
explained error and offers retry/skip/cancel rather than silently continuing.
