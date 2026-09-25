import { randomUUID } from "node:crypto";
import type {
  AIProvider,
  AIRequest,
  AIResponse,
  AIResponseChunk,
  ConversationMessage,
  ToolDefinition,
} from "./provider.js";

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: Array<{
      id?: string;
      function?: { name?: string; arguments?: string };
    }> };
  }>;
}

export class OmniRouteProvider implements AIProvider {
  readonly id = "omniroute";

  constructor(
    private readonly apiKey: string,
    private readonly model = "auto",
    private readonly baseUrl = "http://127.0.0.1:20128/v1",
  ) {}

  async generate(request: AIRequest): Promise<AIResponse> {
    const res = await this.request("/chat/completions", {
      model: this.model === "auto" ? "auto" : request.modelConfig.model || this.model,
      messages: toOpenAIMessages(request),
      tools: request.tools?.length ? request.tools.map(toOpenAITool) : undefined,
      temperature: request.modelConfig.temperature,
      max_tokens: request.modelConfig.maxTokens,
    });

    if (!res.ok) {
      throw await responseError("OmniRoute chat completion failed", res);
    }

    const json = (await res.json()) as OpenAIResponse;
    const message = json.choices?.[0]?.message;
    if (!message) throw new Error("OmniRoute returned no assistant message");

    const toolCalls = (message.tool_calls ?? [])
      .filter((call) => call.function?.name)
      .map((call) => ({
        id: call.id || randomUUID(),
        skillId: call.function!.name!,
        input: parseToolArguments(call.function?.arguments),
      }));

    return {
      message: { role: "assistant", content: message.content ?? "" },
      toolCalls,
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  }

  async *streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk> {
    const res = await this.request("/chat/completions", {
      model: this.model === "auto" ? "auto" : request.modelConfig.model || this.model,
      messages: toOpenAIMessages(request),
      tools: request.tools?.length ? request.tools.map(toOpenAITool) : undefined,
      temperature: request.modelConfig.temperature,
      max_tokens: request.modelConfig.maxTokens,
      stream: true,
    });

    if (!res.ok || !res.body) {
      throw await responseError("OmniRoute streaming chat completion failed", res);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice("data:".length).trim();
          if (!payload || payload === "[DONE]") continue;
          const chunk = JSON.parse(payload) as OpenAIStreamChunk;
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta) yield { delta, done: false };
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { delta: "", done: true };
  }

  private request(path: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`${this.baseUrl.replace(/\\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  }
}

function toOpenAIMessages(request: AIRequest): OpenAIMessage[] {
  return [
    { role: "system", content: request.systemPrompt },
    ...request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
}

function toOpenAITool(tool: ToolDefinition) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(tool.inputSchema.properties ?? {}).map(([name, type]) => [name, { type }]),
        ),
        required: tool.inputSchema.requiredFields,
      },
    },
  };
}

function parseToolArguments(value?: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function responseError(prefix: string, response: Response): Promise<Error> {
  const text = await response.text().catch(() => "");
  return new Error(`${prefix}: ${response.status} ${response.statusText} ${text}`.trim());
}
