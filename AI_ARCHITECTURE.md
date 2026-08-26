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

## Why the backend, never the device

- Provider API keys are never bundled in the APK (see [SECURITY.md](./SECURITY.md)).
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
