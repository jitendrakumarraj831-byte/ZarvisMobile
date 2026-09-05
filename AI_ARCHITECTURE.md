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
