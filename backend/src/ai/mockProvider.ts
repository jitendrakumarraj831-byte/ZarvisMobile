import { randomUUID } from "node:crypto";
import type { AIProvider, AIRequest, AIResponse, AIResponseChunk, ToolDefinition } from "./provider.js";
import { CONTINUATION_LEAD, findDeviceAction } from "../capabilities/deviceActions.js";

/**
 * Deterministic, zero-credential default provider — see AI_ARCHITECTURE.md "Provider
 * abstraction". Lets the whole tool-calling loop and the Orchestrator run and be
 * demoed/tested with no external AI credential. It picks the best-matching tool by naive
 * keyword scoring against the description (the same shape a real LLM tool-selection prompt
 * would use, deliberately simple here) and fills required input fields with a small set of
 * named heuristics — this is a stand-in, not a general NLU system.
 */
export class MockAIProvider implements AIProvider {
  readonly id = "mock";

  async generate(request: AIRequest): Promise<AIResponse> {
    const last = lastUserMessage(request);
    // The next step of a multi-step phone request: plan only what is left (deviceActions.continuationNote).
    const leadAt = last.indexOf(CONTINUATION_LEAD);
    const continuing = leadAt >= 0;
    const utterance = continuing ? last.slice(leadAt + CONTINUATION_LEAD.length) : last;
    // "open the clock app and then open settings": the first phone step now, the rest in `then`.
    const [first, then] = splitThen(utterance);
    let tool = then ? selectTool(first, request.tools ?? []) : undefined;
    const multiStep = tool !== undefined && findDeviceAction(tool.name) !== undefined;
    if (!multiStep) tool = selectTool(utterance, request.tools ?? []);

    if (!tool) {
      return {
        message: {
          role: "assistant",
          content: continuing
            ? "That's done on your phone."
            : "I'm not sure which skill can help with that yet — could you rephrase, or ask \"what can you do?\"",
        },
        toolCalls: [],
        usage: { promptTokens: estimateTokens(request), completionTokens: 12 },
      };
    }

    const planned = multiStep ? first : utterance;
    const input = findDeviceAction(tool.name)
      ? { ...fillDeviceInput(tool.name, planned), ...(multiStep ? { then } : {}) }
      : fillInput(tool, utterance);
    return {
      message: { role: "assistant", content: "" },
      toolCalls: [{ id: randomUUID(), skillId: tool.name, input }],
      usage: { promptTokens: estimateTokens(request), completionTokens: 8 },
    };
  }

  async *streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk> {
    const response = await this.generate(request);
    const text = response.message.content || "Working on it...";
    for (const word of text.split(" ")) {
      yield { delta: `${word} `, done: false };
    }
    yield { delta: "", done: true };
  }
}

function lastUserMessage(request: AIRequest): string {
  return [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
}

function selectTool(utterance: string, tools: ToolDefinition[]): ToolDefinition | undefined {
  const normalized = utterance.toLowerCase() + " ";
  let best: { tool: ToolDefinition; score: number } | undefined;
  for (const tool of tools) {
    // A phone action is chosen by its own hint words, not its long description, so ordinary chat does not turn into a
    // phone action in development (a real model reads the description).
    const device = findDeviceAction(tool.name);
    const score = device
      ? device.mockHints.filter((hint) => normalized.includes(hint)).length * 2
      : tool.description.toLowerCase().split(/\W+/).filter((w) => w.length > 3).filter((word) => normalized.includes(word)).length;
    if (score > 0 && (!best || score > best.score)) {
      best = { tool, score };
    }
  }
  return best?.tool;
}

/**
 * Named heuristics for the small reference skill set — see SKILLS.md "Current catalogue".
 * The `default` branch (whole utterance verbatim) is only correct when a skill has exactly
 * one required field; a skill with two or more crams the *same* full utterance into every
 * field otherwise — caught live, twice, for `business.draft_invoice`'s `client`+`items` and
 * again for `automation.create_workflow`'s `goal`+`steps` (`automation.cancel_workflow`'s
 * `goalMatch` needs its own case for a different reason: it's a single field, but the
 * default's whole-utterance value includes the "cancel/stop" trigger words themselves,
 * which then fails to match the stored goal text at all). Add a new named case for any
 * future skill in the same shape rather than reaching for `default` again.
 */
function fillInput(tool: ToolDefinition, utterance: string): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of tool.inputSchema.requiredFields) {
    switch (field) {
      case "query":
      case "text":
      case "prompt":
      case "customerMessage":
        values[field] = utterance;
        break;
      case "repoUrl": {
        // Only a URL the user actually typed — never an invented placeholder repository.
        const match = utterance.match(/https?:\/\/\S+/);
        if (match) values[field] = match[0];
        break;
      }
      case "client": {
        const beforeItems = utterance.split(/\d/)[0] ?? utterance;
        const withoutTrigger = beforeItems.replace(/^.*?\b(?:invoice|bill)\b/i, "");
        values[field] = withoutTrigger.replace(/\bfor\b\s*$/i, "").trim() || utterance;
        break;
      }
      case "items": {
        const digitIndex = utterance.search(/\d/);
        values[field] = digitIndex >= 0 ? utterance.slice(digitIndex) : utterance;
        break;
      }
      case "goal":
      case "steps": {
        // "create a workflow: check email, then draft replies, then send a summary" -> both
        // fields get the text after the trigger phrase — `goal` and `steps` end up
        // identical here, which is fine: automation.create_workflow's own goal is
        // realistically just a label for the same step list in this coarse phrasing.
        const stripped = utterance.replace(/^.*?\b(?:workflow|automate|automation)\b\s*:?\s*/i, "");
        values[field] = stripped.trim() || utterance;
        break;
      }
      case "goalMatch": {
        // "cancel my check email workflow" -> "check email" — strip the cancel/stop trigger
        // and a trailing "workflow"/"task" so the match lines up with how `goal`/`steps`
        // above already stripped the *creating* utterance's own trigger phrase.
        const stripped = utterance
          .replace(/^\s*(?:please\s+)?(?:cancel|stop)\s+(?:my\s+)?/i, "")
          .replace(/\s+(?:workflow|task)\s*$/i, "");
        values[field] = stripped.trim() || utterance;
        break;
      }
      default:
        values[field] = utterance;
    }
  }
  return values;
}

function estimateTokens(request: AIRequest): number {
  const chars = request.systemPrompt.length + request.messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(chars / 4);
}

/** A request with a second phone step: what to do first, and the rest (undefined when there is one step). */
function splitThen(utterance: string): [string, string | undefined] {
  const match = /\s+(?:and then|then|aur phir|phir|fir|फिर)\s+/i.exec(utterance);
  if (!match) return [utterance, undefined];
  const rest = utterance.slice(match.index + match[0].length).trim();
  return [utterance.slice(0, match.index).trim(), rest || undefined];
}

/** Apps the mock recognises by name for phone.open_app (the phone resolves the name itself). */
const MOCK_APPS = ["play store", "gallery", "camera", "whatsapp", "youtube", "chrome", "calculator", "calendar", "contacts", "clock", "maps", "messages", "files", "photos"];

/** Words around an app or a person's name in a command, in English and Hinglish. */
const COMMAND_WORDS = new Set([
  "open", "launch", "start", "kholo", "khol", "do", "chalu", "karo", "kar", "please", "the", "my", "app", "me", "show",
  "call", "dial", "phone", "lagao", "laga", "ko", "number", "ka", "ki", "of", "find", "contact", "batao", "dikhao", "a", "to",
]);

/** Input for a phone action from the utterance, named heuristics like fillInput's (development only). */
function fillDeviceInput(skillId: string, utterance: string): Record<string, unknown> {
  const lower = utterance.toLowerCase();
  const rest = () => lower.split(/[^\p{L}\p{N}+]+/u).filter((word) => word && !COMMAND_WORDS.has(word)).join(" ");
  switch (skillId) {
    case "phone.open_app": {
      const known = MOCK_APPS.find((app) => lower.includes(app));
      return { appName: known ?? rest() };
    }
    case "phone.call":
      return { target: rest() };
    case "phone.find_contact":
      return { name: rest() };
    case "device.open_settings":
      return { panel: /wi-?fi/.test(lower) ? "WIFI" : lower.includes("bluetooth") ? "BLUETOOTH" : /location|gps/.test(lower) ? "LOCATION" : "MAIN" };
    case "device.global_action":
      return {
        action: lower.includes("lock") ? "LOCK_SCREEN"
          : lower.includes("quick settings") ? "QUICK_SETTINGS"
            : lower.includes("recent") ? "RECENTS"
              : lower.includes("back") || lower.includes("wapas") ? "BACK"
                : lower.includes("notification") ? "NOTIFICATIONS"
                  : "HOME",
      };
    case "personal.reminder":
      return /\b(list|show)\b.*\breminders\b/.test(lower) ? { action: "list" } : { action: "create", title: utterance };
    case "screen.tap":
      return { label: utterance.replace(/^.*?\btap\s+(?:on\s+|the\s+)?/i, "").trim() || utterance };
    case "alarm.set":
    case "calendar.create_event":
      return { utterance };
    case "message.draft": {
      // "send hi to Rahul on WhatsApp", "Rahul ko WhatsApp pe message bhejo ki main late hoon"
      const app = ["whatsapp", "telegram", "sms", "email"].find((name) => lower.includes(name));
      const text = /\b(?:saying|that|ki)\s+(.+)$/i.exec(utterance)?.[1] ?? /\bsend\s+(.+?)\s+to\b/i.exec(utterance)?.[1] ?? utterance;
      const to = /\bto\s+([\p{L}\d+ ]+?)(?:\s+on\b|\s+saying\b|\s+that\b|$)/iu.exec(utterance)?.[1] ?? /^([\p{L}\d+ ]+?)\s+ko\b/iu.exec(utterance)?.[1];
      return { text: text.trim(), ...(app ? { app } : {}), ...(to ? { to: to.trim() } : {}) };
    }
    case "app.search": {
      const app = lower.includes("youtube") ? "YouTube"
        : /rasta|directions|navigate/.test(lower) ? "Directions"
          : /\bmaps?\b/.test(lower) ? "Maps"
            : lower.includes("play store") ? "Play Store" : "Web";
      const query = lower
        .replace(/\b(search|for|on|in|pe|par|mein|youtube|google|maps?|play store|the|directions|to|navigate|rasta|ka|ki|dikhao|dhundo|karo|kar|show|me|please)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { query: query || utterance, app };
    }
    default:
      return {};
  }
}
